import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DEFAULT_LOYALTY, expiryDate, type LoyaltySettings, validateLoyalty } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { LoyaltySettingsDto, AdjustDto } from './loyalty.dto';

const SECTION = 'loyalty';

const num = (v: unknown) => Number(v ?? 0);

type Lot = { id: string; remaining: number; value: string; points: number };

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settingsSvc: SettingsService,
    private readonly posting: PostingService,
  ) {}

  settings(tenantId: string, db: DbOrTx = this.db): Promise<LoyaltySettings> {
    return this.settingsSvc.section(db, tenantId, SECTION, DEFAULT_LOYALTY);
  }

  async saveSettings(u: AuthUser, dto: LoyaltySettingsDto) {
    const next: LoyaltySettings = { enabled: dto.enabled, earnPerRp: dto.earnPerRp, pointValueRp: dto.pointValueRp, minRedeemPoints: dto.minRedeemPoints, maxRedeemPct: dto.maxRedeemPct, expiryMonths: dto.expiryMonths };
    const errs = validateLoyalty(next);
    if (errs.length) throw new BadRequestException(errs.join('; '));
    return this.db.transaction(async (tx) => {
      const before = await this.settings(u.tenantId, tx);
      await this.settingsSvc.saveSection(tx, u.tenantId, SECTION, DEFAULT_LOYALTY, next);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'LoyaltySettings', entityId: u.tenantId, data: { before, after: next } });
      return next;
    });
  }

  /** Saldo poin pelanggan (jumlah seluruh perubahan) */
  async balance(db: DbOrTx, tenantId: string, customerId: string) {
    const r = await db.execute<{ p: string }>(sql`SELECT COALESCE(SUM(points), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}`);
    return num(r.rows[0].p);
  }

  /** Kunci baris pelanggan agar tukar/perolehan poin bersamaan berjalan bergiliran */
  async lockCustomer(tx: Tx, tenantId: string, customerId: string) {
    const r = await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
    return r.rows[0];
  }

  private async lots(tx: DbOrTx, tenantId: string, customerId: string): Promise<Lot[]> {
    const r = await tx.execute<{ id: string; remaining: number; value: string; points: number }>(sql`
      SELECT id, remaining, value, points FROM loyalty_ledger
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0
      ORDER BY expires_on NULLS LAST, created_at, id`);
    return r.rows;
  }

  /** Pakai `points` dari lot (FIFO). Mengembalikan nilai kewajiban yang dilepas. */
  private async consume(tx: Tx, tenantId: string, customerId: string, points: number) {
    let need = points;
    let value = D(0);
    for (const lot of await this.lots(tx, tenantId, customerId)) {
      if (need <= 0) break;
      const take = Math.min(need, lot.remaining);
      value = value.plus(D(lot.value).times(take).div(lot.points));
      await tx.execute(sql`UPDATE loyalty_ledger SET remaining = remaining - ${take} WHERE id = ${lot.id}`);
      need -= take;
    }
    if (need > 0) throw new BadRequestException('Poin tidak cukup');
    return money(value);
  }

  private async journal(tx: Tx, u: { tenantId: string; sub?: string }, description: string, sourceId: string, liabilityDebit: ReturnType<typeof D>) {
    // liabilityDebit > 0: Dr Utang Poin | Cr Beban ; < 0: Dr Beban | Cr Utang Poin
    if (liabilityDebit.isZero()) return null;
    const amt = liabilityDebit.abs();
    const j = await this.posting.post(tx, {
      tenantId: u.tenantId,
      date: todayJakarta(),
      description,
      sourceType: 'ADJUSTMENT',
      sourceId: randomUUID(), // satu jurnal per peristiwa (sumber jurnal unik)
      createdById: u.sub,
      lines: liabilityDebit.gt(0) ? [{ key: SYS.LOYALTY_LIABILITY, debit: amt }, { key: SYS.LOYALTY_EXPENSE, credit: amt }] : [{ key: SYS.LOYALTY_EXPENSE, debit: amt }, { key: SYS.LOYALTY_LIABILITY, credit: amt }],
    });
    return j.id;
  }

  /** Kedaluwarsakan lot milik satu pelanggan yang sudah lewat tanggalnya (dipakai saat tukar poin) */
  async expireCustomerTx(tx: Tx, user: { tenantId: string; sub?: string }, customerId: string) {
    const today = todayJakarta();
    const due = (await tx.execute<Lot & { expires_on: string }>(sql`SELECT id, remaining, value, points, expires_on FROM loyalty_ledger WHERE tenant_id = ${user.tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today} ORDER BY expires_on FOR UPDATE`)).rows;
    return this.expireLots(tx, user, customerId, due);
  }

  private async expireLots(tx: Tx, user: { tenantId: string; sub?: string }, customerId: string, due: Lot[]) {
    let total = D(0);
    let pts = 0;
    for (const lot of due) {
      const v = money(D(lot.value).times(lot.remaining).div(lot.points));
      await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, note, created_by_id) VALUES (${user.tenantId}, ${customerId}, 'EXPIRE', ${-lot.remaining}, ${v.negated().toFixed(2)}, 'Poin kedaluwarsa', ${user.sub ?? null})`);
      await tx.execute(sql`UPDATE loyalty_ledger SET remaining = 0 WHERE id = ${lot.id}`);
      total = total.plus(v);
      pts += lot.remaining;
    }
    if (pts > 0) await this.journal(tx, user, `Poin loyalitas kedaluwarsa (${pts} poin)`, customerId, total);
    return { points: pts, value: total.toFixed(2) };
  }

  /** Beri poin dari transaksi (nilai kewajiban = poin × nilai 1 poin). Jurnal dicatat pemanggil bersama jurnal penjualan. */
  async earnTx(tx: Tx, p: { tenantId: string; customerId: string; orderId: string; points: number; settings: LoyaltySettings; userId?: string }) {
    const value = money(D(p.points).times(p.settings.pointValueRp));
    await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, expires_on, remaining, created_by_id) VALUES (${p.tenantId}, ${p.customerId}, 'EARN', ${p.points}, ${value.toFixed(2)}, ${p.orderId}, ${expiryDate(todayJakarta(), p.settings)}, ${p.points}, ${p.userId ?? null})`);
    return value;
  }

  /**
   * Tukar poin pada transaksi: memeriksa aturan, mengunci saldo, memakai lot FIFO. Mengembalikan nilai potongan (Rp) dan nilai
   * kewajiban yang dilepas (untuk jurnal penjualan oleh pemanggil).
   */
  async redeemTx(tx: Tx, user: AuthUser, p: { customerId: string; orderId: string; points: number; totalRp: number; settings: LoyaltySettings }) {
    const s = p.settings;
    if (!s.enabled) throw new BadRequestException('Program loyalitas belum diaktifkan');
    if (p.points < s.minRedeemPoints) throw new BadRequestException(`Minimum tukar ${s.minRedeemPoints} poin`);
    await this.lockCustomer(tx, user.tenantId, p.customerId);
    await this.expireCustomerTx(tx, user, p.customerId);
    const balance = await this.balance(tx, user.tenantId, p.customerId);
    if (p.points > balance) throw new BadRequestException(`Saldo poin ${balance}, tidak cukup untuk menukar ${p.points} poin`);
    const maxPts = Math.floor((p.totalRp * (s.maxRedeemPct / 100)) / s.pointValueRp);
    if (p.points > maxPts) throw new BadRequestException(`Tukar poin maksimal ${s.maxRedeemPct}% dari total belanja (${maxPts} poin)`);
    const liability = await this.consume(tx, user.tenantId, p.customerId, p.points);
    const discount = money(D(p.points).times(s.pointValueRp));
    await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, created_by_id) VALUES (${user.tenantId}, ${p.customerId}, 'REDEEM', ${-p.points}, ${liability.negated().toFixed(2)}, ${p.orderId}, ${user.sub})`);
    return { discount, liability };
  }

  /** Retur transaksi: balik poin yang diperoleh dan kembalikan poin yang dipakai (porsi `ratio` dari transaksi) */
  async returnTx(tx: Tx, user: AuthUser, p: { customerId: string; orderId: string; earned: number; redeemed: number; redeemedValue: string; ratio: number; final: boolean; settings: LoyaltySettings }) {
    const prior = (await tx.execute<{ kind: string; p: string; v: string }>(sql`SELECT kind, COALESCE(SUM(points), 0) AS p, COALESCE(SUM(value), 0) AS v FROM loyalty_ledger WHERE order_id = ${p.orderId} AND kind IN ('REVERSE', 'REFUND') GROUP BY kind`)).rows;
    const sumOf = (k: string) => prior.find((x) => x.kind === k);
    await this.lockCustomer(tx, user.tenantId, p.customerId);
    // poin yang diperoleh dibalik (saldo boleh menjadi negatif bila poinnya sudah terpakai; tampil di kontrol)
    let reverseValue = D(0);
    if (p.earned > 0) {
      const done = -num(sumOf('REVERSE')?.p);
      const pts = p.final ? p.earned - done : Math.round(p.earned * p.ratio);
      if (pts > 0) {
        const earnRow = (await tx.execute<{ value: string; points: number }>(sql`SELECT value, points FROM loyalty_ledger WHERE order_id = ${p.orderId} AND kind = 'EARN'`)).rows[0];
        const v = money(D(earnRow.value).times(pts).div(earnRow.points));
        // kurangi dari lot yang sama bila masih ada sisa, selebihnya langsung mengurangi saldo
        const lotLeft = (await tx.execute<{ id: string; remaining: number }>(sql`SELECT id, remaining FROM loyalty_ledger WHERE order_id = ${p.orderId} AND kind = 'EARN' FOR UPDATE`)).rows[0];
        const fromLot = Math.min(pts, lotLeft?.remaining ?? 0);
        if (fromLot > 0) await tx.execute(sql`UPDATE loyalty_ledger SET remaining = remaining - ${fromLot} WHERE id = ${lotLeft.id}`);
        await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, note, created_by_id) VALUES (${user.tenantId}, ${p.customerId}, 'REVERSE', ${-pts}, ${v.negated().toFixed(2)}, ${p.orderId}, 'Retur transaksi', ${user.sub})`);
        reverseValue = v;
      }
    }
    // poin yang dipakai dikembalikan sebagai lot baru
    let refundValue = D(0);
    let refundPts = 0;
    if (p.redeemed > 0) {
      const done = num(sumOf('REFUND')?.p);
      refundPts = p.final ? p.redeemed - done : Math.round(p.redeemed * p.ratio);
      if (refundPts > 0) {
        refundValue = money(D(p.redeemedValue).times(refundPts).div(p.redeemed));
        const lotValue = money(D(refundPts).times(p.settings.pointValueRp));
        await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, expires_on, remaining, note, created_by_id) VALUES (${user.tenantId}, ${p.customerId}, 'REFUND', ${refundPts}, ${lotValue.toFixed(2)}, ${p.orderId}, ${expiryDate(todayJakarta(), p.settings)}, ${refundPts}, 'Poin dikembalikan (retur)', ${user.sub})`);
      }
    }
    return { reverseValue, refundValue, refundPts, refundLotValue: money(D(refundPts).times(p.settings.pointValueRp)) };
  }

  async adjust(u: AuthUser, dto: AdjustDto) {
    if (dto.points === 0) throw new BadRequestException('Jumlah poin tidak boleh nol');
    const s = await this.settings(u.tenantId);
    if (!s.enabled) throw new BadRequestException('Program loyalitas belum diaktifkan');
    await this.db.transaction(async (tx) => {
      await this.lockCustomer(tx, u.tenantId, dto.customerId);
      if (dto.points > 0) {
        const value = money(D(dto.points).times(s.pointValueRp));
        await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, expires_on, remaining, note, created_by_id) VALUES (${u.tenantId}, ${dto.customerId}, 'ADJUST', ${dto.points}, ${value.toFixed(2)}, ${expiryDate(todayJakarta(), s)}, ${dto.points}, ${dto.reason}, ${u.sub})`);
        await this.journal(tx, u, `Penyesuaian poin loyalitas (+${dto.points})`, dto.customerId, value.negated());
      } else {
        const bal = await this.balance(tx, u.tenantId, dto.customerId);
        if (-dto.points > bal) throw new BadRequestException(`Saldo poin ${bal}, tidak bisa dikurangi ${-dto.points}`);
        const value = await this.consume(tx, u.tenantId, dto.customerId, -dto.points);
        await tx.execute(sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, note, created_by_id) VALUES (${u.tenantId}, ${dto.customerId}, 'ADJUST', ${dto.points}, ${value.negated().toFixed(2)}, ${dto.reason}, ${u.sub})`);
        await this.journal(tx, u, `Penyesuaian poin loyalitas (${dto.points})`, dto.customerId, value);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'LoyaltyAdjustment', entityId: dto.customerId, data: { points: dto.points, reason: dto.reason } });
    });
    return this.member(u.tenantId, dto.customerId);
  }

  /** Proses kedaluwarsa semua pelanggan perusahaan ini (tombol Admin/Keuangan; juga otomatis per pelanggan saat tukar poin) */
  async expireAll(u: AuthUser) {
    return this.db.transaction(async (tx) => {
      const today = todayJakarta();
      const due = (await tx.execute<Lot & { customer_id: string }>(sql`SELECT id, remaining, value, points, customer_id FROM loyalty_ledger WHERE tenant_id = ${u.tenantId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today} ORDER BY customer_id, expires_on FOR UPDATE`)).rows;
      const by = new Map<string, Lot[]>();
      for (const l of due) by.set(l.customer_id, [...(by.get(l.customer_id) ?? []), l]);
      let points = 0;
      let value = D(0);
      for (const [cid, lots] of by) {
        const r = await this.expireLots(tx, u, cid, lots);
        points += r.points;
        value = value.plus(r.value);
      }
      if (points) await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'LoyaltyExpiry', entityId: u.tenantId, data: { customers: by.size, points, value: value.toFixed(2) } });
      return { customers: by.size, points, value: value.toFixed(2) };
    });
  }

  async member(tenantId: string, customerId: string) {
    const c = (await this.db.execute<{ id: string; code: string; name: string; phone: string | null }>(sql`SELECT id, code, name, phone FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`)).rows[0];
    if (!c) throw new NotFoundException('Pelanggan tidak ditemukan');
    const s = await this.settings(tenantId);
    const raw = await this.balance(this.db, tenantId, customerId);
    const stale = num((await this.db.execute<{ p: string }>(sql`SELECT COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${todayJakarta()}`)).rows[0].p);
    const balance = raw - stale; // poin yang sudah lewat tanggal tidak ditampilkan sebagai tersedia
    const expiring = (await this.db.execute<{ expires_on: string; remaining: number }>(sql`SELECT expires_on, remaining FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL ORDER BY expires_on LIMIT 5`)).rows;
    const history = (await this.db.execute(sql`SELECT kind, points, value, order_id AS "orderId", note, created_at AS "createdAt" FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} ORDER BY created_at DESC, id DESC LIMIT 100`)).rows;
    return { customer: c, balance, expiredPending: stale, valueRp: balance * s.pointValueRp, expiring, history };
  }

  async lookup(tenantId: string, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const like = `%${term}%`;
    const r = await this.db.execute(sql`
      SELECT c.id, c.code, c.name, c.phone, (COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l WHERE l.customer_id = c.id), 0) - COALESCE((SELECT SUM(l.remaining) FROM loyalty_ledger l WHERE l.customer_id = c.id AND l.remaining > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= ${todayJakarta()}), 0))::int AS balance
      FROM customers c WHERE c.tenant_id = ${tenantId} AND c.is_active AND (c.name ILIKE ${like} OR c.code ILIKE ${like} OR c.phone ILIKE ${like})
      ORDER BY c.name LIMIT 20`);
    return r.rows;
  }

  /** Ringkasan kewajiban dan kontrol */
  async summary(tenantId: string) {
    const s = await this.settings(tenantId);
    const tot = (await this.db.execute<{ points: string; value: string; members: string }>(sql`SELECT COALESCE(SUM(points), 0) AS points, COALESCE(SUM(value), 0) AS value, COUNT(DISTINCT customer_id) AS members FROM loyalty_ledger WHERE tenant_id = ${tenantId}`)).rows[0];
    const gl = (await this.db.execute<{ bal: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0) AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.tenant_id = ${tenantId} AND a.system_key = 'LOYALTY_LIABILITY'`)).rows[0];
    const today = todayJakarta();
    const dueNow = (await this.db.execute<{ n: string; p: string }>(sql`SELECT COUNT(*) AS n, COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today}`)).rows[0];
    const soon = (await this.db.execute<{ p: string }>(sql`SELECT COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND remaining > 0 AND expires_on > ${today} AND expires_on <= (${today}::date + 30)`)).rows[0];
    const negative = (await this.db.execute(sql`SELECT c.id, c.name, SUM(l.points)::int AS balance FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.tenant_id = ${tenantId} GROUP BY c.id, c.name HAVING SUM(l.points) < 0 ORDER BY SUM(l.points) LIMIT 20`)).rows;
    const adjustments = (await this.db.execute(sql`SELECT c.name AS customer, l.points, l.note, l.created_at AS "createdAt" FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.tenant_id = ${tenantId} AND l.kind = 'ADJUST' AND l.created_at > now() - interval '30 days' ORDER BY l.created_at DESC LIMIT 20`)).rows;
    const ledgerValue = money(D(tot.value));
    const glValue = money(D(gl.bal));
    return {
      settings: s,
      pointsOutstanding: num(tot.points),
      members: num(tot.members),
      ledgerLiability: ledgerValue.toFixed(2),
      glLiability: glValue.toFixed(2),
      difference: ledgerValue.minus(glValue).toFixed(2),
      dueForExpiry: { lots: num(dueNow.n), points: num(dueNow.p) },
      expiringIn30Days: num(soon.p),
      negativeBalances: negative,
      recentAdjustments: adjustments,
    };
  }
}
