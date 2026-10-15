/**
 * Modern trade: syarat dagang peritel (rebate/back margin % penjualan neto, biaya tetap bulanan seperti listing/merchandising) dan
 * klaim biaya promo ke prinsipal.
 *
 * Syarat dagang: tutup bulan menjurnal Dr Beban Trade Promo | Cr Utang Rebate & Trade Promo Outlet; utang itu dilunasi dengan memotong
 * tagihan outlet (Dr Utang Rebate | Cr Piutang Usaha, tercatat sebagai potongan pada faktur) atau dibayar tunai.
 * Klaim prinsipal: baris pesanan berpromo yang didanai prinsipal dikumpulkan per bulan; tiap baris hanya bisa diklaim sekali;
 * disetujui prinsipal → Dr Piutang Klaim | Cr Beban Trade Promo; diterima → Dr Kas/Bank | Cr Piutang Klaim.
 * Pencegahan kecurangan: syarat dagang hanya diubah Admin; yang menjurnalkan berbeda dari yang melunasi/memutuskan (Pemilik
 * dikecualikan); satu syarat satu kali per bulan; potongan tagihan tidak melebihi sisa utang rebate maupun sisa tagihan; klaim
 * tidak bisa menggandakan baris; semuanya di jejak audit.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, invoices, payments, principalClaimLines, principalClaims, suppliers, tradeAccruals, tradeTerms } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const firstDay = (p: string) => `${p}-01`;
const dupKey = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505';

export class TermDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: 'Rebate pencapaian 2%' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: ['PCT_SALES', 'FIXED_MONTHLY'] }) @IsIn(['PCT_SALES', 'FIXED_MONTHLY']) kind: 'PCT_SALES' | 'FIXED_MONTHLY';
  @ApiProperty({ example: '2', description: 'PCT_SALES: persen penjualan neto; FIXED_MONTHLY: rupiah per bulan' }) @IsNumberString() value: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class PeriodDto {
  @ApiProperty({ example: '2026-09' }) @Matches(PERIOD) period: string;
}
export class PeriodQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}
export class SettleDto {
  @ApiProperty({ enum: ['DEDUCT', 'PAY'], description: 'DEDUCT = potong tagihan outlet; PAY = bayar tunai ke outlet' }) @IsIn(['DEDUCT', 'PAY']) mode: 'DEDUCT' | 'PAY';
  @ApiProperty({ example: '500000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ description: 'Wajib untuk DEDUCT' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
export class VoidDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}
export class GenerateClaimDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty({ example: '2026-09' }) @Matches(PERIOD) period: string;
}
export class DecideClaimDto {
  @ApiProperty({ example: '1500000', description: 'Jumlah yang disetujui prinsipal (0 = ditolak)' }) @IsNumberString() approvedAmount: string;
  @ApiPropertyOptional({ description: 'Nomor persetujuan/nota kredit dari prinsipal' }) @IsOptional() @IsString() @MaxLength(60) principalRef?: string;
}
export class ReceiveClaimDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

@Injectable()
export class TradeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  // ================= syarat dagang =================
  async terms(tenantId: string, customerId?: string) {
    const rows = await this.db
      .select({ t: tradeTerms, code: customers.code, name: customers.name })
      .from(tradeTerms)
      .innerJoin(customers, eq(customers.id, tradeTerms.customerId))
      .where(and(eq(tradeTerms.tenantId, tenantId), customerId ? eq(tradeTerms.customerId, customerId) : undefined))
      .orderBy(customers.name, tradeTerms.name);
    return rows.map((r) => ({ ...r.t, customerCode: r.code, customerName: r.name }));
  }

  private async checkTerm(tenantId: string, d: TermDto) {
    const [c] = await this.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, d.customerId), eq(customers.tenantId, tenantId)));
    if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
    const v = D(d.value);
    if (v.lt(0) || (d.kind === 'PCT_SALES' && v.gt(100))) throw new BadRequestException(d.kind === 'PCT_SALES' ? 'Persen harus 0–100' : 'Nilai tidak boleh negatif');
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw new BadRequestException('Tanggal akhir tidak boleh sebelum tanggal mulai');
  }

  async saveTerm(u: AuthUser, d: TermDto, id?: string) {
    await this.checkTerm(u.tenantId, d);
    const values = { customerId: d.customerId, name: d.name.trim(), kind: d.kind, value: D(d.value).toFixed(4), validFrom: d.validFrom ? toDocDate(d.validFrom) : null, validTo: d.validTo ? toDocDate(d.validTo) : null, isActive: d.isActive ?? true };
    if (id) {
      const [cur] = await this.db.select().from(tradeTerms).where(and(eq(tradeTerms.id, id), eq(tradeTerms.tenantId, u.tenantId)));
      if (!cur) throw new NotFoundException('Syarat dagang tidak ditemukan');
      await this.db.update(tradeTerms).set(values).where(eq(tradeTerms.id, id));
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TradeTerm', entityId: id, data: { before: { value: cur.value, isActive: cur.isActive }, after: values } });
      return { id, ...values };
    }
    const [row] = await this.db.insert(tradeTerms).values({ tenantId: u.tenantId, createdById: u.sub, ...values }).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TradeTerm', entityId: row.id, data: { name: row.name, kind: row.kind, value: row.value } });
    return row;
  }

  async accruals(tenantId: string, q: PeriodQueryDto) {
    const rows = await this.db
      .select({ a: tradeAccruals, term: tradeTerms.name, code: customers.code, name: customers.name })
      .from(tradeAccruals)
      .innerJoin(tradeTerms, eq(tradeTerms.id, tradeAccruals.termId))
      .innerJoin(customers, eq(customers.id, tradeAccruals.customerId))
      .where(and(eq(tradeAccruals.tenantId, tenantId), q.period ? eq(tradeAccruals.period, q.period) : undefined, q.customerId ? eq(tradeAccruals.customerId, q.customerId) : undefined))
      .orderBy(desc(tradeAccruals.period), desc(tradeAccruals.number))
      .limit(500);
    return rows.map((r) => ({ ...r.a, termName: r.term, customerCode: r.code, customerName: r.name, remaining: D(r.a.amount).minus(r.a.settledAmount).toFixed(2) }));
  }

  /** Tutup bulan syarat dagang: hitung dari penjualan neto outlet bulan itu (DPP faktur − DPP retur) */
  async accrue(u: AuthUser, period: string) {
    if (period >= todayJakarta().slice(0, 7)) throw new BadRequestException('Syarat dagang baru dapat dihitung setelah bulannya berakhir');
    const from = firstDay(period);
    const to = lastDay(period);
    const terms = await this.db.select().from(tradeTerms).where(and(eq(tradeTerms.tenantId, u.tenantId), eq(tradeTerms.isActive, true)));
    const date = toDocDate(to);
    const made = await this.db.transaction(async (tx) => {
      const out: { id: string; number: string; amount: string; customerId: string }[] = [];
      for (const t of terms) {
        if ((t.validFrom && t.validFrom > to) || (t.validTo && t.validTo < from)) continue;
        const [dup] = await tx.select({ id: tradeAccruals.id }).from(tradeAccruals).where(and(eq(tradeAccruals.termId, t.id), eq(tradeAccruals.period, period), sql`${tradeAccruals.status} <> 'VOID'`));
        if (dup) continue;
        const sold = await tx.execute<{ v: string }>(sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM invoices WHERE tenant_id = ${u.tenantId} AND customer_id = ${t.customerId} AND kind <> 'SERVICE' AND date >= ${from} AND date <= ${to}`);
        const ret = await tx.execute<{ v: string }>(sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM sales_returns WHERE tenant_id = ${u.tenantId} AND customer_id = ${t.customerId} AND date >= ${from} AND date <= ${to}`);
        const base = D(sold.rows[0].v).minus(ret.rows[0].v);
        const amount = money(t.kind === 'PCT_SALES' ? base.gt(0) ? base.times(t.value).div(100) : 0 : t.value);
        if (amount.lte(0)) continue;
        const number = await this.seq.next(tx, u.tenantId, 'TRADE_ACCRUAL', date);
        const [row] = await tx.insert(tradeAccruals).values({ tenantId: u.tenantId, number, termId: t.id, customerId: t.customerId, period, baseAmount: money(base.lt(0) ? 0 : base).toFixed(2), amount: amount.toFixed(2), accruedById: u.sub }).returning();
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Syarat dagang ${t.name} periode ${period} (${number})`,
          sourceType: 'TRADE_ACCRUAL',
          sourceId: row.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_PROMO, debit: amount }, { key: SYS.TRADE_ACCRUAL_PAYABLE, credit: amount }],
        });
        await tx.update(tradeAccruals).set({ accrualJournalId: journal.id }).where(eq(tradeAccruals.id, row.id));
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
      const [a] = await tx.select().from(tradeAccruals).where(and(eq(tradeAccruals.id, id), eq(tradeAccruals.tenantId, u.tenantId))).for('update');
      if (!a) throw new NotFoundException('Utang rebate tidak ditemukan');
      if (a.status !== 'ACCRUED') throw new BadRequestException('Utang rebate ini sudah lunas atau dibatalkan');
      if (a.accruedById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pelunasan dilakukan oleh orang lain dari yang menjurnalkannya (pemisahan fungsi)');
      const remaining = D(a.amount).minus(a.settledAmount);
      if (amount.gt(remaining)) throw new BadRequestException(`Jumlah melebihi sisa utang rebate (${remaining.toFixed(2)})`);
      let journalNumber: string;
      if (dto.mode === 'DEDUCT') {
        if (!dto.invoiceId) throw new BadRequestException('Pilih faktur yang dipotong');
        await tx.execute(sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${u.tenantId} FOR UPDATE`);
        const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, u.tenantId)));
        if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
        if (inv.customerId !== a.customerId) throw new BadRequestException('Faktur harus milik outlet yang sama dengan rebate');
        if (inv.currency !== 'IDR') throw new BadRequestException('Potongan hanya untuk faktur Rupiah');
        const out = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
        if (amount.gt(out)) throw new BadRequestException(`Potongan melebihi sisa tagihan faktur (${out.toFixed(2)})`);
        const number = await this.seq.next(tx, u.tenantId, 'TRADE_SETTLEMENT', date);
        const [pay] = await tx.insert(payments).values({ tenantId: u.tenantId, number, date, customerId: inv.customerId, invoiceId: inv.id, amount: amount.toFixed(2), method: 'POTONGAN', notes: `Potongan rebate/trade promo ${a.number}` }).returning();
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Potongan tagihan ${inv.number} atas rebate ${a.number} (${number})`,
          sourceType: 'PAYMENT',
          sourceId: pay.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_ACCRUAL_PAYABLE, debit: amount }, { key: SYS.AR, credit: amount }],
        });
        await tx.update(payments).set({ journalId: journal.id }).where(eq(payments.id, pay.id));
        const paid = D(inv.paidAmount).plus(amount);
        await tx.update(invoices).set({ paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' }).where(eq(invoices.id, inv.id));
        journalNumber = journal.number;
      } else {
        const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, 'BANK');
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Pembayaran rebate/trade promo ${a.number}`,
          sourceType: 'TRADE_SETTLEMENT',
          sourceId: a.id,
          createdById: u.sub,
          lines: [{ key: SYS.TRADE_ACCRUAL_PAYABLE, debit: amount }, { accountId: cash.id, credit: amount, ...(cash.branchId ? { branchId: cash.branchId } : {}) }],
        });
        journalNumber = journal.number;
      }
      const settled = D(a.settledAmount).plus(amount);
      await tx.update(tradeAccruals).set({ settledAmount: settled.toFixed(2), status: settled.gte(a.amount) ? 'SETTLED' : 'ACCRUED' }).where(eq(tradeAccruals.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'SETTLE', entity: 'TradeAccrual', entityId: id, data: { number: a.number, mode: dto.mode, amount: amount.toFixed(2), journal: journalNumber } });
      return { id, status: settled.gte(a.amount) ? 'SETTLED' : 'ACCRUED', settled: settled.toFixed(2), journalNumber };
    });
  }

  async voidAccrual(u: AuthUser, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(tradeAccruals).where(and(eq(tradeAccruals.id, id), eq(tradeAccruals.tenantId, u.tenantId))).for('update');
      if (!a) throw new NotFoundException('Utang rebate tidak ditemukan');
      if (a.status !== 'ACCRUED' || D(a.settledAmount).gt(0)) throw new BadRequestException('Hanya utang rebate yang belum dilunasi sama sekali yang dapat dibatalkan');
      await this.posting.reverse(tx, u.tenantId, a.accrualJournalId!, toDocDate(undefined), u.sub, true);
      await tx.update(tradeAccruals).set({ status: 'VOID' }).where(eq(tradeAccruals.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VOID', entity: 'TradeAccrual', entityId: id, data: { number: a.number, reason } });
      return { id, status: 'VOID' };
    });
  }

  // ================= klaim ke prinsipal =================
  async claims(tenantId: string) {
    const rows = await this.db
      .select({ c: principalClaims, name: suppliers.name })
      .from(principalClaims)
      .innerJoin(suppliers, eq(suppliers.id, principalClaims.supplierId))
      .where(eq(principalClaims.tenantId, tenantId))
      .orderBy(desc(principalClaims.period), desc(principalClaims.number))
      .limit(300);
    return rows.map((r) => ({ ...r.c, supplierName: r.name }));
  }

  async claim(tenantId: string, id: string) {
    const [c] = await this.db.select().from(principalClaims).where(and(eq(principalClaims.id, id), eq(principalClaims.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Klaim tidak ditemukan');
    const lines = await this.db.select().from(principalClaimLines).where(eq(principalClaimLines.claimId, id));
    return { ...c, lines };
  }

  /** Kumpulkan baris pesanan berpromo (difakturkan di bulan itu, belum pernah diklaim) yang didanai prinsipal */
  async generateClaim(u: AuthUser, dto: GenerateClaimDto) {
    if (dto.period >= todayJakarta().slice(0, 7)) throw new BadRequestException('Klaim baru dapat dibuat setelah bulannya berakhir');
    const [sup] = await this.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.id, dto.supplierId), eq(suppliers.tenantId, u.tenantId)));
    if (!sup) throw new BadRequestException('Prinsipal tidak ditemukan');
    const from = firstDay(dto.period);
    const to = lastDay(dto.period);
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ line_id: string; promo_id: string; promo_name: string; kind: string; funded: string; qty: string; factor: string; price: string; line_total: string; is_bonus: boolean; inv_no: string; sku: string; cost: string | null }>(sql`
        SELECT l.id AS line_id, p.id AS promo_id, p.name AS promo_name, p.kind, p.funded_pct AS funded, l.qty, l.uom_factor AS factor, l.price, l.line_total, l.is_bonus, i.number AS inv_no, pr.sku,
               (SELECT AVG(m.unit_cost) FROM stock_moves m WHERE m.tenant_id = ${u.tenantId}::uuid AND m.product_id = l.product_id AND m.type = 'SALE' AND (m.ref_id = i.id::text OR m.ref_id = i.delivery_order_id::text)) AS cost
        FROM sales_order_lines l
        JOIN promos p ON p.id = l.promo_id
        JOIN sales_orders o ON o.id = l.order_id
        JOIN invoices i ON i.sales_order_id = o.id
        JOIN products pr ON pr.id = l.product_id
        WHERE o.tenant_id = ${u.tenantId} AND p.funded_supplier_id = ${sup.id} AND p.funded_pct > 0 AND i.date >= ${from} AND i.date <= ${to}
          AND NOT EXISTS (SELECT 1 FROM principal_claim_lines x WHERE x.order_line_id = l.id)`);
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
        base = money(base);
        if (base.lte(0)) continue;
        items.push({ orderLineId: r.line_id, promoId: r.promo_id, kind: isBonus ? 'BONUS' : 'DISCOUNT', invoiceNumber: r.inv_no, description: `${r.promo_name} — ${isBonus ? 'bonus' : 'potongan'} ${r.sku}`, base, pct: r.funded, amount: money(base.times(r.funded).div(100)) });
      }
      const total = items.reduce((a, i) => a.plus(i.amount), D(0));
      if (!items.length || total.lte(0)) throw new BadRequestException('Tidak ada promo yang didanai prinsipal ini pada bulan tersebut (atau sudah diklaim)');
      const number = await this.seq.next(tx, u.tenantId, 'PRINCIPAL_CLAIM', toDocDate(to));
      const [claim] = await tx.insert(principalClaims).values({ tenantId: u.tenantId, number, supplierId: sup.id, period: dto.period, claimedAmount: total.toFixed(2), createdById: u.sub }).returning();
      await tx.insert(principalClaimLines).values(items.map((i) => ({ tenantId: u.tenantId, claimId: claim.id, orderLineId: i.orderLineId, promoId: i.promoId, kind: i.kind, invoiceNumber: i.invoiceNumber, description: i.description, baseValue: i.base.toFixed(2), fundedPct: i.pct, amount: i.amount.toFixed(2) })));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'PrincipalClaim', entityId: claim.id, data: { number, supplier: sup.name, period: dto.period, lines: items.length, claimed: total.toFixed(2) } });
      return { ...claim, lineCount: items.length };
    });
  }

  private async lockClaim(tx: Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const [c] = await tx.select().from(principalClaims).where(and(eq(principalClaims.id, id), eq(principalClaims.tenantId, tenantId))).for('update');
    if (!c) throw new NotFoundException('Klaim tidak ditemukan');
    return c;
  }

  async submitClaim(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockClaim(tx, u.tenantId, id);
      if (c.status !== 'DRAFT') throw new BadRequestException('Klaim ini sudah diajukan');
      await tx.update(principalClaims).set({ status: 'SUBMITTED' }).where(eq(principalClaims.id, id));
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
        await tx.delete(principalClaimLines).where(eq(principalClaimLines.claimId, id));
        await tx.update(principalClaims).set({ status: 'REJECTED', principalRef: dto.principalRef, decidedById: u.sub }).where(eq(principalClaims.id, id));
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
      await tx.update(principalClaims).set({ status: 'APPROVED', approvedAmount: approved.toFixed(2), principalRef: dto.principalRef, approvalJournalId: journal.id, decidedById: u.sub }).where(eq(principalClaims.id, id));
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
      await tx.update(principalClaims).set({ status: 'PAID', paymentJournalId: journal.id, cashAccountId: cash.id }).where(eq(principalClaims.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'RECEIVE', entity: 'PrincipalClaim', entityId: id, data: { number: c.number, amount: c.approvedAmount, journal: journal.number } });
      return { id, status: 'PAID', journalNumber: journal.number };
    });
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller()
export class TradeController {
  constructor(private readonly svc: TradeService) {}

  @Get('trade-terms')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  terms(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.terms(u.tenantId, q.customerId);
  }
  @Post('trade-terms')
  @Roles('ADMIN')
  createTerm(@CurrentUser() u: AuthUser, @Body() dto: TermDto) {
    return this.svc.saveTerm(u, dto);
  }
  @Put('trade-terms/:id')
  @Roles('ADMIN')
  updateTerm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TermDto) {
    return this.svc.saveTerm(u, dto, id);
  }

  @Get('trade-accruals')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  accruals(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.accruals(u.tenantId, q);
  }
  @Post('trade-accruals/accrue')
  @Roles('ADMIN', 'ACCOUNTANT')
  accrue(@CurrentUser() u: AuthUser, @Body() dto: PeriodDto) {
    return this.svc.accrue(u, dto.period);
  }
  @Post('trade-accruals/:id/settle')
  @Roles('ADMIN', 'FINANCE')
  settle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleDto) {
    return this.svc.settle(u, id, dto);
  }
  @Post('trade-accruals/:id/void')
  @Roles('ADMIN')
  voidAccrual(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.svc.voidAccrual(u, id, dto.reason);
  }

  @Get('principal-claims')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  claims(@CurrentUser() u: AuthUser) {
    return this.svc.claims(u.tenantId);
  }
  @Get('principal-claims/:id')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  claim(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.claim(u.tenantId, id);
  }
  @Post('principal-claims/generate')
  @Roles('ADMIN', 'ACCOUNTANT')
  generate(@CurrentUser() u: AuthUser, @Body() dto: GenerateClaimDto) {
    return this.svc.generateClaim(u, dto);
  }
  @Post('principal-claims/:id/submit')
  @Roles('ADMIN', 'ACCOUNTANT')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitClaim(u, id);
  }
  @Post('principal-claims/:id/decide')
  @Roles('ADMIN', 'ACCOUNTANT')
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideClaimDto) {
    return this.svc.decideClaim(u, id, dto);
  }
  @Post('principal-claims/:id/receive')
  @Roles('ADMIN', 'FINANCE')
  receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveClaimDto) {
    return this.svc.receiveClaim(u, id, dto);
  }
}
