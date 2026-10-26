import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ADJUSTMENT_ADMIN_THRESHOLD, ADJUSTMENT_KIND_LABELS, ADJUSTMENT_REVENUE_KEY, splitReduction } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SYS, type SystemKey } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { AdjustmentDto, DecideAdjustmentDto, RejectAdjustmentDto } from './adjustments.dto';
import { AdjustmentsRepository, InvoiceFacts } from './adjustments.repository';

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const openOf = (i: InvoiceFacts) => Number(i.total) - Number(i.paid_amount) - Number(i.returned_amount);

/**
 * Koreksi tagihan dan pemutihan denda. Diajukan satu orang, disetujui orang lain; baru saat disetujui nota kredit dibuat dan dijurnal
 * (Dr pendapatan, Dr PPN keluaran bila ada | Cr piutang) sehingga laporan piutang, pendapatan, dan PPN ikut berubah.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: AdjustmentsRepository,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) { return this.repo.list(this.db, tenantId, status || undefined); }
  invoices(tenantId: string, q: string) { return q.trim().length < 2 ? [] : this.repo.searchInvoices(this.db, tenantId, q); }
  async summary(tenantId: string) { const s = await this.repo.summary(this.db, tenantId); return { pending: s?.pending ?? 0, pendingAmount: Number(s?.pending_amount ?? 0), approved30d: Number(s?.approved_30d ?? 0) }; }

  async request(u: AuthUser, dto: AdjustmentDto) {
    const inv = await this.repo.invoice(this.db, u.tenantId, dto.invoiceId);
    if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
    if (!inv.is_utility) throw new BadRequestException('Koreksi ini hanya untuk tagihan air atau layanan non-air');
    const open = openOf(inv);
    if (open <= 0.5) throw new BadRequestException('Tagihan ini sudah lunas atau tidak punya sisa untuk dikoreksi');
    const reservedAny = await this.repo.pending(this.db, u.tenantId, inv.id);
    const room = open - reservedAny;
    let amount: number;
    if (dto.kind === 'PEMBATALAN') {
      if (Number(inv.paid_amount) > 0 || Number(inv.returned_amount) > 0) throw new BadRequestException('Tagihan yang sudah dibayar sebagian tidak bisa dibatalkan penuh; gunakan koreksi pemakaian atau kembalikan pembayaran');
      if (reservedAny > 0) throw new BadRequestException('Masih ada pengajuan koreksi lain pada tagihan ini yang menunggu persetujuan');
      amount = open;
    } else {
      if (!dto.amount) throw new BadRequestException('Isi jumlah pengurangan');
      amount = money(dto.amount).toNumber();
      if (!(amount > 0)) throw new BadRequestException('Jumlah harus lebih dari 0');
    }
    if (amount > room + 0.005) throw new BadRequestException(`Jumlah melebihi sisa tagihan yang dapat dikoreksi (${rp(room)})`);
    if (dto.kind === 'PEMUTIHAN_DENDA') {
      const lateFee = Number(inv.late_fee_lines);
      const used = await this.repo.reserved(this.db, u.tenantId, inv.id, 'PEMUTIHAN_DENDA');
      if (lateFee <= 0) throw new BadRequestException('Tagihan ini tidak memuat denda keterlambatan');
      if (amount > lateFee - used + 0.005) throw new BadRequestException(`Pemutihan melebihi denda yang tercantum (${rp(lateFee - used)} tersisa)`);
    }
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_ADJUSTMENT', toDocDate(undefined));
      const id = await this.repo.insert(tx, { tenantId: u.tenantId, number, invoiceId: inv.id, connectionId: await this.repo.connectionOf(tx, u.tenantId, inv.id), kind: dto.kind, amount: amount.toFixed(2), reason: dto.reason.trim(), requestedById: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityAdjustment', entityId: id, data: { number, kind: dto.kind, invoice: inv.number, amount } });
      return this.repo.byId(tx, u.tenantId, id);
    });
  }

  async approve(u: AuthUser, id: string, dto: DecideAdjustmentDto) {
    const adj = await this.repo.byId(this.db, u.tenantId, id);
    if (!adj) throw new NotFoundException('Pengajuan tidak ditemukan');
    if (adj.status !== 'DIAJUKAN') throw new BadRequestException('Pengajuan ini sudah diputuskan');
    if (adj.requested_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pengajuan harus disetujui orang lain dari pengaju (pemisahan fungsi)');
    const amount = Number(adj.amount);
    if (amount >= ADJUSTMENT_ADMIN_THRESHOLD && !['OWNER', 'ADMIN'].includes(u.role)) throw new ForbiddenException(`Koreksi mulai ${rp(ADJUSTMENT_ADMIN_THRESHOLD)} harus disetujui Admin atau Pemilik`);
    const revenueKey = ADJUSTMENT_REVENUE_KEY[adj.kind as keyof typeof ADJUSTMENT_REVENUE_KEY] as SystemKey;
    await this.posting.ensureSystemAccounts(this.db, u.tenantId, [revenueKey, SYS.AR, SYS.VAT_OUT]);
    const result = await this.db.transaction(async (tx) => {
      const inv = await this.repo.invoice(tx, u.tenantId, adj.invoice_id, true);
      if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
      if (amount > openOf(inv) + 0.005) throw new BadRequestException(`Sisa tagihan kini ${rp(openOf(inv))}, lebih kecil dari koreksi yang diajukan; tolak dan ajukan ulang`);
      const warehouseId = await this.repo.defaultWarehouse(tx, u.tenantId);
      if (!warehouseId) throw new BadRequestException('Gudang belum tersedia');
      const date = toDocDate(undefined);
      const { dpp, tax } = splitReduction(amount, Number(inv.subtotal), Number(inv.tax_amount));
      const number = await this.seq.next(tx, u.tenantId, 'SALES_RETURN', date);
      const returnId = await this.repo.insertCreditNote(tx, { tenantId: u.tenantId, number, date, invoiceId: inv.id, customerId: inv.customer_id, warehouseId, reason: `Nota kredit ${adj.number}: ${ADJUSTMENT_KIND_LABELS[adj.kind as keyof typeof ADJUSTMENT_KIND_LABELS]} — ${adj.reason}`.slice(0, 480), subtotal: dpp.toFixed(2), tax: tax.toFixed(2), total: amount.toFixed(2) });
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId, date, description: `Nota kredit ${number} atas ${inv.number}: ${ADJUSTMENT_KIND_LABELS[adj.kind as keyof typeof ADJUSTMENT_KIND_LABELS]}`, sourceType: 'SALES_RETURN', sourceId: returnId, createdById: u.sub,
        lines: [{ key: revenueKey, debit: D(dpp) }, ...(tax > 0 ? [{ key: SYS.VAT_OUT, debit: D(tax) }] : []), { key: SYS.AR, credit: D(amount) }],
      });
      await this.repo.linkCreditNoteJournal(tx, u.tenantId, returnId, journal.id);
      await this.repo.applyToInvoice(tx, u.tenantId, inv.id, amount.toFixed(2));
      await this.repo.decide(tx, u.tenantId, id, 'DISETUJUI', u.sub, dto.note?.trim() || null, returnId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityAdjustment', entityId: id, data: { number: adj.number, kind: adj.kind, invoice: inv.number, amount, creditNote: number, journal: journal.number } });
      return { creditNote: number, journal: journal.number };
    });
    return { ...(await this.repo.byId(this.db, u.tenantId, id)), ...result };
  }

  async reject(u: AuthUser, id: string, dto: RejectAdjustmentDto) {
    const adj = await this.repo.byId(this.db, u.tenantId, id);
    if (!adj) throw new NotFoundException('Pengajuan tidak ditemukan');
    if (adj.status !== 'DIAJUKAN') throw new BadRequestException('Pengajuan ini sudah diputuskan');
    await this.repo.decide(this.db, u.tenantId, id, 'DITOLAK', u.sub, dto.note.trim(), null);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'UtilityAdjustment', entityId: id, data: { number: adj.number } });
    return this.repo.byId(this.db, u.tenantId, id);
  }
}
