import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { CONTROL_PROFILES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { LoyaltyService } from './loyalty.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { posOrderLines, posOrders, posPayments, posReturnLines, posReturns, posSessions } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { CreatePosReturnDto } from './pos-returns.dto';
import { insertOne, patchById } from '../../db/owned';
import { PosReturnsRepository } from './pos-returns.repository';

const QTY_EPS = D('0.00005');

/** Pesanan meja terbuka lebih lama dari ini dianggap menggantung */
const STALE_TAB_HOURS = 12;

/**
 * Retur / pembatalan penjualan kasir (hanya supervisor: Pemilik, Admin, Keuangan — kasir tidak bisa membatalkan
 * penjualannya sendiri). Stok kembali pada HPP saat dijual, jurnal penjualan & HPP dibalik, uang dikembalikan lewat
 * laci kasir (bila sesi asal masih terbuka, sehingga hitung kas saat tutup kasir tetap cocok) atau rekening.
 */
@Injectable()
export class PosReturnsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly loyalty: LoyaltyService,
    private readonly repo: PosReturnsRepository,
  ) {}

  async create(user: AuthUser, orderId: string, dto: CreatePosReturnDto) {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException('Alasan retur wajib diisi (minimal 5 karakter)');
    if (!dto.all && !dto.lines?.length) throw new BadRequestException('Pilih barang yang diretur atau batalkan seluruh transaksi');
    const date = todayJakarta();
    const id = await this.db.transaction(async (tx) => {
      const locked = await this.repo.queryPosOrder(tx, orderId, user.tenantId);
      if (!locked.rows.length) throw new NotFoundException('Transaksi kasir tidak ditemukan');
      const [order] = await this.repo.findPosOrdersById(tx, orderId);
      if (order.channel) throw new BadRequestException('Pesanan online tidak diretur lewat kasir: uang dikembalikan oleh platform. Catat koreksinya dengan jurnal penyesuaian setelah platform mengonfirmasi.');
      const [session] = await this.repo.findPosSessionsById(tx, order.sessionId);
      const lines = await this.repo.listPosOrderLinesByOrderId(tx, orderId);
      const byId = new Map(lines.map((l) => [l.id, l]));

      // baris yang diretur
      const picks: { line: (typeof lines)[number]; qty: Dec }[] = [];
      if (dto.all) {
        for (const l of lines) {
          const rest = D(l.qty).minus(l.returnedQty);
          if (rest.gt(QTY_EPS)) picks.push({ line: l, qty: rest });
        }
      } else {
        const seen = new Set<string>();
        for (const p of dto.lines!) {
          const l = byId.get(p.orderLineId);
          if (!l) throw new BadRequestException('Baris tidak termasuk transaksi ini');
          if (seen.has(l.id)) throw new BadRequestException('Baris yang sama tidak boleh dipilih dua kali');
          seen.add(l.id);
          const q = D(p.qty);
          if (q.lte(0)) throw new BadRequestException('Jumlah retur harus > 0');
          if (q.gt(D(l.qty).minus(l.returnedQty).plus(QTY_EPS))) throw new BadRequestException('Jumlah retur melebihi sisa yang bisa diretur');
          picks.push({ line: l, qty: q });
        }
      }
      if (!picks.length) throw new BadRequestException('Seluruh barang pada transaksi ini sudah diretur');

      // nilai retur proporsional; retur terakhir menutup sisa persis agar total retur = total penjualan
      const prev = (await this.repo.queryPosReturn(tx, orderId)).rows[0];
      const completes = lines.every((l) => {
        const p = picks.find((x) => x.line.id === l.id);
        return D(l.qty).minus(l.returnedQty).minus(p?.qty ?? 0).abs().lte(QTY_EPS);
      });
      let total: Dec;
      let tax: Dec;
      if (completes) {
        total = money(D(order.total).minus(prev.total));
        tax = money(D(order.taxAmount).minus(prev.tax));
      } else {
        const base = lines.reduce<Dec>((a, l) => a.plus(l.lineTotal), ZERO);
        const part = picks.reduce<Dec>((a, p) => a.plus(D(p.line.lineTotal).times(p.qty).div(p.line.qty)), ZERO);
        const r = base.isZero() ? ZERO : part.div(base);
        total = money(D(order.total).times(r));
        tax = money(D(order.taxAmount).times(r));
      }
      const subtotal = total.minus(tax);

      // pengembalian uang
      const pays = await this.repo.listPosPaymentsByOrderId(tx, orderId);
      const hadCash = pays.some((p) => p.method === 'CASH');
      const method: 'CASH' | 'BANK' = dto.refundMethod ?? (hadCash ? 'CASH' : 'BANK');
      const refundAccount = method === 'CASH' ? session.cashAccountId : session.bankAccountId;
      const drawerSession = method === 'CASH' && session.status === 'OPEN' ? session.id : null;

      const number = await this.seq.next(tx, user.tenantId, 'POS_RETURN', date);
      const ret = await insertOne(tx, posReturns, { tenantId: user.tenantId, number, date, orderId, sessionId: drawerSession, warehouseId: session.warehouseId, refundMethod: method, reason, subtotal: subtotal.toFixed(2), taxAmount: tax.toFixed(2), total: total.toFixed(2), cogsAmount: '0', createdById: user.sub });

      let cogs: Dec = ZERO;
      for (const p of picks) {
        if (p.line.fromRecipe) {
          // menu yang sudah dibuat: bahan sudah diolah dan tidak kembali ke stok; pendapatan dibalik, biaya bahan tetap tercatat sebagai beban
          await this.repo.insertPosReturnLines(tx, ret.id, p.line.id, p.line.productId, p.qty);
          await patchById(tx, posOrderLines, p.line.id, { returnedQty: D(p.line.returnedQty).plus(p.qty).toFixed(4) });
          continue;
        }
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: p.line.productId,
          warehouseId: session.warehouseId,
          type: 'SALE_RETURN',
          qty: p.qty.times(p.line.uomFactor),
          unitCost: D(p.line.unitCost),
          refType: 'POS_RETURN',
          refId: ret.id,
          refNumber: number,
          date,
        });
        cogs = cogs.plus(moved.value);
        await this.repo.insertPosReturnLinesForCreate(tx, ret.id, p.line.id, p.line.productId, p.qty, p.line.unitCost);
        await patchById(tx, posOrderLines, p.line.id, { returnedQty: D(p.line.returnedQty).plus(p.qty).toFixed(4) });
      }
      cogs = money(cogs);

      // Loyalitas: balik poin yang diperoleh, kembalikan poin yang dipakai (uang kembali hanya untuk bagian yang dibayar nyata)
      let refundShare = ZERO;
      let loyaltyLines: { key: typeof SYS.LOYALTY_LIABILITY | typeof SYS.LOYALTY_EXPENSE; debit?: Dec; credit?: Dec }[] = [];
      if (order.customerId && (order.loyaltyEarnedPoints > 0 || order.loyaltyRedeemedPoints > 0)) {
        const lr = await this.loyalty.returnTx(tx, user, {
          customerId: order.customerId,
          orderId,
          earned: order.loyaltyEarnedPoints,
          redeemed: order.loyaltyRedeemedPoints,
          redeemedValue: order.loyaltyRedeemedValue,
          ratio: D(order.total).isZero() ? 0 : total.div(order.total).toNumber(),
          final: completes,
          settings: await this.loyalty.settings(user.tenantId, tx),
        });
        if (lr.reverseValue.gt(0)) loyaltyLines.push({ key: SYS.LOYALTY_LIABILITY, debit: lr.reverseValue }, { key: SYS.LOYALTY_EXPENSE, credit: lr.reverseValue });
        if (lr.refundPts > 0) {
          refundShare = lr.refundValue;
          loyaltyLines.push({ key: SYS.LOYALTY_LIABILITY, credit: lr.refundLotValue });
          const d = lr.refundValue.minus(lr.refundLotValue);
          if (d.gt(0)) loyaltyLines.push({ key: SYS.LOYALTY_EXPENSE, credit: d });
          else if (d.lt(0)) loyaltyLines.push({ key: SYS.LOYALTY_EXPENSE, debit: d.abs() });
        }
      }
      const cashRefund = total.minus(refundShare);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Retur kasir ${number} atas ${order.number}`,
        sourceType: 'POS_RETURN',
        sourceId: ret.id,
        createdById: user.sub,
        lines: [
          { key: SYS.SALES_RETURN, debit: subtotal },
          { key: order.taxKind === 'LOCAL' ? SYS.LOCAL_TAX : SYS.VAT_OUT, debit: tax },
          { accountId: refundAccount, credit: cashRefund },
          ...loyaltyLines,
          { key: SYS.INVENTORY, debit: cogs },
          { key: SYS.COGS, credit: cogs },
        ],
      });
      await patchById(tx, posReturns, ret.id, { cogsAmount: cogs.toFixed(2), pointsRefund: refundShare.toFixed(2), journalId: journal.id });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PosReturn', entityId: ret.id, data: { order: order.number, total: total.toFixed(2), reason } });
      return ret.id;
    });
    return this.get(user.tenantId, id);
  }

  async get(tenantId: string, id: string) {
    const r = await this.db.query.posReturns.findFirst({
      where: and(eq(posReturns.id, id), eq(posReturns.tenantId, tenantId)),
      with: { lines: true },
    });
    if (!r) throw new NotFoundException('Retur kasir tidak ditemukan');
    return r;
  }

  list(tenantId: string) {
    return this.db.query.posReturns.findMany({ where: eq(posReturns.tenantId, tenantId), orderBy: desc(posReturns.createdAt), limit: 200 });
  }
}

export interface PosFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

/** Temuan kontrol kasir 30 hari terakhir: selisih kas, sesi menggantung, retur berulang, dijual di bawah HPP */
@Injectable()
export class PosControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly repo: PosReturnsRepository,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -30);
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];
    const items: PosFinding[] = [];
    const add = (key: string, level: PosFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) items.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const diff = await this.repo.queryPosSession(this.db, tenantId, since);
    add('SESSION_DIFF', 'warning', 'Selisih kas saat tutup kasir', diff.rows.map((r) => `${r.number} ${r.name} (${Number(r.difference) > 0 ? '+' : '−'}Rp${Math.abs(Number(r.difference)).toLocaleString('id-ID')})`), 'Uang di laci tidak sama dengan seharusnya. Selisih berulang pada kasir yang sama patut diselidiki.');
    const old = await this.repo.queryPosSessionForControls(this.db, tenantId, cp.posOpenHours);
    add('SESSION_OPEN_OLD', 'warning', 'Sesi kasir terbuka lebih dari sehari', old.rows.map((r) => `${r.number} ${r.name}`), 'Tutup kasir tiap hari agar uang laci dihitung dan dijurnal.');
    const rets = await this.repo.queryPosReturnForControls(this.db, tenantId, since);
    add('POS_RETURNS', 'info', 'Retur / pembatalan penjualan kasir', rets.rows.map((r) => `${r.number} Rp${Number(r.total).toLocaleString('id-ID')} — ${r.reason}`), 'Tinjau alasan retur; pembatalan sering menjadi celah penggelapan.');
    const heavy = await this.repo.queryPosReturnForControls2(this.db, tenantId, since);
    add('POS_RETURNS_HEAVY', 'warning', 'Banyak retur tunai dalam satu sesi', heavy.rows.map((r) => `${r.number}: ${r.n} retur`), 'Tiga retur tunai atau lebih dalam satu sesi kasir.');
    const below = await this.repo.queryPosOrderLine(this.db, tenantId, since);
    add('BELOW_COST', 'warning', 'Dijual di bawah harga pokok', below.rows.map((r) => `${r.number} (${r.sku})`), 'Harga jual lebih rendah dari HPP barang saat itu. Periksa harga master atau kemungkinan penyalahgunaan.');
    // Pesanan meja: pembatalan menu yang sudah dimasak/disajikan (rawan penggelapan: menu dihidangkan lalu "dibatalkan" dan uangnya diambil)
    const voids = await this.repo.queryPosTabLine(this.db, tenantId, since);
    add('POS_TAB_VOIDS', 'warning', 'Menu dibatalkan setelah dimasak atau disajikan', voids.rows.map((r) => `${r.number} ${r.product} (${r.from_status === 'SERVED' ? 'sudah disajikan' : 'sudah dimasak'}) oleh ${r.by ?? '-'} — ${r.reason ?? ''}`), 'Pastikan menu yang sudah dibuat memang tidak jadi dibayar (komplain, salah buat), bukan dihidangkan lalu dibatalkan.');
    const stale = await this.db.execute<{ number: string; label: string | null }>(sql`
      SELECT t.number, t.table_label AS label FROM pos_tabs t
      WHERE t.tenant_id = ${tenantId} AND t.status = 'OPEN' AND t.created_at < now() - make_interval(hours => ${STALE_TAB_HOURS})`);
    add('POS_TABS_STALE', 'warning', 'Pesanan meja menggantung lebih dari 12 jam', stale.rows.map((r) => `${r.number}${r.label ? ` · ${r.label}` : ''}`), 'Pesanan belum dibayar atau dibatalkan. Selesaikan agar stok, pajak, dan pendapatan tercatat benar.');
    const rank = { error: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items };
  }
}
