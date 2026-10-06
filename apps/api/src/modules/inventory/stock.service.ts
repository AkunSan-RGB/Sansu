import { BadRequestException, Injectable } from '@nestjs/common';
import { auditContext } from '../../common/audit/audit-context';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { eq, sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { DocDate } from '../../common/utils/dates';
import { D, Dec, DecValue, money, qty4 } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { products, StockMoveType, stockMoves, warehouses } from '../../db/schema';
import { movingAverage } from './costing';

export interface MoveInput {
  tenantId: string;
  productId: string;
  warehouseId: string;
  type: StockMoveType;
  /** Satuan dasar. Positif = masuk, negatif = keluar. */
  qty: DecValue;
  /** Wajib untuk barang masuk; diabaikan untuk barang keluar (memakai HPP rata-rata). */
  unitCost?: DecValue;
  refType: string;
  refId: string;
  refNumber?: string;
  date: DocDate;
  /** Lewati cek hak akses gudang pengguna (mis. sisi penerima transfer) */
  skipAccessCheck?: boolean;
  /** Barang masuk: penurunan nilai per satuan yang ikut terbawa (transfer, retur jual). Bawaan 0. */
  writedownUnit?: DecValue;
}

export interface MoveResult {
  unitCost: Dec;
  /** Nilai persediaan yang berpindah (selalu positif, dibulatkan 2 desimal) */
  value: Dec;
  balanceAfter: Dec;
  /** Penurunan nilai per satuan yang melekat pada barang yang berpindah */
  writedownUnit: Dec;
}

/**
 * Inti mutasi stok. Selalu dipanggil di dalam transaksi.
 * Baris saldo dikunci (SELECT ... FOR UPDATE) agar dua faktur bersamaan
 * tidak bisa menjual stok yang sama (race condition).
 */
@Injectable()
export class StockService {
  constructor(private readonly period: PeriodService) {}

  async move(tx: Tx, m: MoveInput): Promise<MoveResult> {
    const qty = qty4(m.qty);
    if (qty.isZero()) throw new BadRequestException('Kuantitas mutasi tidak boleh nol');
    await this.period.assertOpen(tx, m.tenantId, m.date);
    // pengguna yang dibatasi ke gudang tertentu tidak bisa mengubah stok gudang lain
    if (!m.skipAccessCheck) assertWarehouseAccess(auditContext.getStore()?.user, m.warehouseId);
    if (qty.isPositive()) {
      const [w] = await tx.select({ isActive: warehouses.isActive, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, m.warehouseId));
      if (w && !w.isActive) throw new BadRequestException(`Gudang ${w.name} sudah nonaktif — aktifkan dulu di Inventori › Gudang.`);
    }

    await tx.execute(sql`
      INSERT INTO stock_balances (tenant_id, product_id, warehouse_id, qty, avg_cost)
      VALUES (${m.tenantId}, ${m.productId}, ${m.warehouseId}, 0, 0)
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`);

    const locked = await tx.execute<{ qty: string; avg_cost: string; writedown_unit: string }>(sql`
      SELECT qty, avg_cost, writedown_unit FROM stock_balances
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}
      FOR UPDATE`);
    const oldQty = D(locked.rows[0].qty);
    const oldAvg = D(locked.rows[0].avg_cost);
    const oldWu = D(locked.rows[0].writedown_unit);

    let unitCost: Dec;
    let newAvg: Dec;
    let moveWu: Dec;
    let newWu: Dec;
    let wdValue: Dec;
    if (qty.isPositive()) {
      if (m.unitCost === undefined) throw new BadRequestException('Biaya satuan wajib untuk barang masuk');
      unitCost = qty4(m.unitCost);
      newAvg = movingAverage(oldQty, oldAvg, qty, unitCost);
      moveWu = qty4(m.writedownUnit ?? 0);
      const base = oldQty.gt(0) ? oldQty : D(0);
      newWu = qty4(base.times(oldWu).plus(qty.times(moveWu)).div(base.plus(qty)));
      wdValue = money(qty.times(moveWu));
    } else {
      if (oldQty.plus(qty).isNegative()) {
        const [p] = await tx.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, m.productId));
        throw new BadRequestException(
          `Stok ${p?.sku} ${p?.name} tidak cukup: tersedia ${oldQty.toString()}, dibutuhkan ${qty.abs().toString()}`,
        );
      }
      unitCost = oldAvg;
      newAvg = oldAvg;
      moveWu = oldWu;
      newWu = oldWu;
      wdValue = money(qty.abs().times(oldWu)).negated();
    }

    const balanceAfter = oldQty.plus(qty);
    if (balanceAfter.isZero() && oldWu.gt(0)) {
      // stok habis: seluruh sisa penurunan nilai ikut keluar (tanpa sisa pembulatan)
      const r = await tx.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(writedown_value), 0) AS v FROM stock_moves WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
      wdValue = D(r.rows[0].v).negated();
      newWu = D(0);
    }
    await tx.execute(sql`
      UPDATE stock_balances SET qty = ${balanceAfter.toFixed(4)}, avg_cost = ${newAvg.toFixed(4)}, writedown_unit = ${newWu.toFixed(4)}
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);

    await tx.insert(stockMoves).values({
      tenantId: m.tenantId,
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: m.type,
      qty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
      balanceAfter: balanceAfter.toFixed(4),
      writedownValue: wdValue.toFixed(2),
      refType: m.refType,
      refId: m.refId,
      refNumber: m.refNumber,
      date: m.date,
    });

    return { unitCost, value: money(qty.abs().times(unitCost)), balanceAfter, writedownUnit: moveWu };
  }

  /**
   * Penilaian ulang tanpa mutasi kuantitas (dicatat sebagai baris kartu stok REVALUATION, qty 0):
   *  - WRITEDOWN: biaya rata-rata diturunkan ke nilai realisasi neto
   *  - REVERSAL : pemulihan, paling tinggi sebesar penurunan nilai yang masih melekat (SAK EP 13.20)
   */
  async revalue(
    tx: Tx,
    m: {
      tenantId: string;
      productId: string;
      warehouseId: string;
      newCost: DecValue;
      kind?: 'WRITEDOWN' | 'REVERSAL';
      refType: string;
      refId: string;
      refNumber?: string;
      date: DocDate;
    },
  ): Promise<{ qty: Dec; oldCost: Dec; newCost: Dec; amount: Dec }> {
    const kind = m.kind ?? 'WRITEDOWN';
    await this.period.assertOpen(tx, m.tenantId, m.date);
    assertWarehouseAccess(auditContext.getStore()?.user, m.warehouseId);
    const locked = await tx.execute<{ qty: string; avg_cost: string; writedown_unit: string }>(sql`
      SELECT qty, avg_cost, writedown_unit FROM stock_balances
      WHERE tenant_id = ${m.tenantId} AND product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}
      FOR UPDATE`);
    const [p] = await tx.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, m.productId));
    const label = `${p?.sku ?? ''} ${p?.name ?? ''}`.trim();
    const row = locked.rows[0];
    const qty = D(row?.qty ?? 0);
    if (qty.lte(0)) throw new BadRequestException(`Stok ${label} kosong di gudang ini — tidak ada yang dinilai ulang`);
    const oldCost = D(row.avg_cost);
    const wu = D(row.writedown_unit);
    let newCost = qty4(m.newCost);
    // batas pemulihan ditampilkan 2 desimal: selisih pembulatan < 1 sen dianggap pulih penuh
    if (kind === 'REVERSAL' && newCost.gt(oldCost.plus(wu)) && newCost.minus(oldCost.plus(wu)).lt(0.01)) newCost = oldCost.plus(wu);
    if (newCost.isNegative()) throw new BadRequestException(`Nilai baru ${label} tidak boleh negatif`);
    let newWu: Dec;
    if (kind === 'WRITEDOWN') {
      if (newCost.gte(oldCost)) {
        throw new BadRequestException(`Nilai baru ${label} (${newCost.toFixed(2)}) harus lebih kecil dari biaya rata-rata saat ini (${oldCost.toFixed(2)})`);
      }
      newWu = wu.plus(oldCost.minus(newCost));
    } else {
      if (newCost.lte(oldCost)) {
        throw new BadRequestException(`Nilai pulih ${label} (${newCost.toFixed(2)}) harus lebih besar dari biaya rata-rata saat ini (${oldCost.toFixed(2)})`);
      }
      const max = oldCost.plus(wu);
      if (wu.lte(0)) throw new BadRequestException(`${label} tidak punya penurunan nilai yang bisa dipulihkan`);
      if (newCost.gt(max)) {
        throw new BadRequestException(`Pemulihan ${label} paling tinggi ${max.toFixed(2)} per satuan (biaya sebelum diturunkan)`);
      }
      newWu = max.minus(newCost);
    }
    // Nilai berubah = nilai buku lama − nilai buku baru (dibulatkan per baris); + turun, − pulih
    const delta = money(qty.times(oldCost)).minus(money(qty.times(newCost)));
    let wdValue = delta;
    if (kind === 'REVERSAL' && newWu.isZero()) {
      // dipulihkan penuh: lepaskan seluruh sisa penurunan nilai agar tidak ada sisa pembulatan
      const r = await tx.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(writedown_value), 0) AS v FROM stock_moves WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
      wdValue = D(r.rows[0].v).negated();
    }
    await tx.execute(sql`
      UPDATE stock_balances SET avg_cost = ${newCost.toFixed(4)}, writedown_unit = ${newWu.toFixed(4)}
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
    await tx.insert(stockMoves).values({
      tenantId: m.tenantId,
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: 'REVALUATION',
      qty: '0',
      unitCost: newCost.toFixed(4),
      balanceAfter: qty.toFixed(4),
      writedownValue: wdValue.toFixed(2),
      refType: m.refType,
      refId: m.refId,
      refNumber: m.refNumber,
      date: m.date,
    });
    return { qty, oldCost, newCost, amount: delta.abs() };
  }
}
