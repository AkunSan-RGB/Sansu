import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { toDocDate } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { utilityCounterReceipts, utilityIngestKeys, utilityRemittances } from '../../db/schema';
import { PostingService } from '../accounting/posting.service';
import { PaymentsService } from '../sales/payments/payments.service';
import { ReadingDto } from './utility.dto';
import { UtilityService } from './utility.service';
import { MeterRowDto, IngestKeyDto, CounterPayDto, RemitDto, DecideDto } from './utility-field.dto';
import { PERIOD } from './utility-field.shared';
import { insertOne, patchById } from '../../db/owned';
import { UtilityFieldRepository } from './utility-field.repository';

const errMsg = (e: unknown) => {
  const r = (e as { response?: { message?: string | string[] } }).response?.message;
  return Array.isArray(r) ? r.join('; ') : (r ?? (e as Error).message ?? 'Gagal');
};

@Injectable()
export class UtilityFieldService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly util: UtilityService,
    private readonly payments: PaymentsService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly storage: StorageService,
    private readonly repo: UtilityFieldRepository,
  ) {}

  /** Cari sambungan menurut nomor (kunci unik per perusahaan) */
  private async idsByNumber(tenantId: string, numbers: string[]) {
    const r = await this.repo.queryUtilityConnection(this.db, tenantId, numbers);
    return new Map(r.rows.map((x) => [x.number, x.id]));
  }

  /** Masukkan banyak angka meter; tiap baris diperiksa aturan yang sama dengan input manual dan gagal sendiri-sendiri */
  async importRows(u: AuthUser, rows: MeterRowDto[], source: 'IMPORT' | 'API') {
    const ids = await this.idsByNumber(u.tenantId, rows.map((r) => r.connectionNumber));
    const results: { row: number; connectionNumber: string; ok: boolean; flags?: string[]; error?: string; duplicate?: boolean }[] = [];
    for (const [i, r] of rows.entries()) {
      const connectionId = ids.get(r.connectionNumber);
      if (!connectionId) {
        results.push({ row: i + 1, connectionNumber: r.connectionNumber, ok: false, error: 'Nomor sambungan tidak ditemukan' });
        continue;
      }
      // alat yang mengulang kirim (jaringan putus) tidak dianggap gagal bila angkanya sama dengan yang sudah tercatat dari jalur yang sama
      if (source === 'API') {
        const dup = await this.repo.queryUtilityReading(this.db, connectionId, r.period, r.current);
        if (dup.rows.length) {
          results.push({ row: i + 1, connectionNumber: r.connectionNumber, ok: true, duplicate: true });
          continue;
        }
      }
      try {
        const x = await this.util.enterReading(u, { connectionId, period: r.period, current: r.current, note: r.note } as ReadingDto, source);
        results.push({ row: i + 1, connectionNumber: r.connectionNumber, ok: true, flags: x.flags });
      } catch (e) {
        results.push({ row: i + 1, connectionNumber: r.connectionNumber, ok: false, error: errMsg(e) });
      }
    }
    const okCount = results.filter((x) => x.ok && !x.duplicate).length;
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityReading', entityId: u.sub, data: { import: source, total: rows.length, accepted: okCount, rejected: results.filter((x) => !x.ok).length } });
    const dupCount = results.filter((x) => x.duplicate).length;
    return { total: rows.length, accepted: okCount, duplicates: dupCount, rejected: rows.length - okCount - dupCount, results };
  }

  keys(tenantId: string) {
    return this.repo.listUtilityIngestKeysByCreatedAt(this.db, tenantId);
  }
  async createKey(u: AuthUser, dto: IngestKeyDto) {
    const key = `sum_${randomBytes(24).toString('base64url')}`;
    const [row] = await this.repo.insertUtilityIngestKeys(this.db, u.tenantId, dto.name, key, u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityIngestKey', entityId: row.id, data: { name: row.name, prefix: row.keyPrefix } });
    return { ...row, key, warning: 'Simpan kunci ini sekarang. Kunci tidak bisa ditampilkan lagi.' };
  }
  async revokeKey(u: AuthUser, id: string) {
    const [row] = await this.repo.updateUtilityIngestKeysByIdAndRevokedAtAndName(this.db, id, u.tenantId);
    if (!row) throw new NotFoundException('Kunci tidak ditemukan atau sudah dicabut');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REVOKE', entity: 'UtilityIngestKey', entityId: id, data: { name: row.name } });
    return { ok: true };
  }

  /** Tagihan utilitas yang masih bisa dibayar di loket, dicari lewat nomor sambungan/nama/nomor faktur */
  async counterSearch(tenantId: string, q: string) {
    const like = `%${q.trim()}%`;
    if (q.trim().length < 2) return [];
    const r = await this.repo.queryUtilityBill(this.db, tenantId, like);
    return r.rows;
  }

  /** Terima pembayaran tunai di loket: pelunasan biasa + catatan penerimaan milik petugas */
  async counterPay(u: AuthUser, dto: CounterPayDto) {
    const [bill] = await this.repo.findUtilityBillsByInvoiceId(this.db, dto.invoiceId, u.tenantId);
    if (!bill) throw new BadRequestException('Faktur ini bukan tagihan utilitas');
    const method = dto.method ?? 'CASH';
    let receipt: { id: string; amount: string } | undefined;
    // pelunasan dan catatan penerimaan satu transaksi: tidak mungkin ada uang tercatat tanpa penerimaan loket
    const pay = await this.payments.create(u, { invoiceId: dto.invoiceId, amount: dto.amount, method, cashAccountId: dto.cashAccountId, notes: `Loket${dto.notes ? ` - ${dto.notes}` : ''}` }, {
      inTx: async (tx, p) => {
        const rc = await insertOne(tx, utilityCounterReceipts, { tenantId: u.tenantId, paymentId: p.id, invoiceId: dto.invoiceId, collectorId: u.sub, amount: money(dto.amount).toFixed(2), method });
        receipt = rc;
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityCounterReceipt', entityId: rc.id, data: { payment: p.number, amount: dto.amount, method } });
      },
    });
    const rc = receipt!;
    return { receiptId: rc.id, paymentNumber: pay.number, amount: rc.amount, method };
  }

  /** Penerimaan loket petugas ini yang belum disetor */
  async openReceipts(u: AuthUser) {
    const rows = await this.repo.listUtilityCounterReceiptsByCollectorIdAndMethodAndRemittanceId(this.db, u.tenantId, u.sub);
    return { items: rows, expected: rows.reduce((a, r) => a.plus(r.amount), D(0)).toFixed(2) };
  }

  /** Setor semua penerimaan terbuka milik petugas; selisih dengan hitungan fisik wajib dijelaskan */
  async remit(u: AuthUser, dto: RemitDto) {
    const date = toDocDate(undefined);
    const counted = money(dto.counted);
    if (counted.lt(0)) throw new BadRequestException('Jumlah setoran tidak valid');
    await this.db.transaction(async (tx) => {
      await this.repo.queryUtilityCounterReceipt(tx, u.tenantId, u.sub);
      const rows = await this.repo.listUtilityCounterReceiptsByCollectorIdAndMethodAndRemittanceIdForRemit(tx, u.tenantId, u.sub);
      if (!rows.length) throw new BadRequestException('Tidak ada penerimaan loket yang perlu disetor');
      const expected = rows.reduce((a, r) => a.plus(r.amount), D(0));
      const diff = counted.minus(expected);
      if (!diff.isZero() && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Ada selisih ${diff.toFixed(2)} antara hitungan fisik dan catatan sistem; tulis penjelasannya.`);
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_REMITTANCE', date);
      const rem = await insertOne(tx, utilityRemittances, { tenantId: u.tenantId, number, date, collectorId: u.sub, expected: expected.toFixed(2), counted: counted.toFixed(2), difference: diff.toFixed(2), receiptCount: rows.length, note: dto.note?.trim() || null });
      await this.repo.updateUtilityCounterReceiptsById(tx, rem.id, rows);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityRemittance', entityId: rem.id, data: { number, expected: rem.expected, counted: rem.counted, difference: rem.difference } });
    });
    const [latest] = await this.repo.findUtilityRemittancesByCollectorIdAndCreatedAt(this.db, u.tenantId, u.sub);
    return latest;
  }

  remittances(tenantId: string) {
    return this.repo.listUtilityRemittancesByCreatedAt(this.db, tenantId);
  }

  /** Konfirmasi (atau sengketakan) setoran oleh orang lain dari penyetor */
  async decide(u: AuthUser, id: string, dto: DecideDto) {
    await this.db.transaction(async (tx) => {
      const r = await this.repo.queryUtilityRemittance(tx, id, u.tenantId);
      const rem = r.rows[0] as unknown as { status: string; collector_id: string; difference: string; number: string; counted: string; date: string } | undefined;
      if (!rem) throw new NotFoundException('Setoran tidak ditemukan');
      if (rem.status !== 'SUBMITTED') throw new BadRequestException('Setoran ini sudah diputuskan');
      if (rem.collector_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Setoran harus dikonfirmasi orang lain dari penyetornya (pemisahan fungsi)');
      if ((dto.dispute || !D(rem.difference).isZero()) && (dto.note ?? '').trim().length < 5) throw new BadRequestException('Setoran berselisih atau disengketakan: tulis catatan keputusan.');
      const status = dto.dispute ? 'DISPUTED' : 'CONFIRMED';
      if (dto.depositAccountId && dto.dispute) throw new BadRequestException('Setoran yang disengketakan belum bisa dijurnal ke bank');
      // konfirmasi + rekening tujuan: pindahkan uang yang benar-benar disetor dari Kas ke Bank (selisih tetap di Kas sampai diselesaikan)
      let journalId: string | null = null;
      if (dto.depositAccountId && D(rem.counted).gt(0)) {
        const bank = await this.posting.resolveCashAccount(tx, u.tenantId, dto.depositAccountId, 'BANK');
        const cash = await this.posting.resolveCashAccount(tx, u.tenantId, undefined, 'CASH');
        if (bank.id === cash.id) throw new BadRequestException('Rekening tujuan harus berbeda dari Kas');
        const j = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date: toDocDate(undefined),
          description: `Setoran kas loket ${rem.number} ke ${bank.name}`,
          sourceType: 'TRANSFER',
          sourceId: id,
          createdById: u.sub,
          lines: [{ accountId: bank.id, debit: D(rem.counted) }, { accountId: cash.id, credit: D(rem.counted) }],
        });
        journalId = j.id;
      }
      await patchById(tx, utilityRemittances, id, { status, decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.note?.trim() || null, depositAccountId: dto.depositAccountId ?? null, journalId });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.dispute ? 'REJECT' : 'APPROVE', entity: 'UtilityRemittance', entityId: id, data: { number: rem.number, difference: rem.difference, note: dto.note, journalId } });
    });
    return { ok: true };
  }

  /** Kontrol loket: pembayaran tunai atas tagihan utilitas yang tidak tercatat sebagai penerimaan loket, setoran lama belum dikonfirmasi, setoran berselisih */
  async counterControls(tenantId: string) {
    const outside = await this.repo.queryPayment(this.db, tenantId);
    const stale = await this.repo.queryUtilityCounterReceiptForCounterControls(this.db, tenantId);
    const pending = await this.repo.queryUtilityRemittanceForCounterControls(this.db, tenantId);
    const mismatch = await this.repo.queryUtilityRemittanceForCounterControls2(this.db, tenantId);
    return { receiptsWithoutRecord: outside.rows, unremittedOverOneDay: stale.rows, remittancesNotConfirmed: pending.rows, remittancesWithDifference: mismatch.rows };
  }

  /** Daftar kerja petugas lapangan: sambungan yang belum dicatat periode ini, beserta koordinat pelanggan bila ada */
  async fieldRoute(tenantId: string, period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    const r = await this.repo.queryUtilityConnectionForFieldRoute(this.db, tenantId, period);
    return r.rows;
  }

  /** Foto meter satu pencatatan (tidak ikut daftar agar ringan) */
  async photo(tenantId: string, id: string) {
    const r = await this.repo.queryUtilityReadingForPhoto(this.db, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Pencatatan tidak ditemukan');
    return { photo: await this.storage.load(tenantId, r.rows[0].photo) };
  }
}

/** Menyahkan kunci API (header X-Api-Key) menjadi pengguna sistem perusahaan itu */
@Injectable()
export class UtilityIngestGuard implements CanActivate {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly apps: AppsService,
    private readonly repo: UtilityFieldRepository,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const raw = req.headers['x-api-key'];
    if (!raw || typeof raw !== 'string' || raw.length < 20 || raw.length > 120) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    const [k] = await this.repo.findUtilityIngestKeysByKeyHash(this.db, raw);
    if (!k || k.revokedAt) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    if (!(await this.apps.isEnabled(k.tenantId, ['utility']))) throw new HttpException('Aplikasi Layanan Utilitas belum diaktifkan di perusahaan ini', HttpStatus.FORBIDDEN);
    if ((await this.subs.state(k.tenantId)).readOnly) throw new HttpException('Langganan perusahaan tidak aktif', HttpStatus.PAYMENT_REQUIRED);
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await patchById(this.db, utilityIngestKeys, k.id, { lastUsedAt: new Date() });
    // pencatat = pembuat kunci, jadi verifikasi tetap harus dilakukan orang lain
    req.user = { sub: k.createdById, tenantId: k.tenantId, role: 'WAREHOUSE', email: `kunci-api:${k.keyPrefix}`, emailVerified: true, warehouseIds: [] };
    return true;
  }
}
