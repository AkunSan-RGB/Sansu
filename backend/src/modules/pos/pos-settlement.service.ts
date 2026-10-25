import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type CardSettlementSettings, DEFAULT_CARD_SETTLEMENT, mdrAmount, validateCardSettlement } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { posCardSettlementItems, posCardSettlements } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { CardSettingsDto, SettleDto, CancelSettleDto } from './pos-settlement.dto';
import { insertOne } from '../../db/owned';

const SECTION = 'cardSettlement';

@Injectable()
export class CardSettlementService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly settingsSvc: SettingsService,
    private readonly posting: PostingService,
  ) {}

  settings(tenantId: string, db: DbOrTx = this.db): Promise<CardSettlementSettings> {
    return this.settingsSvc.section(db, tenantId, SECTION, DEFAULT_CARD_SETTLEMENT);
  }

  async saveSettings(u: AuthUser, dto: CardSettingsDto) {
    const next: CardSettlementSettings = { qrisPct: dto.qrisPct, debitPct: dto.debitPct, lateAfterDays: dto.lateAfterDays, toleranceRp: dto.toleranceRp };
    const errs = validateCardSettlement(next);
    if (errs.length) throw new BadRequestException(errs.join('; '));
    return this.db.transaction(async (tx) => {
      const before = await this.settings(u.tenantId, tx);
      await this.settingsSvc.saveSection(tx, u.tenantId, SECTION, DEFAULT_CARD_SETTLEMENT, next);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'CardSettlementSettings', entityId: u.tenantId, data: { before, after: next } });
      return next;
    });
  }

  /** Pembayaran QRIS/debit yang belum masuk pencairan mana pun */
  async unsettled(tenantId: string, method?: string) {
    const r = await this.db.execute(sql`
      SELECT p.id, p.method, p.amount, o.number AS "orderNumber", o.date, s.bank_account_id AS "bankAccountId",
             COALESCE((SELECT SUM(r.total) FROM pos_returns r WHERE r.order_id = o.id), 0) AS returned
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id JOIN pos_sessions s ON s.id = o.session_id
      WHERE o.tenant_id = ${tenantId} AND p.method IN ('QRIS', 'DEBIT') ${method ? sql`AND p.method = ${method}` : sql``}
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id)
      ORDER BY o.date, o.number LIMIT 1000`);
    return r.rows;
  }

  /** Retur non-tunai (refund lewat rekening) yang belum dipotongkan dari pencairan; hanya dari pesanan yang seluruhnya dibayar dengan metode ini */
  async unsettledReturns(tenantId: string, method?: string) {
    const r = await this.db.execute(sql`
      SELECT r.id, r.number, r.date, r.total, o.number AS "orderNumber", s.bank_account_id AS "bankAccountId", pm.method
      FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id JOIN pos_sessions s ON s.id = o.session_id
      JOIN LATERAL (SELECT MIN(p.method) AS method, COUNT(DISTINCT p.method) AS n FROM pos_payments p WHERE p.order_id = o.id) pm ON pm.n = 1
      WHERE r.tenant_id = ${tenantId} AND r.refund_method = 'BANK' AND pm.method IN ('QRIS', 'DEBIT') ${method ? sql`AND pm.method = ${method}` : sql``}
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_returns x WHERE x.return_id = r.id)
      ORDER BY r.date, r.number LIMIT 500`);
    return r.rows;
  }

  list(tenantId: string) {
    return this.db.execute(sql`SELECT id, number, date, method, gross, returns_total AS "returnsTotal", mdr_pct AS "mdrPct", mdr_expected AS "mdrExpected", received, difference, item_count AS "itemCount", status, note, cancel_reason AS "cancelReason", created_at AS "createdAt" FROM pos_card_settlements WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 200`).then((r) => r.rows);
  }

  async create(u: AuthUser, dto: SettleDto) {
    const ids = [...new Set(dto.paymentIds)];
    if (ids.length !== dto.paymentIds.length) throw new BadRequestException('Pembayaran yang sama dipilih lebih dari sekali');
    const retIds = [...new Set(dto.returnIds ?? [])];
    if (retIds.length !== (dto.returnIds ?? []).length) throw new BadRequestException('Retur yang sama dipilih lebih dari sekali');
    const s = await this.settings(u.tenantId);
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      // kunci pembayaran agar dua pencairan bersamaan tidak memakai pembayaran yang sama
      const rows = (await tx.execute<{ id: string; method: string; amount: string; bank: string; tenant: string }>(sql`
        SELECT p.id, p.method, p.amount, s.bank_account_id AS bank, o.tenant_id AS tenant
        FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id JOIN pos_sessions s ON s.id = o.session_id
        WHERE p.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND o.tenant_id = ${u.tenantId} FOR UPDATE OF p`)).rows;
      if (rows.length !== ids.length) throw new BadRequestException('Ada pembayaran yang tidak ditemukan');
      if (rows.some((r) => r.method !== dto.method)) throw new BadRequestException(`Semua pembayaran harus bermetode ${dto.method}`);
      const used = await tx.execute(sql`SELECT 1 FROM pos_card_settlement_items WHERE payment_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) LIMIT 1`);
      if (used.rows.length) throw new BadRequestException('Ada pembayaran yang sudah masuk pencairan lain');
      // retur non-tunai yang dipotongkan: refund lewat rekening, pesanan seluruhnya dibayar dengan metode ini, belum pernah dipotongkan
      const rets = retIds.length ? (await tx.execute<{ id: string; total: string; bank: string }>(sql`
        SELECT r.id, r.total, s.bank_account_id AS bank
        FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id JOIN pos_sessions s ON s.id = o.session_id
        WHERE r.id IN (${sql.join(retIds.map((i) => sql`${i}::uuid`), sql`, `)}) AND r.tenant_id = ${u.tenantId} AND r.refund_method = 'BANK'
          AND (SELECT COUNT(DISTINCT p.method) FROM pos_payments p WHERE p.order_id = o.id) = 1
          AND (SELECT MIN(p.method) FROM pos_payments p WHERE p.order_id = o.id) = ${dto.method}
        FOR UPDATE OF r`)).rows : [];
      if (rets.length !== retIds.length) throw new BadRequestException('Ada retur yang tidak ditemukan, bukan refund lewat rekening, atau pesanannya tidak seluruhnya dibayar dengan metode ini');
      if (retIds.length) {
        const dup = await tx.execute(sql`SELECT 1 FROM pos_card_settlement_returns WHERE return_id IN (${sql.join(retIds.map((i) => sql`${i}::uuid`), sql`, `)}) LIMIT 1`);
        if (dup.rows.length) throw new BadRequestException('Ada retur yang sudah dipotongkan dari pencairan lain');
      }
      // per rekening: penjualan kotor, retur, penjualan bersih
      const per = new Map<string, { gross: ReturnType<typeof D>; ret: ReturnType<typeof D> }>();
      const slot = (b: string) => { if (!per.has(b)) per.set(b, { gross: D(0), ret: D(0) }); return per.get(b)!; };
      for (const r of rows) slot(r.bank).gross = slot(r.bank).gross.plus(r.amount);
      for (const r of rets) slot(r.bank).ret = slot(r.bank).ret.plus(r.total);
      const banks = [...per.keys()];
      let receivedBy: Map<string, ReturnType<typeof money>>;
      if (dto.bankReceipts?.length) {
        receivedBy = new Map(dto.bankReceipts.map((b) => [b.bankAccountId, money(b.received)]));
        if (receivedBy.size !== dto.bankReceipts.length) throw new BadRequestException('Satu rekening tercantum lebih dari sekali');
        if (receivedBy.size !== banks.length || banks.some((b) => !receivedBy.has(b))) throw new BadRequestException('Rincian uang masuk harus mencakup tepat rekening yang terkait pembayaran dan retur ini');
      } else {
        if (banks.length !== 1) throw new BadRequestException('Pembayaran/retur menyangkut lebih dari satu rekening bank; isi uang masuk per rekening (bankReceipts)');
        if (dto.received == null) throw new BadRequestException('Isi uang bersih yang masuk');
        receivedBy = new Map([[banks[0], money(dto.received)]]);
      }
      const pct = dto.method === 'QRIS' ? s.qrisPct : s.debitPct;
      let gross = D(0), retTotal = D(0), mdr = D(0), received = D(0), maxAbsDiff = D(0);
      const detail: { bank: string; gross: ReturnType<typeof D>; ret: ReturnType<typeof D>; mdr: ReturnType<typeof D>; received: ReturnType<typeof D>; diff: ReturnType<typeof D> }[] = [];
      for (const [bank, v] of per) {
        const base = v.gross.minus(v.ret);
        if (base.lt(0)) throw new BadRequestException('Retur melebihi penjualan pada salah satu rekening; cairkan bersama penjualan aslinya');
        const rec = receivedBy.get(bank)!;
        if (rec.lt(0)) throw new BadRequestException('Jumlah diterima tidak valid');
        if (rec.gt(base)) throw new BadRequestException('Uang diterima tidak boleh melebihi penjualan bersih (kotor − retur)');
        const m = D(mdrAmount(base.toNumber(), pct));
        const diff = rec.minus(base.minus(m));
        detail.push({ bank, gross: v.gross, ret: v.ret, mdr: m, received: rec, diff });
        gross = gross.plus(v.gross); retTotal = retTotal.plus(v.ret); mdr = mdr.plus(m); received = received.plus(rec);
        if (diff.abs().gt(maxAbsDiff)) maxAbsDiff = diff.abs();
      }
      const net = gross.minus(retTotal);
      const expectedNet = net.minus(mdr);
      const diff = received.minus(expectedNet);
      if (detail.some((d) => !d.diff.isZero()) && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Uang diterima berbeda ${diff.toFixed(0)} dari hitungan MDR ${pct}% (seharusnya ${expectedNet.toFixed(0)}); tulis penjelasannya.`);
      if (maxAbsDiff.gt(s.toleranceRp) && u.role !== 'OWNER' && u.role !== 'ADMIN') throw new ForbiddenException(`Selisih di atas toleransi Rp${s.toleranceRp.toLocaleString('id-ID')} hanya boleh dicatat Admin/Pemilik`);
      const number = await this.seq.next(tx, u.tenantId, 'POS_CARD_SETTLEMENT', date);
      const st = await insertOne(tx, posCardSettlements, { tenantId: u.tenantId, number, date, method: dto.method, bankAccountId: banks[0], gross: gross.toFixed(2), returnsTotal: retTotal.toFixed(2), mdrPct: String(pct), mdrExpected: mdr.toFixed(2), received: received.toFixed(2), difference: diff.toFixed(2), itemCount: ids.length, note: dto.note?.trim() || null, createdById: u.sub });
      await tx.insert(posCardSettlementItems).values(rows.map((r) => ({ tenantId: u.tenantId, settlementId: st.id, paymentId: r.id, amount: money(r.amount).toFixed(2) })));
      for (const r of rets) await tx.execute(sql`INSERT INTO pos_card_settlement_returns (tenant_id, settlement_id, return_id, amount) VALUES (${u.tenantId}, ${st.id}, ${r.id}, ${money(r.total).toFixed(2)})`);
      for (const d of detail) await tx.execute(sql`INSERT INTO pos_card_settlement_banks (tenant_id, settlement_id, bank_account_id, gross, returns_total, received) VALUES (${u.tenantId}, ${st.id}, ${d.bank}, ${d.gross.toFixed(2)}, ${d.ret.toFixed(2)}, ${d.received.toFixed(2)})`);
      // Bank sudah didebit penuh saat penjualan dan dikredit saat retur; kurangi sebesar yang tidak sampai dari penjualan bersih (MDR + selisih) per rekening
      const extra = detail.reduce((a, d) => a.plus(d.gross.minus(d.ret).minus(d.received).minus(d.mdr)), D(0)); // > 0: potongan lebih besar dari hitungan kontrak
      const j = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date,
        description: `Pencairan ${dto.method} ${number}`,
        sourceType: 'BANK',
        sourceId: st.id,
        createdById: u.sub,
        lines: [
          { key: dto.method === 'QRIS' ? SYS.MDR_QRIS : SYS.MDR_CARD, debit: mdr },
          ...(extra.gt(0) ? [{ key: SYS.BANK_CHARGES, debit: extra }] : extra.lt(0) ? [{ key: SYS.BANK_CHARGES, credit: extra.abs() }] : []),
          ...detail.map((d) => ({ accountId: d.bank, credit: d.gross.minus(d.ret).minus(d.received) })),
        ],
      });
      await tx.update(posCardSettlements).set({ journalId: j.id }).where(sql`${posCardSettlements.id} = ${st.id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'PosCardSettlement', entityId: st.id, data: { number, method: dto.method, gross: gross.toFixed(2), returns: retTotal.toFixed(2), expectedNet: expectedNet.toFixed(2), received: received.toFixed(2), difference: diff.toFixed(2), banks: detail.length } });
      return st.id;
    });
    return (await this.db.execute(sql`SELECT * FROM pos_card_settlements WHERE id = ${id}`)).rows[0];
  }

  async cancel(u: AuthUser, id: string, dto: CancelSettleDto) {
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ status: string; number: string; journal_id: string; method: string }>(sql`SELECT status, number, journal_id, method FROM pos_card_settlements WHERE id = ${id} AND tenant_id = ${u.tenantId} FOR UPDATE`);
      const st = r.rows[0];
      if (!st) throw new NotFoundException('Pencairan tidak ditemukan');
      if (st.status !== 'POSTED') throw new BadRequestException('Pencairan ini sudah dibatalkan');
      // jurnal pembalik: baris asli dibalik debit/kredit
      const lines = (await tx.execute<{ account_id: string; debit: string; credit: string }>(sql`SELECT account_id, debit, credit FROM journal_lines WHERE journal_id = ${st.journal_id}`)).rows;
      const rev = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: todayJakarta(),
        description: `Pembatalan pencairan ${st.number}: ${dto.reason}`,
        sourceType: 'BANK',
        sourceId: randomUUID(), // sumber jurnal unik; pembatalan merujuk pencairan lewat uraian dan reverse_journal_id
        createdById: u.sub,
        lines: lines.map((l) => ({ accountId: l.account_id, debit: D(l.credit), credit: D(l.debit) })),
      });
      await tx.execute(sql`DELETE FROM pos_card_settlement_items WHERE settlement_id = ${id}`);
      await tx.execute(sql`DELETE FROM pos_card_settlement_returns WHERE settlement_id = ${id}`); // retur dapat dipotongkan lagi dari pencairan lain
      await tx.execute(sql`UPDATE pos_card_settlements SET status = 'CANCELLED', cancel_reason = ${dto.reason}, reverse_journal_id = ${rev.id} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'PosCardSettlement', entityId: id, data: { number: st.number, reason: dto.reason } });
    });
    return { ok: true };
  }

  /** Kontrol: belum cair lewat batas hari, selisih pencairan, dan MDR efektif jauh di atas kontrak */
  async controls(tenantId: string) {
    const s = await this.settings(tenantId);
    const late = await this.db.execute(sql`
      SELECT p.method, COUNT(*)::int AS count, SUM(p.amount) AS amount, MIN(o.date) AS oldest
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
      WHERE o.tenant_id = ${tenantId} AND p.method IN ('QRIS', 'DEBIT') AND o.date < (CURRENT_DATE - ${s.lateAfterDays}::int)
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id)
      GROUP BY p.method`);
    const diffs = await this.db.execute(sql`SELECT number, date, method, difference, note FROM pos_card_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND difference <> 0 AND date >= (CURRENT_DATE - 60) ORDER BY date DESC LIMIT 30`);
    const high = await this.db.execute(sql`
      SELECT number, date, method, mdr_pct AS "contractPct", ROUND((gross - returns_total - received) / NULLIF(gross - returns_total, 0) * 100, 3) AS "effectivePct"
      FROM pos_card_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND date >= (CURRENT_DATE - 60)
        AND (gross - returns_total - received) / NULLIF(gross - returns_total, 0) * 100 > mdr_pct + 0.5 ORDER BY date DESC LIMIT 30`);
    return { settings: s, notSettledLate: late.rows, withDifference: diffs.rows, highEffectiveMdr: high.rows };
  }
}
