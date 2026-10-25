import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { invoices, payments, principalClaimLines, principalClaims, tradeAccruals, tradeTerms } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { TermDto, PeriodQueryDto, SettleDto, GenerateClaimDto, DecideClaimDto, ReceiveClaimDto } from './trade.dto';
import { findOwned, insertOne, lockOwned, patchById } from '../../../db/owned';
import { TradeRepository } from './trade.repository';

const lastDay = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const firstDay = (p: string) => `${p}-01`;

@Injectable()
export class TradeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly repo: TradeRepository,
  ) {}

  // ================= syarat dagang =================
  async terms(tenantId: string, customerId?: string) {
    const rows = await this.repo.listTradeTermsWithCustomersByCustomerIdAndName(this.db, tenantId, customerId);
    return rows.map((r) => ({ ...r.t, customerCode: r.code, customerName: r.name }));
  }

  private async checkTerm(tenantId: string, d: TermDto) {
    const [c] = await this.repo.findCustomersById(this.db, d.customerId, tenantId);
    if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
    const v = D(d.value);
    if (v.lt(0) || (d.kind === 'PCT_SALES' && v.gt(100))) throw new BadRequestException(d.kind === 'PCT_SALES' ? 'Persen harus 0–100' : 'Nilai tidak boleh negatif');
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw new BadRequestException('Tanggal akhir tidak boleh sebelum tanggal mulai');
  }

  async saveTerm(u: AuthUser, d: TermDto, id?: string) {
    await this.checkTerm(u.tenantId, d);
    const values = { customerId: d.customerId, name: d.name.trim(), kind: d.kind, value: D(d.value).toFixed(4), validFrom: d.validFrom ? toDocDate(d.validFrom) : null, validTo: d.validTo ? toDocDate(d.validTo) : null, isActive: d.isActive ?? true };
    if (id) {
      const cur = await findOwned(this.db, tradeTerms, u.tenantId, id);
      if (!cur) throw new NotFoundException('Syarat dagang tidak ditemukan');
      await patchById(this.db, tradeTerms, id, values);
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TradeTerm', entityId: id, data: { before: { value: cur.value, isActive: cur.isActive }, after: values } });
      return { id, ...values };
    }
    const row = await insertOne(this.db, tradeTerms, { tenantId: u.tenantId, createdById: u.sub, ...values });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TradeTerm', entityId: row.id, data: { name: row.name, kind: row.kind, value: row.value } });
    return row;
  }

  async accruals(tenantId: string, q: PeriodQueryDto) {
    const rows = await this.repo.listTradeAccrualsWithTradeTermsAndCustomersByPeriodAndCustomerIdAndNumber(this.db, tenantId, q);
    return rows.map((r) => ({ ...r.a, termName: r.term, customerCode: r.code, customerName: r.name, remaining: D(r.a.amount).minus(r.a.settledAmount).toFixed(2) }));
  }

  /** Tutup bulan syarat dagang: hitung dari penjualan neto outlet bulan itu (DPP faktur − DPP retur) */
  async accrue(u: AuthUser, period: string) {
    if (period >= todayJakarta().slice(0, 7)) throw new BadRequestException('Syarat dagang baru dapat dihitung setelah bulannya berakhir');
    const from = firstDay(period);
    const to = lastDay(period);
    const terms = await this.repo.listTradeTermsByIsActive(this.db, u.tenantId);
    const date = toDocDate(to);
    const made = await this.db.transaction(async (tx) => {
      const out: { id: string; number: string; amount: string; customerId: string }[] = [];
      for (const t of terms) {
        if ((t.validFrom && t.validFrom > to) || (t.validTo && t.validTo < from)) continue;
        const [dup] = await this.repo.findTradeAccrualsByTermIdAndPeriodAndStatus(tx, t.id, period);
        if (dup) continue;
        const sold = await this.repo.queryInvoice(tx, u.tenantId, t.customerId, from, to);
        const ret = await this.repo.querySalesReturn(tx, u.tenantId, t.customerId, from, to);
        const base = D(sold.rows[0].v).minus(ret.rows[0].v);
        const amount = money(t.kind === 'PCT_SALES' ? base.gt(0) ? base.times(t.value).div(100) : 0 : t.value);
        if (amount.lte(0)) continue;
        const number = await this.seq.next(tx, u.tenantId, 'TRADE_ACCRUAL', date);
        const row = await insertOne(tx, tradeAccruals, { tenantId: u.tenantId, number, termId: t.id, customerId: t.customerId, period, baseAmount: money(base.lt(0) ? 0 : base).toFixed(2), amount: amount.toFixed(2), accruedById: u.sub });
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Syarat dagang ${t.name} periode ${period} (${number})`,
          sourceType: 'TRADE_ACCRUAL',
          sourceId: row.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_PROMO, debit: amount }, { key: SYS.TRADE_ACCRUAL_PAYABLE, credit: amount }],
        });
        await patchById(tx, tradeAccruals, row.id, { accrualJournalId: journal.id });
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'POST', entity: 'TradeAccrual', entityId: row.id, data: { number, term: t.name, base: base.toFixed(2), amount: amount.toFixed(2), journal: journal.number } });
        out.push({ id: row.id, number, amount: amount.toFixed(2), customerId: t.customerId });
      }
      return out;
    });
    return { period, created: made.length, total: made.reduce((a, m) => a.plus(m.amount), D(0)).toFixed(2), items: made };
  }

  async settle(u: AuthUser, id: string, dto: SettleDto) {
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const a = await lockOwned(tx, tradeAccruals, u.tenantId, id);
      if (!a) throw new NotFoundException('Utang rebate tidak ditemukan');
      if (a.status !== 'ACCRUED') throw new BadRequestException('Utang rebate ini sudah lunas atau dibatalkan');
      if (a.accruedById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pelunasan dilakukan oleh orang lain dari yang menjurnalkannya (pemisahan fungsi)');
      const remaining = D(a.amount).minus(a.settledAmount);
      if (amount.gt(remaining)) throw new BadRequestException(`Jumlah melebihi sisa utang rebate (${remaining.toFixed(2)})`);
      let journalNumber: string;
      let settleJournalId: string | null = null;
      if (dto.mode === 'DEDUCT') {
        if (!dto.invoiceId) throw new BadRequestException('Pilih faktur yang dipotong');
        await this.repo.queryInvoiceForSettle(tx, dto.invoiceId, u.tenantId);
        const inv = await findOwned(tx, invoices, u.tenantId, dto.invoiceId);
        if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
        if (inv.customerId !== a.customerId) throw new BadRequestException('Faktur harus milik outlet yang sama dengan rebate');
        if (inv.currency !== 'IDR') throw new BadRequestException('Potongan hanya untuk faktur Rupiah');
        const out = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
        if (amount.gt(out)) throw new BadRequestException(`Potongan melebihi sisa tagihan faktur (${out.toFixed(2)})`);
        const number = await this.seq.next(tx, u.tenantId, 'TRADE_SETTLEMENT', date);
        const pay = await insertOne(tx, payments, { tenantId: u.tenantId, number, date, customerId: inv.customerId, invoiceId: inv.id, amount: amount.toFixed(2), method: 'POTONGAN', notes: `Potongan rebate/trade promo ${a.number}` });
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Potongan tagihan ${inv.number} atas rebate ${a.number} (${number})`,
          sourceType: 'PAYMENT',
          sourceId: pay.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_ACCRUAL_PAYABLE, debit: amount }, { key: SYS.AR, credit: amount }],
        });
        await patchById(tx, payments, pay.id, { journalId: journal.id });
        settleJournalId = journal.id;
        const paid = D(inv.paidAmount).plus(amount);
        await patchById(tx, invoices, inv.id, { paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' });
        journalNumber = journal.number;
      } else {
        const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, 'BANK');
        await this.posting.assertCashCovers(tx, u.tenantId, cash, amount);
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Pembayaran rebate/trade promo ${a.number}`,
          sourceType: 'TRADE_SETTLEMENT',
          sourceId: a.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_ACCRUAL_PAYABLE, debit: amount }, { accountId: cash.id, credit: amount, ...(cash.branchId ? { branchId: cash.branchId } : {}) }],
        });
        settleJournalId = journal.id;
        journalNumber = journal.number;
      }
      await this.repo.insertTradeAccrualSettlements(tx, u.tenantId, a.id, date, amount, dto.mode, settleJournalId);
      const settled = D(a.settledAmount).plus(amount);
      await patchById(tx, tradeAccruals, id, { settledAmount: settled.toFixed(2), status: settled.gte(a.amount) ? 'SETTLED' : 'ACCRUED' });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'SETTLE', entity: 'TradeAccrual', entityId: id, data: { number: a.number, mode: dto.mode, amount: amount.toFixed(2), journal: journalNumber } });
      return { id, status: settled.gte(a.amount) ? 'SETTLED' : 'ACCRUED', settled: settled.toFixed(2), journalNumber };
    });
  }

  async voidAccrual(u: AuthUser, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const a = await lockOwned(tx, tradeAccruals, u.tenantId, id);
      if (!a) throw new NotFoundException('Utang rebate tidak ditemukan');
      if (a.status !== 'ACCRUED' || D(a.settledAmount).gt(0)) throw new BadRequestException('Hanya utang rebate yang belum dilunasi sama sekali yang dapat dibatalkan');
      await this.posting.reverse(tx, u.tenantId, a.accrualJournalId!, toDocDate(undefined), u.sub, true);
      await patchById(tx, tradeAccruals, id, { status: 'VOID' });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VOID', entity: 'TradeAccrual', entityId: id, data: { number: a.number, reason } });
      return { id, status: 'VOID' };
    });
  }

  // ================= klaim ke prinsipal =================
  async claims(tenantId: string) {
    const rows = await this.repo.listPrincipalClaimsWithSuppliersByPeriodAndNumber(this.db, tenantId);
    return rows.map((r) => ({ ...r.c, supplierName: r.name }));
  }

  async claim(tenantId: string, id: string) {
    const c = await findOwned(this.db, principalClaims, tenantId, id);
    if (!c) throw new NotFoundException('Klaim tidak ditemukan');
    const lines = await this.repo.listPrincipalClaimLinesByClaimId(this.db, id);
    return { ...c, lines };
  }

  /** Kumpulkan baris pesanan berpromo (difakturkan di bulan itu, belum pernah diklaim) yang didanai prinsipal */
  async generateClaim(u: AuthUser, dto: GenerateClaimDto) {
    if (dto.period >= todayJakarta().slice(0, 7)) throw new BadRequestException('Klaim baru dapat dibuat setelah bulannya berakhir');
    const [sup] = await this.repo.findSuppliersById(this.db, dto.supplierId, u.tenantId);
    if (!sup) throw new BadRequestException('Prinsipal tidak ditemukan');
    const from = firstDay(dto.period);
    const to = lastDay(dto.period);
    return this.db.transaction(async (tx) => {
      const rows = await this.repo.querySalesOrderLine(tx, u.tenantId, sup.id, from, to);
      const items: { orderLineId: string; promoId: string; kind: 'DISCOUNT' | 'BONUS'; invoiceNumber: string; description: string; base: ReturnType<typeof D>; pct: string; amount: ReturnType<typeof D> }[] = [];
      for (const r of rows.rows) {
        const isBonus = r.is_bonus || r.kind === 'BONUS';
        let base;
        if (isBonus) {
          if (r.cost === null) continue; // biaya tidak diketahui: tidak diklaim
          base = D(r.qty).times(r.factor).times(r.cost);
        } else {
          base = D(r.qty).times(r.price).minus(r.line_total);
        }
        // barang yang sudah diretur pelanggan tidak ditagihkan ke prinsipal
        base = money(base.times(r.ret_ratio));
        if (base.lte(0)) continue;
        items.push({ orderLineId: r.line_id, promoId: r.promo_id, kind: isBonus ? 'BONUS' : 'DISCOUNT', invoiceNumber: r.inv_no, description: `${r.promo_name} — ${isBonus ? 'bonus' : 'potongan'} ${r.sku}`, base, pct: r.funded, amount: money(base.times(r.funded).div(100)) });
      }
      const total = items.reduce((a, i) => a.plus(i.amount), D(0));
      if (!items.length || total.lte(0)) throw new BadRequestException('Tidak ada promo yang didanai prinsipal ini pada bulan tersebut (atau sudah diklaim)');
      const number = await this.seq.next(tx, u.tenantId, 'PRINCIPAL_CLAIM', toDocDate(to));
      const claim = await insertOne(tx, principalClaims, { tenantId: u.tenantId, number, supplierId: sup.id, period: dto.period, claimedAmount: total.toFixed(2), createdById: u.sub });
      await tx.insert(principalClaimLines).values(items.map((i) => ({ tenantId: u.tenantId, claimId: claim.id, orderLineId: i.orderLineId, promoId: i.promoId, kind: i.kind, invoiceNumber: i.invoiceNumber, description: i.description, baseValue: i.base.toFixed(2), fundedPct: i.pct, amount: i.amount.toFixed(2) })));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'PrincipalClaim', entityId: claim.id, data: { number, supplier: sup.name, period: dto.period, lines: items.length, claimed: total.toFixed(2) } });
      return { ...claim, lineCount: items.length };
    });
  }

  private async lockClaim(tx: Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const c = await lockOwned(tx, principalClaims, tenantId, id);
    if (!c) throw new NotFoundException('Klaim tidak ditemukan');
    return c;
  }

  async submitClaim(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockClaim(tx, u.tenantId, id);
      if (c.status !== 'DRAFT') throw new BadRequestException('Klaim ini sudah diajukan');
      await patchById(tx, principalClaims, id, { status: 'SUBMITTED' });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'SUBMIT', entity: 'PrincipalClaim', entityId: id, data: { number: c.number } });
      return { id, status: 'SUBMITTED' };
    });
  }

  async decideClaim(u: AuthUser, id: string, dto: DecideClaimDto) {
    const approved = money(dto.approvedAmount);
    return this.db.transaction(async (tx) => {
      const c = await this.lockClaim(tx, u.tenantId, id);
      if (c.status !== 'SUBMITTED') throw new BadRequestException('Klaim harus berstatus diajukan');
      if (c.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Persetujuan dicatat oleh orang lain dari pembuat klaim (pemisahan fungsi)');
      if (approved.lt(0) || approved.gt(c.claimedAmount)) throw new BadRequestException('Jumlah disetujui tidak boleh melebihi jumlah klaim');
      if (approved.isZero()) {
        // ditolak seluruhnya: lepaskan baris agar bisa diklaim ulang dengan dokumen yang benar
        await this.repo.deletePrincipalClaimLinesByClaimId(tx, id);
        await patchById(tx, principalClaims, id, { status: 'REJECTED', principalRef: dto.principalRef, decidedById: u.sub });
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'PrincipalClaim', entityId: id, data: { number: c.number, ref: dto.principalRef } });
        return { id, status: 'REJECTED' };
      }
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: toDocDate(undefined),
        description: `Klaim promo disetujui prinsipal ${c.number}${dto.principalRef ? ` (${dto.principalRef})` : ''}`,
        sourceType: 'PRINCIPAL_CLAIM',
        sourceId: c.id,
        createdById: u.sub,
        lines: [{ key: SYS.PRINCIPAL_CLAIM, debit: approved }, { key: SYS.TRADE_PROMO, credit: approved }],
      });
      await patchById(tx, principalClaims, id, { status: 'APPROVED', approvedAmount: approved.toFixed(2), principalRef: dto.principalRef, approvalJournalId: journal.id, decidedById: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'PrincipalClaim', entityId: id, data: { number: c.number, claimed: c.claimedAmount, approved: approved.toFixed(2), journal: journal.number } });
      return { id, status: 'APPROVED', approved: approved.toFixed(2), journalNumber: journal.number };
    });
  }

  async receiveClaim(u: AuthUser, id: string, dto: ReceiveClaimDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockClaim(tx, u.tenantId, id);
      if (c.status !== 'APPROVED') throw new BadRequestException('Klaim harus berstatus disetujui');
      const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, 'BANK');
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: toDocDate(dto.date),
        description: `Penerimaan klaim promo ${c.number}`,
        sourceType: 'PRINCIPAL_CLAIM_PAYMENT',
        sourceId: c.id,
        createdById: u.sub,
        lines: [{ accountId: cash.id, debit: c.approvedAmount, ...(cash.branchId ? { branchId: cash.branchId } : {}) }, { key: SYS.PRINCIPAL_CLAIM, credit: c.approvedAmount }],
      });
      await patchById(tx, principalClaims, id, { status: 'PAID', paymentJournalId: journal.id, cashAccountId: cash.id });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'RECEIVE', entity: 'PrincipalClaim', entityId: id, data: { number: c.number, amount: c.approvedAmount, journal: journal.number } });
      return { id, status: 'PAID', journalNumber: journal.number };
    });
  }
}
