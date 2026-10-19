/**
 * Utilitas lapangan: impor angka meter, kunci API alat meter, mode petugas lapangan, dan kanal loket dengan setoran harian.
 *
 * Prinsip: semua jalur masuk (manual, lapangan, impor, API) berakhir sebagai pencatatan berstatus "menunggu verifikasi" lewat
 * UtilityService.enterReading, jadi aturan yang sama berlaku (angka tidak boleh turun, satu periode satu pencatatan, tanda janggal,
 * verifikasi orang lain). Tidak ada jalur yang langsung menjadi tagihan.
 *
 * Loket: pembayaran tunai memakai alur pelunasan faktur yang ada (jurnal, persetujuan pemisahan fungsi) lalu dicatat sebagai
 * penerimaan loket milik petugas. Petugas menyetor total tunai harian; selisih wajib dijelaskan; dikonfirmasi orang lain.
 */
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AppsService } from '../../common/apps/apps.service';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { utilityBills, utilityCounterReceipts, utilityIngestKeys, utilityRemittances } from '../../db/schema';
import { PostingService } from '../accounting/posting.service';
import { AccountingModule } from '../accounting/accounting.module';
import { PaymentsService } from '../sales/payments/payments.service';
import { SalesModule } from '../sales/sales.module';
import { ReadingDto, UtilityModule, UtilityService } from './utility.module';

const hash = (k: string) => createHash('sha256').update(k).digest('hex');
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const errMsg = (e: unknown) => {
  const r = (e as { response?: { message?: string | string[] } }).response?.message;
  return Array.isArray(r) ? r.join('; ') : (r ?? (e as Error).message ?? 'Gagal');
};

// ---------- DTO ----------
export class MeterRowDto {
  @ApiProperty({ example: 'SBG/2026/00012', description: 'Nomor sambungan' }) @IsString() @MaxLength(60) connectionNumber: string;
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD) period: string;
  @ApiProperty({ example: '1234.5' }) @IsNumberString() current: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ImportDto {
  @ApiProperty({ type: [MeterRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MeterRowDto) rows: MeterRowDto[];
}
export class IngestKeyDto {
  @ApiProperty({ example: 'Gateway meter Blok A' }) @IsString() @MinLength(3) @MaxLength(80) name: string;
}
export class CounterPayDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'], default: 'CASH', description: 'TRANSFER = transfer/QRIS yang masuk rekening bank; tidak ikut setoran tunai' }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @ApiPropertyOptional({ description: 'Rekening bank penerima (non-tunai); kosong = Bank utama' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiProperty({ example: '132090' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class RemitDto {
  @ApiProperty({ example: '1250000', description: 'Uang tunai yang disetor (hitung fisik)' }) @IsNumberString() counted: string;
  @ApiPropertyOptional({ description: 'Wajib bila ada selisih' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class DecideDto {
  @ApiPropertyOptional({ description: 'Rekening bank tujuan setoran; bila diisi, sistem menjurnal Kas → Bank sebesar uang yang disetor' }) @IsOptional() @IsUUID() depositAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ description: 'true = tandai disengketakan (selisih belum bisa diterima)' }) @IsOptional() @IsBoolean() dispute?: boolean;
}

// ---------- Layanan ----------
@Injectable()
export class UtilityFieldService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly util: UtilityService,
    private readonly payments: PaymentsService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /** Cari sambungan menurut nomor (kunci unik per perusahaan) */
  private async idsByNumber(tenantId: string, numbers: string[]) {
    const r = await this.db.execute<{ id: string; number: string }>(sql`SELECT id, number FROM utility_connections WHERE tenant_id = ${tenantId} AND number IN (${sql.join([...new Set(numbers)].map((n) => sql`${n}`), sql`, `)})`);
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
        const dup = await this.db.execute(sql`SELECT 1 FROM utility_readings WHERE connection_id = ${connectionId} AND period = ${r.period} AND status <> 'REJECTED' AND source = 'API' AND current = ${r.current}::numeric LIMIT 1`);
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

  // ----- kunci API -----
  keys(tenantId: string) {
    return this.db
      .select({ id: utilityIngestKeys.id, name: utilityIngestKeys.name, keyPrefix: utilityIngestKeys.keyPrefix, createdAt: utilityIngestKeys.createdAt, lastUsedAt: utilityIngestKeys.lastUsedAt, revokedAt: utilityIngestKeys.revokedAt })
      .from(utilityIngestKeys)
      .where(eq(utilityIngestKeys.tenantId, tenantId))
      .orderBy(desc(utilityIngestKeys.createdAt));
  }
  async createKey(u: AuthUser, dto: IngestKeyDto) {
    const key = `sum_${randomBytes(24).toString('base64url')}`;
    const [row] = await this.db
      .insert(utilityIngestKeys)
      .values({ tenantId: u.tenantId, name: dto.name.trim(), keyHash: hash(key), keyPrefix: key.slice(0, 8), createdById: u.sub })
      .returning({ id: utilityIngestKeys.id, name: utilityIngestKeys.name, keyPrefix: utilityIngestKeys.keyPrefix });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityIngestKey', entityId: row.id, data: { name: row.name, prefix: row.keyPrefix } });
    return { ...row, key, warning: 'Simpan kunci ini sekarang. Kunci tidak bisa ditampilkan lagi.' };
  }
  async revokeKey(u: AuthUser, id: string) {
    const [row] = await this.db
      .update(utilityIngestKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(utilityIngestKeys.id, id), eq(utilityIngestKeys.tenantId, u.tenantId), isNull(utilityIngestKeys.revokedAt)))
      .returning({ id: utilityIngestKeys.id, name: utilityIngestKeys.name });
    if (!row) throw new NotFoundException('Kunci tidak ditemukan atau sudah dicabut');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REVOKE', entity: 'UtilityIngestKey', entityId: id, data: { name: row.name } });
    return { ok: true };
  }

  // ----- loket -----
  /** Tagihan utilitas yang masih bisa dibayar di loket, dicari lewat nomor sambungan/nama/nomor faktur */
  async counterSearch(tenantId: string, q: string) {
    const like = `%${q.trim()}%`;
    if (q.trim().length < 2) return [];
    const r = await this.db.execute(sql`
      SELECT i.id AS "invoiceId", i.number AS "invoiceNumber", c.number AS "connectionNumber", cu.name AS "customerName", c.address, b.period,
             (i.total - i.paid_amount - i.returned_amount) AS outstanding, i.due_date AS "dueDate"
      FROM utility_bills b
      JOIN invoices i ON i.id = b.invoice_id
      JOIN utility_connections c ON c.id = b.connection_id
      JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.status IN ('UNPAID','PARTIAL') AND i.total - i.paid_amount - i.returned_amount > 0
        AND (c.number ILIKE ${like} OR cu.name ILIKE ${like} OR i.number ILIKE ${like} OR c.meter_no ILIKE ${like})
      ORDER BY i.due_date LIMIT 50`);
    return r.rows;
  }

  /** Terima pembayaran tunai di loket: pelunasan biasa + catatan penerimaan milik petugas */
  async counterPay(u: AuthUser, dto: CounterPayDto) {
    const [bill] = await this.db.select({ id: utilityBills.id }).from(utilityBills).where(and(eq(utilityBills.invoiceId, dto.invoiceId), eq(utilityBills.tenantId, u.tenantId)));
    if (!bill) throw new BadRequestException('Faktur ini bukan tagihan utilitas');
    const method = dto.method ?? 'CASH';
    let receipt: { id: string; amount: string } | undefined;
    // pelunasan dan catatan penerimaan satu transaksi: tidak mungkin ada uang tercatat tanpa penerimaan loket
    const pay = await this.payments.create(u, { invoiceId: dto.invoiceId, amount: dto.amount, method, cashAccountId: dto.cashAccountId, notes: `Loket${dto.notes ? ` - ${dto.notes}` : ''}` }, {
      inTx: async (tx, p) => {
        const [rc] = await tx
          .insert(utilityCounterReceipts)
          .values({ tenantId: u.tenantId, paymentId: p.id, invoiceId: dto.invoiceId, collectorId: u.sub, amount: money(dto.amount).toFixed(2), method })
          .returning();
        receipt = rc;
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityCounterReceipt', entityId: rc.id, data: { payment: p.number, amount: dto.amount, method } });
      },
    });
    const rc = receipt!;
    return { receiptId: rc.id, paymentNumber: pay.number, amount: rc.amount, method };
  }

  /** Penerimaan loket petugas ini yang belum disetor */
  async openReceipts(u: AuthUser) {
    const rows = await this.db
      .select()
      .from(utilityCounterReceipts)
      .where(and(eq(utilityCounterReceipts.tenantId, u.tenantId), eq(utilityCounterReceipts.collectorId, u.sub), eq(utilityCounterReceipts.method, 'CASH'), isNull(utilityCounterReceipts.remittanceId)))
      .orderBy(utilityCounterReceipts.receivedAt);
    return { items: rows, expected: rows.reduce((a, r) => a.plus(r.amount), D(0)).toFixed(2) };
  }

  /** Setor semua penerimaan terbuka milik petugas; selisih dengan hitungan fisik wajib dijelaskan */
  async remit(u: AuthUser, dto: RemitDto) {
    const date = toDocDate(undefined);
    const counted = money(dto.counted);
    if (counted.lt(0)) throw new BadRequestException('Jumlah setoran tidak valid');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM utility_counter_receipts WHERE tenant_id = ${u.tenantId} AND collector_id = ${u.sub} AND method = 'CASH' AND remittance_id IS NULL FOR UPDATE`);
      const rows = await tx
        .select()
        .from(utilityCounterReceipts)
        .where(and(eq(utilityCounterReceipts.tenantId, u.tenantId), eq(utilityCounterReceipts.collectorId, u.sub), eq(utilityCounterReceipts.method, 'CASH'), isNull(utilityCounterReceipts.remittanceId)));
      if (!rows.length) throw new BadRequestException('Tidak ada penerimaan loket yang perlu disetor');
      const expected = rows.reduce((a, r) => a.plus(r.amount), D(0));
      const diff = counted.minus(expected);
      if (!diff.isZero() && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Ada selisih ${diff.toFixed(2)} antara hitungan fisik dan catatan sistem; tulis penjelasannya.`);
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_REMITTANCE', date);
      const [rem] = await tx
        .insert(utilityRemittances)
        .values({ tenantId: u.tenantId, number, date, collectorId: u.sub, expected: expected.toFixed(2), counted: counted.toFixed(2), difference: diff.toFixed(2), receiptCount: rows.length, note: dto.note?.trim() || null })
        .returning();
      await tx.update(utilityCounterReceipts).set({ remittanceId: rem.id }).where(sql`${utilityCounterReceipts.id} IN (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityRemittance', entityId: rem.id, data: { number, expected: rem.expected, counted: rem.counted, difference: rem.difference } });
    });
    const [latest] = await this.db.select().from(utilityRemittances).where(and(eq(utilityRemittances.tenantId, u.tenantId), eq(utilityRemittances.collectorId, u.sub))).orderBy(desc(utilityRemittances.createdAt)).limit(1);
    return latest;
  }

  remittances(tenantId: string) {
    return this.db.select().from(utilityRemittances).where(eq(utilityRemittances.tenantId, tenantId)).orderBy(desc(utilityRemittances.createdAt)).limit(200);
  }

  /** Konfirmasi (atau sengketakan) setoran oleh orang lain dari penyetor */
  async decide(u: AuthUser, id: string, dto: DecideDto) {
    await this.db.transaction(async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM utility_remittances WHERE id = ${id} AND tenant_id = ${u.tenantId} FOR UPDATE`);
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
      await tx.update(utilityRemittances).set({ status, decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.note?.trim() || null, depositAccountId: dto.depositAccountId ?? null, journalId }).where(eq(utilityRemittances.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.dispute ? 'REJECT' : 'APPROVE', entity: 'UtilityRemittance', entityId: id, data: { number: rem.number, difference: rem.difference, note: dto.note, journalId } });
    });
    return { ok: true };
  }

  /** Kontrol loket: pembayaran tunai atas tagihan utilitas yang tidak tercatat sebagai penerimaan loket, setoran lama belum dikonfirmasi, setoran berselisih */
  async counterControls(tenantId: string) {
    const outside = await this.db.execute(sql`
      SELECT p.number, p.date, p.amount, i.number AS "invoiceNumber"
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN utility_bills b ON b.invoice_id = i.id
      WHERE p.tenant_id = ${tenantId} AND p.notes LIKE 'Loket%'
        AND NOT EXISTS (SELECT 1 FROM utility_counter_receipts r WHERE r.payment_id = p.id)
      ORDER BY p.date DESC LIMIT 100`);
    const stale = await this.db.execute(sql`
      SELECT collector_id AS "collectorId", count(*)::int AS count, sum(amount) AS amount, min(received_at) AS since
      FROM utility_counter_receipts WHERE tenant_id = ${tenantId} AND method = 'CASH' AND remittance_id IS NULL AND received_at < now() - interval '1 day'
      GROUP BY collector_id`);
    const pending = await this.db.execute(sql`SELECT number, date, difference FROM utility_remittances WHERE tenant_id = ${tenantId} AND status = 'SUBMITTED' AND created_at < now() - interval '2 days' ORDER BY date`);
    const mismatch = await this.db.execute(sql`SELECT number, date, difference, status FROM utility_remittances WHERE tenant_id = ${tenantId} AND difference <> 0 AND date >= ${addMonths()} ORDER BY date DESC LIMIT 50`);
    return { receiptsWithoutRecord: outside.rows, unremittedOverOneDay: stale.rows, remittancesNotConfirmed: pending.rows, remittancesWithDifference: mismatch.rows };
  }

  /** Daftar kerja petugas lapangan: sambungan yang belum dicatat periode ini, beserta koordinat pelanggan bila ada */
  async fieldRoute(tenantId: string, period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    const r = await this.db.execute(sql`
      SELECT c.id, c.number, c.meter_no AS "meterNo", c.address, cu.name AS "customerName", cu.geo_lat AS lat, cu.geo_lng AS lng, t.unit,
             COALESCE((SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1), c.initial_reading) AS previous
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')
      ORDER BY c.address LIMIT 1000`);
    return r.rows;
  }

  /** Foto meter satu pencatatan (tidak ikut daftar agar ringan) */
  async photo(tenantId: string, id: string) {
    const r = await this.db.execute<{ photo: string | null }>(sql`SELECT photo FROM utility_readings WHERE id = ${id} AND tenant_id = ${tenantId}`);
    if (!r.rows.length) throw new NotFoundException('Pencatatan tidak ditemukan');
    return { photo: r.rows[0].photo };
  }
}

const addMonths = () => {
  const d = new Date(`${todayJakarta()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 3);
  return d.toISOString().slice(0, 10);
};

/** Menyahkan kunci API (header X-Api-Key) menjadi pengguna sistem perusahaan itu */
@Injectable()
export class UtilityIngestGuard implements CanActivate {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly apps: AppsService,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const raw = req.headers['x-api-key'];
    if (!raw || typeof raw !== 'string' || raw.length < 20 || raw.length > 120) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    const [k] = await this.db.select().from(utilityIngestKeys).where(eq(utilityIngestKeys.keyHash, hash(raw)));
    if (!k || k.revokedAt) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    if (!(await this.apps.isEnabled(k.tenantId, ['utility']))) throw new HttpException('Aplikasi Layanan Utilitas belum diaktifkan di perusahaan ini', HttpStatus.FORBIDDEN);
    if ((await this.subs.state(k.tenantId)).readOnly) throw new HttpException('Langganan perusahaan tidak aktif', HttpStatus.PAYMENT_REQUIRED);
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await this.db.update(utilityIngestKeys).set({ lastUsedAt: new Date() }).where(eq(utilityIngestKeys.id, k.id));
    // pencatat = pembuat kunci, jadi verifikasi tetap harus dilakukan orang lain
    req.user = { sub: k.createdById, tenantId: k.tenantId, role: 'WAREHOUSE', email: `kunci-api:${k.keyPrefix}`, emailVerified: true, warehouseIds: [] };
    return true;
  }
}

// ---------- Pengendali ----------
@ApiTags('Layanan utilitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility')
export class UtilityFieldController {
  constructor(private readonly svc: UtilityFieldService, private readonly util: UtilityService) {}

  @Roles('ADMIN', 'WAREHOUSE') @Post('readings/import') import(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) { return this.svc.importRows(u, dto.rows, 'IMPORT'); }
  /** Pencatatan dari HP petugas: sama dengan input biasa tetapi membawa lokasi dan foto meter */
  @Roles('ADMIN', 'WAREHOUSE') @Post('field/readings') field(@CurrentUser() u: AuthUser, @Body() dto: ReadingDto) { return this.util.enterReading(u, dto, 'LAPANGAN'); }
  @Roles('ADMIN', 'WAREHOUSE') @Get('field/route') route(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.fieldRoute(u.tenantId, period); }
  @Get('readings/:id/photo') photo(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.photo(u.tenantId, id); }

  @Roles('ADMIN') @Get('ingest-keys') keys(@CurrentUser() u: AuthUser) { return this.svc.keys(u.tenantId); }
  @Roles('ADMIN') @Post('ingest-keys') createKey(@CurrentUser() u: AuthUser, @Body() dto: IngestKeyDto) { return this.svc.createKey(u, dto); }
  @Roles('ADMIN') @Post('ingest-keys/:id/revoke') revokeKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.revokeKey(u, id); }

  @Roles('ADMIN', 'FINANCE') @Get('counter/search') search(@CurrentUser() u: AuthUser, @Query('q') q: string) { return this.svc.counterSearch(u.tenantId, q ?? ''); }
  @Roles('ADMIN', 'FINANCE') @Post('counter/pay') pay(@CurrentUser() u: AuthUser, @Body() dto: CounterPayDto) { return this.svc.counterPay(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Get('counter/open') open(@CurrentUser() u: AuthUser) { return this.svc.openReceipts(u); }
  @Roles('ADMIN', 'FINANCE') @Post('counter/remit') remit(@CurrentUser() u: AuthUser, @Body() dto: RemitDto) { return this.svc.remit(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('counter/remittances') remittances(@CurrentUser() u: AuthUser) { return this.svc.remittances(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('counter/remittances/:id/decide') decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) { return this.svc.decide(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('counter/controls') controls(@CurrentUser() u: AuthUser) { return this.svc.counterControls(u.tenantId); }
}

/** Penerima angka meter dari alat/gateway: tanpa login, memakai kunci API (header X-Api-Key) */
@ApiTags('Layanan utilitas')
@Public()
@UseGuards(UtilityIngestGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('ingest/utility')
export class UtilityIngestController {
  constructor(private readonly svc: UtilityFieldService) {}
  @Post('readings') receive(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) { return this.svc.importRows(u, dto.rows, 'API'); }
}

@Module({
  imports: [UtilityModule, SalesModule, AccountingModule],
  controllers: [UtilityFieldController, UtilityIngestController],
  providers: [UtilityFieldService, UtilityIngestGuard],
})
export class UtilityFieldModule {}
