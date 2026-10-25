import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LOYALTY, type LoyaltySettings, validateLoyalty } from '@sansu/shared';
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
import { LoyaltyRepository } from './loyalty.repository';
import type { Lot } from './loyalty.repository';

const SECTION = 'loyalty';

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settingsSvc: SettingsService,
    private readonly posting: PostingService,
    private readonly repo: LoyaltyRepository,
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
    const r = await this.repo.queryLoyaltyLedger(db, tenantId, customerId);
    return num(r.rows[0].p);
  }

  /** Kunci baris pelanggan agar tukar/perolehan poin bersamaan berjalan bergiliran */
  async lockCustomer(tx: Tx, tenantId: string, customerId: string) {
    const r = await this.repo.queryCustomer(tx, customerId, tenantId);
    if (!r.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
    return r.rows[0];
  }

  private async lots(tx: DbOrTx, tenantId: string, customerId: string): Promise<Lot[]> {
    const r = await this.repo.queryLoyaltyLedgerForLots(tx, tenantId, customerId);
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
      await this.repo.queryConsume(tx, take, lot.id);
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
    const due = (await this.repo.queryLoyaltyLedgerForExpireCustomerTx(tx, user.tenantId, customerId, today)).rows;
    return this.expireLots(tx, user, customerId, due);
  }

  private async expireLots(tx: Tx, user: { tenantId: string; sub?: string }, customerId: string, due: Lot[]) {
    let total = D(0);
    let pts = 0;
    for (const lot of due) {
      const v = money(D(lot.value).times(lot.remaining).div(lot.points));
      await this.repo.queryLoyaltyLedgerForExpireLots(tx, user, customerId, lot.remaining, v);
      await this.repo.queryExpireLots(tx, lot.id);
      total = total.plus(v);
      pts += lot.remaining;
    }
    if (pts > 0) await this.journal(tx, user, `Poin loyalitas kedaluwarsa (${pts} poin)`, customerId, total);
    return { points: pts, value: total.toFixed(2) };
  }

  /** Beri poin dari transaksi (nilai kewajiban = poin × nilai 1 poin). Jurnal dicatat pemanggil bersama jurnal penjualan. */
  async earnTx(tx: Tx, p: { tenantId: string; customerId: string; orderId: string; points: number; settings: LoyaltySettings; userId?: string }) {
    const value = money(D(p.points).times(p.settings.pointValueRp));
    await this.repo.queryLoyaltyLedgerForEarnTx(tx, p, value);
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
    await this.repo.queryLoyaltyLedgerForRedeemTx(tx, user.tenantId, p.customerId, p.points, liability, p.orderId, user.sub);
    return { discount, liability };
  }

  /** Retur transaksi: balik poin yang diperoleh dan kembalikan poin yang dipakai (porsi `ratio` dari transaksi) */
  async returnTx(tx: Tx, user: AuthUser, p: { customerId: string; orderId: string; earned: number; redeemed: number; redeemedValue: string; ratio: number; final: boolean; settings: LoyaltySettings }) {
    const prior = (await this.repo.queryLoyaltyLedgerForReturnTx(tx, p.orderId)).rows;
    const sumOf = (k: string) => prior.find((x) => x.kind === k);
    await this.lockCustomer(tx, user.tenantId, p.customerId);
    // poin yang diperoleh dibalik (saldo boleh menjadi negatif bila poinnya sudah terpakai; tampil di kontrol)
    let reverseValue = D(0);
    if (p.earned > 0) {
      const done = -num(sumOf('REVERSE')?.p);
      const pts = p.final ? p.earned - done : Math.round(p.earned * p.ratio);
      if (pts > 0) {
        const earnRow = (await this.repo.queryLoyaltyLedgerForReturnTx2(tx, p.orderId)).rows[0];
        const v = money(D(earnRow.value).times(pts).div(earnRow.points));
        // kurangi dari lot yang sama bila masih ada sisa, selebihnya langsung mengurangi saldo
        const lotLeft = (await this.repo.queryLoyaltyLedgerForReturnTx3(tx, p.orderId)).rows[0];
        const fromLot = Math.min(pts, lotLeft?.remaining ?? 0);
        if (fromLot > 0) await this.repo.queryReturnTx(tx, fromLot, lotLeft.id);
        await this.repo.queryLoyaltyLedgerForReturnTx4(tx, user.tenantId, p.customerId, pts, v, p.orderId, user.sub);
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
        await this.repo.queryLoyaltyLedgerForReturnTx5(tx, user.tenantId, p.customerId, refundPts, lotValue, p.orderId, p.settings, user.sub);
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
        await this.repo.queryLoyaltyLedgerForAdjust(tx, u.tenantId, dto.customerId, dto.points, value, s, dto.reason, u.sub);
        await this.journal(tx, u, `Penyesuaian poin loyalitas (+${dto.points})`, dto.customerId, value.negated());
      } else {
        const bal = await this.balance(tx, u.tenantId, dto.customerId);
        if (-dto.points > bal) throw new BadRequestException(`Saldo poin ${bal}, tidak bisa dikurangi ${-dto.points}`);
        const value = await this.consume(tx, u.tenantId, dto.customerId, -dto.points);
        await this.repo.queryLoyaltyLedgerForAdjust2(tx, u.tenantId, dto.customerId, dto.points, value, dto.reason, u.sub);
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
      const due = (await this.repo.queryLoyaltyLedgerForExpireAll(tx, u.tenantId, today)).rows;
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
    const c = (await this.repo.queryCustomerForMember(this.db, customerId, tenantId)).rows[0];
    if (!c) throw new NotFoundException('Pelanggan tidak ditemukan');
    const s = await this.settings(tenantId);
    const raw = await this.balance(this.db, tenantId, customerId);
    const stale = num((await this.repo.queryLoyaltyLedgerForMember(this.db, tenantId, customerId)).rows[0].p);
    const balance = raw - stale; // poin yang sudah lewat tanggal tidak ditampilkan sebagai tersedia
    const expiring = (await this.repo.queryLoyaltyLedgerForMember2(this.db, tenantId, customerId)).rows;
    const history = (await this.repo.queryLoyaltyLedgerForMember3(this.db, tenantId, customerId)).rows;
    return { customer: c, balance, expiredPending: stale, valueRp: balance * s.pointValueRp, expiring, history };
  }

  async lookup(tenantId: string, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const like = `%${term}%`;
    const r = await this.repo.queryCustomerForLookup(this.db, tenantId, like);
    return r.rows;
  }

  /** Ringkasan kewajiban dan kontrol */
  async summary(tenantId: string) {
    const s = await this.settings(tenantId);
    const tot = (await this.repo.queryLoyaltyLedgerForSummary(this.db, tenantId)).rows[0];
    const gl = (await this.repo.queryJournalLine(this.db, tenantId)).rows[0];
    const today = todayJakarta();
    const dueNow = (await this.repo.queryLoyaltyLedgerForSummary2(this.db, tenantId, today)).rows[0];
    const soon = (await this.repo.queryLoyaltyLedgerForSummary3(this.db, tenantId, today)).rows[0];
    const negative = (await this.repo.queryLoyaltyLedgerForSummary4(this.db, tenantId)).rows;
    const adjustments = (await this.repo.queryLoyaltyLedgerForSummary5(this.db, tenantId)).rows;
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
