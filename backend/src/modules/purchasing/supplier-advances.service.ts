import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { assertNotFuture, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { CreateSupplierAdvanceDto, ApplySupplierAdvanceDto, RefundSupplierAdvanceDto, AdvanceQueryDto } from './supplier-advances.dto';
import { SupplierAdvancesRepository } from './supplier-advances.repository';

/** Staf (selain Pemilik/Admin): DP di atas persen ini dari nilai PO butuh persetujuan */
export const ADVANCE_STAFF_MAX_PO_PCT = 30;

/** DP yang belum dipakai lebih lama dari ini muncul di kontrol */
export const ADVANCE_STALE_DAYS = 60;

type AdvanceRow = { id: string; number: string; date: string; supplier_id: string; purchase_order_id: string | null; amount: string; applied_amount: string; refunded_amount: string; status: string; journal_id: string | null };

@Injectable()
export class SupplierAdvancesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly repo: SupplierAdvancesRepository,
  ) {}

  /** Sisa DP milik pemasok yang belum dipakai/dikembalikan */
  private remaining(a: Pick<AdvanceRow, 'amount' | 'applied_amount' | 'refunded_amount'>) {
    return D(a.amount).minus(a.applied_amount).minus(a.refunded_amount);
  }

  async create(user: AuthUser, dto: CreateSupplierAdvanceDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah uang muka harus lebih dari nol');
    assertNotFuture(date, 'Tanggal uang muka');
    const method = dto.method ?? 'TRANSFER';

    const sup = (await this.repo.querySupplier(this.db, dto.supplierId, user.tenantId)).rows[0];
    if (!sup) throw new BadRequestException('Pemasok tidak ditemukan');
    if (!sup.is_active) throw new BadRequestException('Pemasok nonaktif');

    let po: { number: string; total: string; status: string; currency: string } | undefined;
    let existing = D(0);
    if (dto.purchaseOrderId) {
      po = (await this.repo.queryPurchaseOrder(this.db, dto.purchaseOrderId, user.tenantId)).rows[0] as typeof po & { supplier_id: string };
      if (!po) throw new BadRequestException('Pesanan pembelian tidak ditemukan');
      if ((po as unknown as { supplier_id: string }).supplier_id !== sup.id) throw new BadRequestException('Pesanan pembelian itu bukan milik pemasok yang dipilih');
      if (po.status !== 'CONFIRMED') throw new BadRequestException(`Uang muka hanya untuk pesanan pembelian yang sudah dikonfirmasi dan belum difakturkan (status sekarang ${po.status})`);
      if (po.currency !== 'IDR') throw new BadRequestException('Uang muka untuk pesanan pembelian mata uang asing belum didukung');
      existing = D((await this.repo.querySupplierAdvance(this.db, dto.purchaseOrderId, user.tenantId)).rows[0].s);
      if (existing.plus(amount).gt(po.total)) {
        throw new BadRequestException(`Uang muka melebihi nilai pesanan ${po.number}: sudah ${existing.toFixed(2)}, nilai pesanan ${D(po.total).toFixed(2)}`);
      }
    }

    // Gerbang persetujuan: sama dengan pembayaran hutang, ditambah aturan khusus uang muka
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const reasons: string[] = [];
      const limit = await this.approvals.needs(this.db, user, 'SUPPLIER_PAYMENT', amount.toNumber());
      if (limit !== null) reasons.push('nilai mencapai batas persetujuan pembayaran');
      if (!po) reasons.push('tanpa pesanan pembelian');
      else if (existing.plus(amount).gt(D(po.total).times(ADVANCE_STAFF_MAX_PO_PCT).div(100))) reasons.push(`melebihi ${ADVANCE_STAFF_MAX_PO_PCT}% nilai pesanan ${po.number}`);
      const pol = await this.approvals.policy(this.db, user.tenantId);
      if (pol.bankChangeHoldDays > 0 && sup.bank_changed_at && Date.now() - new Date(sup.bank_changed_at).getTime() < pol.bankChangeHoldDays * 86_400_000) {
        reasons.push(`rekening pemasok baru diubah (≤ ${pol.bankChangeHoldDays} hari)`);
      }
      if (pol.firstSupplierPayment) {
        const n = (await this.repo.queryCreate(this.db, user.tenantId, sup.id)).rows[0].n;
        if (n === 0) reasons.push('pembayaran pertama ke pemasok ini');
      }
      if (reasons.length) {
        const req = await this.approvals.create(this.db, user, {
          kind: 'SUPPLIER_ADVANCE',
          refId: null,
          title: `Uang muka ke pemasok ${sup.code}${po ? ` untuk ${po.number}` : ''}: ${reasons.join('; ')}`,
          amount: amount.toNumber(),
          payload: JSON.parse(JSON.stringify(dto)),
        });
        throw this.approvals.required(req.id, `Uang muka ini memerlukan persetujuan (${reasons.join('; ')}); permintaan dikirim ke pemilik atau admin.`);
      }
    }

    return this.db.transaction(async (tx) => {
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, method === 'CASH' ? 'CASH' : 'BANK');
      await this.posting.assertCashCovers(tx, user.tenantId, cash, amount);
      const number = await this.seq.next(tx, user.tenantId, 'SUPPLIER_ADVANCE', date);
      const adv = (await tx.execute<{ id: string }>(sql`
        INSERT INTO supplier_advances (tenant_id, number, date, supplier_id, purchase_order_id, method, cash_account_id, amount, description, created_by_id)
        VALUES (${user.tenantId}, ${number}, ${date}, ${sup.id}, ${dto.purchaseOrderId ?? null}, ${method}, ${cash.id}, ${amount.toFixed(2)}, ${dto.description?.trim() || null}, ${user.sub}) RETURNING id`)).rows[0];
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Uang muka ${number} - ${sup.name}${po ? ` · ${po.number}` : ''}`.slice(0, 500),
        sourceType: 'SUPPLIER_ADVANCE',
        sourceId: adv.id,
        createdById: user.sub,
        lines: [
          { key: SYS.SUPPLIER_ADVANCE, debit: amount },
          { accountId: cash.id, credit: amount },
        ],
      });
      await this.repo.queryCreateForCreate(tx, journal.id, adv.id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'SupplierAdvance', entityId: adv.id, data: { number, supplier: sup.code, po: po?.number ?? null, amount: amount.toFixed(2) } });
      return { id: adv.id, number, status: 'OPEN', amount: amount.toFixed(2), journalNumber: journal.number };
    });
  }

  /** Perhitungkan sisa uang muka ke faktur pembelian pemasok yang sama */
  async apply(user: AuthUser, id: string, dto: ApplySupplierAdvanceDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
    assertNotFuture(date, 'Tanggal pemakaian');
    return this.db.transaction(async (tx) => {
      await this.repo.querySupplierAdvanceForApply(tx, id, user.tenantId);
      const a = (await tx.execute<AdvanceRow>(sql`SELECT * FROM supplier_advances WHERE id = ${id} AND tenant_id = ${user.tenantId}`)).rows[0];
      if (!a) throw new NotFoundException('Uang muka tidak ditemukan');
      if (a.status !== 'OPEN') throw new BadRequestException(a.status === 'VOID' ? 'Uang muka ini sudah dibatalkan' : 'Uang muka ini sudah habis dipakai/dikembalikan');
      if (date < a.date) throw new BadRequestException('Tanggal pemakaian tidak boleh sebelum tanggal uang muka');
      const left = this.remaining(a);
      if (amount.gt(left)) throw new BadRequestException(`Melebihi sisa uang muka (${left.toFixed(2)})`);

      await this.repo.queryPurchaseInvoice(tx, dto.purchaseInvoiceId, user.tenantId);
      const inv = (await this.repo.queryPurchaseInvoiceForApply(tx, dto.purchaseInvoiceId, user.tenantId)).rows[0];
      if (!inv) throw new NotFoundException('Faktur pembelian tidak ditemukan');
      if (inv.supplier_id !== a.supplier_id) throw new BadRequestException('Uang muka hanya bisa dipakai untuk faktur pemasok yang sama');
      if (inv.currency !== 'IDR') throw new BadRequestException('Pemakaian uang muka untuk faktur mata uang asing belum didukung');
      if (a.purchase_order_id && inv.purchase_order_id !== a.purchase_order_id) throw new BadRequestException('Uang muka ini untuk pesanan pembelian tertentu; hanya bisa dipakai ke faktur dari pesanan itu');
      const outstanding = D(inv.total).minus(inv.paid_amount).minus(inv.returned_amount);
      if (outstanding.lte(0)) throw new BadRequestException('Faktur ini sudah lunas');
      if (amount.gt(outstanding)) throw new BadRequestException(`Melebihi sisa hutang faktur (${outstanding.toFixed(2)})`);

      const number = await this.seq.next(tx, user.tenantId, 'SUPPLIER_ADVANCE_MOVE', date);
      const mv = (await tx.execute<{ id: string }>(sql`
        INSERT INTO supplier_advance_movements (tenant_id, advance_id, kind, number, date, amount, purchase_invoice_id, created_by_id)
        VALUES (${user.tenantId}, ${a.id}, 'APPLY', ${number}, ${date}, ${amount.toFixed(2)}, ${inv.id}, ${user.sub}) RETURNING id`)).rows[0];
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pakai uang muka ${a.number} untuk faktur ${inv.number} (${number})`.slice(0, 500),
        sourceType: 'SUPPLIER_ADVANCE_APPLY',
        sourceId: mv.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AP, debit: amount },
          { key: SYS.SUPPLIER_ADVANCE, credit: amount },
        ],
      });
      await this.repo.queryApply(tx, journal.id, mv.id);
      const paid = D(inv.paid_amount).plus(amount);
      await tx.execute(sql`UPDATE purchase_invoices SET paid_amount = ${paid.toFixed(2)}, status = ${paid.plus(inv.returned_amount).gte(inv.total) ? 'PAID' : 'PARTIAL'}::invoice_status WHERE id = ${inv.id}`);
      const applied = D(a.applied_amount).plus(amount);
      const closed = D(a.amount).minus(applied).minus(a.refunded_amount).lte(0);
      await tx.execute(sql`UPDATE supplier_advances SET applied_amount = ${applied.toFixed(2)}, status = ${closed ? 'CLOSED' : 'OPEN'} WHERE id = ${a.id}`);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'APPLY', entity: 'SupplierAdvance', entityId: a.id, data: { advance: a.number, invoice: inv.number, amount: amount.toFixed(2) } });
      return { id: a.id, movement: number, invoice: inv.number, applied: amount.toFixed(2), remaining: left.minus(amount).toFixed(2), journalNumber: journal.number };
    });
  }

  /** Pemasok mengembalikan sisa uang muka (uang masuk kembali ke kas/bank) */
  async refund(user: AuthUser, id: string, dto: RefundSupplierAdvanceDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
    assertNotFuture(date, 'Tanggal pengembalian');
    return this.db.transaction(async (tx) => {
      await this.repo.querySupplierAdvanceForApply(tx, id, user.tenantId);
      const a = (await tx.execute<AdvanceRow & { cash_account_id: string; method: string }>(sql`SELECT * FROM supplier_advances WHERE id = ${id} AND tenant_id = ${user.tenantId}`)).rows[0];
      if (!a) throw new NotFoundException('Uang muka tidak ditemukan');
      if (a.status !== 'OPEN') throw new BadRequestException(a.status === 'VOID' ? 'Uang muka ini sudah dibatalkan' : 'Uang muka ini sudah habis dipakai/dikembalikan');
      if (date < a.date) throw new BadRequestException('Tanggal pengembalian tidak boleh sebelum tanggal uang muka');
      const left = this.remaining(a);
      if (amount.gt(left)) throw new BadRequestException(`Melebihi sisa uang muka (${left.toFixed(2)})`);
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId ?? a.cash_account_id, 'BANK');
      const number = await this.seq.next(tx, user.tenantId, 'SUPPLIER_ADVANCE_MOVE', date);
      const mv = (await tx.execute<{ id: string }>(sql`
        INSERT INTO supplier_advance_movements (tenant_id, advance_id, kind, number, date, amount, cash_account_id, note, created_by_id)
        VALUES (${user.tenantId}, ${a.id}, 'REFUND', ${number}, ${date}, ${amount.toFixed(2)}, ${cash.id}, ${dto.note.trim()}, ${user.sub}) RETURNING id`)).rows[0];
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pengembalian uang muka ${a.number} (${number}): ${dto.note.trim()}`.slice(0, 500),
        sourceType: 'SUPPLIER_ADVANCE_REFUND',
        sourceId: mv.id,
        createdById: user.sub,
        lines: [
          { accountId: cash.id, debit: amount },
          { key: SYS.SUPPLIER_ADVANCE, credit: amount },
        ],
      });
      await this.repo.queryApply(tx, journal.id, mv.id);
      const refunded = D(a.refunded_amount).plus(amount);
      const closed = D(a.amount).minus(a.applied_amount).minus(refunded).lte(0);
      await tx.execute(sql`UPDATE supplier_advances SET refunded_amount = ${refunded.toFixed(2)}, status = ${closed ? 'CLOSED' : 'OPEN'} WHERE id = ${a.id}`);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'REFUND', entity: 'SupplierAdvance', entityId: a.id, data: { advance: a.number, amount: amount.toFixed(2), note: dto.note.trim() } });
      return { id: a.id, movement: number, refunded: amount.toFixed(2), remaining: left.minus(amount).toFixed(2), journalNumber: journal.number };
    });
  }

  /** Batalkan uang muka yang salah catat: hanya bila belum dipakai/dikembalikan dan belum dicocokkan dengan mutasi bank; jurnal dibalik */
  async void(user: AuthUser, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      await this.repo.querySupplierAdvanceForApply(tx, id, user.tenantId);
      const a = (await tx.execute<AdvanceRow>(sql`SELECT * FROM supplier_advances WHERE id = ${id} AND tenant_id = ${user.tenantId}`)).rows[0];
      if (!a) throw new NotFoundException('Uang muka tidak ditemukan');
      if (a.status === 'VOID') throw new BadRequestException('Uang muka ini sudah dibatalkan');
      if (D(a.applied_amount).gt(0) || D(a.refunded_amount).gt(0)) throw new BadRequestException('Uang muka yang sudah dipakai atau dikembalikan tidak bisa dibatalkan');
      if (!a.journal_id) throw new BadRequestException('Uang muka belum punya jurnal');
      const matched = await this.repo.queryVoid(tx, a.journal_id);
      if (matched.rows[0].n > 0) throw new BadRequestException('Uang muka ini sudah dicocokkan dengan mutasi bank. Batalkan pencocokannya di Rekonsiliasi Bank dulu');
      const rev = await this.posting.reverse(tx, user.tenantId, a.journal_id, todayJakarta(), user.sub, true);
      await this.repo.queryVoidForVoid(tx, user.sub, reason, rev.id, a.id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'VOID', entity: 'SupplierAdvance', entityId: a.id, data: { number: a.number, amount: a.amount, reason: reason.trim() } });
      return { id: a.id, number: a.number, status: 'VOID', reversalJournal: rev.number };
    });
  }

  async list(tenantId: string, q: AdvanceQueryDto) {
    const r = await this.repo.querySupplierAdvanceForList(this.db, tenantId, q);
    return r.rows;
  }

  async get(tenantId: string, id: string) {
    const head = (await this.list(tenantId, {})).find((x) => (x as { id: string }).id === id);
    if (!head) throw new NotFoundException('Uang muka tidak ditemukan');
    const moves = (await this.repo.querySupplierAdvanceMovement(this.db, tenantId, id)).rows;
    return { ...head, movements: moves };
  }

  /** Saldo uang muka terbuka per pemasok */
  async summary(tenantId: string) {
    const r = await this.repo.querySupplierAdvanceForSummary(this.db, tenantId);
    const total = r.rows.reduce((t, x) => t.plus(x.open), D(0));
    return { total: total.toFixed(2), suppliers: r.rows };
  }

  /** Temuan untuk pemeriksa: uang keluar tanpa barang yang perlu ditindaklanjuti */
  async controls(tenantId: string) {
    const rows = (await this.repo.querySupplierAdvanceForControls(this.db, tenantId)).rows;
    const today = todayJakarta();
    const item = (r: (typeof rows)[number], extra: Record<string, unknown> = {}) => ({ number: r.number, supplier: r.supplier, date: r.date, remaining: r.remaining, ...extra });
    return [
      { key: 'STALE', title: `Uang muka belum dipakai lebih dari ${ADVANCE_STALE_DAYS} hari`, severity: 'high', items: rows.filter((r) => diffDays(r.date, today) > ADVANCE_STALE_DAYS).map((r) => item(r, { days: diffDays(r.date, today) })) },
      { key: 'NO_PO', title: 'Uang muka tanpa pesanan pembelian', severity: 'medium', items: rows.filter((r) => !r.po).map((r) => item(r)) },
      { key: 'PO_BILLED', title: 'Pesanan sudah difakturkan tetapi uang mukanya belum diperhitungkan', severity: 'high', items: rows.filter((r) => r.poStatus === 'BILLED').map((r) => item(r, { po: r.po })) },
      { key: 'INVOICE_OPEN', title: 'Pemasok punya faktur terbuka padahal uang muka belum diperhitungkan', severity: 'medium', items: rows.filter((r) => D(r.openInvoices).gt(0)).map((r) => item(r, { openInvoices: r.openInvoices })) },
    ];
  }
}
