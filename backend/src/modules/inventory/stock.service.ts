import { BadRequestException, Injectable } from '@nestjs/common';
import { auditContext } from '../../common/audit/audit-context';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { eq, sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { DocDate } from '../../common/utils/dates';
import { D, Dec, DecValue, money, qty4 } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { products, StockMoveType, stockLayers, stockMoves, warehouses } from '../../db/schema';
import { isInventoryMethod, type InventoryMethod } from '@sansu/shared';
import { consumeLayers, movingAverage } from './costing';

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
  /**
   * Barang keluar yang membatalkan penerimaan: dikeluarkan pada biaya penerimaan semula (bukan biaya rata-rata saat ini) dan biaya
   * rata-rata/lapisan dikembalikan, sehingga pembatalan tidak menimbulkan selisih nilai.
   */
  reverseCost?: DecValue;
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

  /** Metode biaya persediaan perusahaan (bawaan rata-rata bergerak) */
  async methodOf(tx: Tx, tenantId: string): Promise<InventoryMethod> {
    const r = await tx.execute<{ m: string | null }>(sql`SELECT settings->'inventory'->>'method' AS m FROM tenants WHERE id = ${tenantId}`);
    const m = r.rows[0]?.m;
    return isInventoryMethod(m) ? m : 'AVERAGE';
  }

  /** Lapisan FIFO harus cocok dengan saldo; bila tidak (mis. baru beralih metode), dibangun ulang sebagai satu lapisan pada biaya rata-rata saat ini */
  private async fifoLayers(tx: Tx, m: { tenantId: string; productId: string; warehouseId: string; date: DocDate }, balQty: Dec, balAvg: Dec) {
    const rows = await tx.execute<{ id: string; qty: string; unit_cost: string }>(sql`
      SELECT id, qty_remaining AS qty, unit_cost FROM stock_layers
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId} AND qty_remaining > 0
      ORDER BY received_date, created_at, id FOR UPDATE`);
    const total = rows.rows.reduce<Dec>((a, r) => a.plus(r.qty), D(0));
    if (total.eq(balQty)) return rows.rows.map((r) => ({ id: r.id, qty: r.qty, unitCost: r.unit_cost }));
    await tx.execute(sql`DELETE FROM stock_layers WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
    if (balQty.lte(0)) return [];
    const [l] = await tx
      .insert(stockLayers)
      .values({ tenantId: m.tenantId, productId: m.productId, warehouseId: m.warehouseId, receivedDate: '1970-01-01', qtyRemaining: balQty.toFixed(4), unitCost: balAvg.toFixed(4) })
      .returning({ id: stockLayers.id });
    return [{ id: l.id, qty: balQty.toFixed(4), unitCost: balAvg.toFixed(4) }];
  }

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
    let fifoValue: Dec | undefined;
    const method = await this.methodOf(tx, m.tenantId);
    if (qty.isPositive()) {
      if (m.unitCost === undefined) throw new BadRequestException('Biaya satuan wajib untuk barang masuk');
      unitCost = qty4(m.unitCost);
      if (method === 'FIFO') {
        const layers = await this.fifoLayers(tx, m, oldQty, oldAvg);
        await tx.insert(stockLayers).values({ tenantId: m.tenantId, productId: m.productId, warehouseId: m.warehouseId, receivedDate: m.date, qtyRemaining: qty.toFixed(4), unitCost: unitCost.toFixed(4) });
        const oldValue = layers.reduce<Dec>((a, l) => a.plus(D(l.qty).times(l.unitCost)), D(0));
        newAvg = qty4(oldValue.plus(qty.times(unitCost)).div(oldQty.plus(qty)));
      } else {
        newAvg = movingAverage(oldQty, oldAvg, qty, unitCost);
      }
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
      if (m.reverseCost !== undefined) {
        // pembatalan penerimaan: keluarkan pada biaya semula dan pulihkan biaya rata-rata / lapisan
        unitCost = qty4(m.reverseCost);
        fifoValue = money(qty.abs().times(unitCost));
        const leftQty = oldQty.minus(qty.abs());
        if (method === 'FIFO') {
          const layers = await this.fifoLayers(tx, m, oldQty, oldAvg);
          const rank = (l: { unitCost: string }) => (qty4(l.unitCost).eq(unitCost) ? 0 : 1);
          const order = [...layers].reverse().sort((x, y) => rank(x) - rank(y));
          let need = qty.abs();
          const kept = new Map(layers.map((l) => [l.id, D(l.qty)]));
          for (const l of order) {
            if (need.lte(0)) break;
            const take = kept.get(l.id)!.lt(need) ? kept.get(l.id)! : need;
            kept.set(l.id, kept.get(l.id)!.minus(take));
            need = need.minus(take);
            await tx.execute(sql`UPDATE stock_layers SET qty_remaining = ${kept.get(l.id)!.toFixed(4)} WHERE id = ${l.id}`);
          }
          await tx.execute(sql`DELETE FROM stock_layers WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId} AND qty_remaining <= 0`);
          if (leftQty.gt(0)) newAvg = qty4(layers.reduce<Dec>((a, l) => a.plus(kept.get(l.id)!.times(l.unitCost)), D(0)).div(leftQty));
        } else if (leftQty.gt(0)) {
          const v = oldQty.times(oldAvg).minus(qty.abs().times(unitCost)).div(leftQty);
          newAvg = v.isNegative() ? D(0) : qty4(v);
        }
      } else if (method === 'FIFO') {
        const layers = await this.fifoLayers(tx, m, oldQty, oldAvg);
        const used = consumeLayers(layers, qty.abs());
        for (const r of used.remaining) await tx.execute(sql`UPDATE stock_layers SET qty_remaining = ${r.qty.toFixed(4)} WHERE id = ${r.id}`);
        await tx.execute(sql`DELETE FROM stock_layers WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId} AND qty_remaining <= 0`);
        unitCost = qty4(used.cost.div(qty.abs()));
        fifoValue = money(used.cost);
        const left = used.remaining.reduce<Dec>((a, r, i) => a.plus(r.qty.times(layers[i].unitCost)), D(0));
        const leftQty = oldQty.minus(qty.abs());
        if (leftQty.gt(0)) newAvg = qty4(left.div(leftQty));
      }
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

    return { unitCost, value: fifoValue ?? money(qty.abs().times(unitCost)), balanceAfter, writedownUnit: moveWu };
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
    // FIFO: seluruh lapisan dinilai ulang dengan rasio yang sama agar nilai total ikut turun/pulih
    if (!oldCost.isZero()) {
      await tx.execute(sql`
        UPDATE stock_layers SET unit_cost = round(unit_cost * ${newCost.toFixed(4)}::numeric / ${oldCost.toFixed(4)}::numeric, 4)
        WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
    }
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

  /**
   * Koreksi biaya perolehan stok yang masih ada (mis. harga faktur supplier berbeda dari PO): nilai persediaan naik/turun
   * sebesar `amount` tanpa mutasi kuantitas — biaya rata-rata (dan semua lapisan FIFO) digeser sama rata per satuan.
   * Mengembalikan nilai yang benar-benar terpasang di stok (dibulatkan); 0 bila stok kosong.
   */
  async adjustCost(
    tx: Tx,
    m: { tenantId: string; productId: string; warehouseId: string; amount: DecValue; refType: string; refId: string; refNumber?: string; date: DocDate },
  ): Promise<Dec> {
    await this.period.assertOpen(tx, m.tenantId, m.date);
    assertWarehouseAccess(auditContext.getStore()?.user, m.warehouseId);
    const locked = await tx.execute<{ qty: string; avg_cost: string }>(sql`
      SELECT qty, avg_cost FROM stock_balances
      WHERE tenant_id = ${m.tenantId} AND product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}
      FOR UPDATE`);
    const row = locked.rows[0];
    const qty = D(row?.qty ?? 0);
    if (qty.lte(0)) return D(0);
    const oldCost = D(row.avg_cost);
    let newCost = qty4(oldCost.plus(D(m.amount).div(qty)));
    if (newCost.isNegative()) newCost = D(0);
    const applied = money(qty.times(newCost)).minus(money(qty.times(oldCost)));
    if (newCost.equals(oldCost)) return applied;
    await tx.execute(sql`
      UPDATE stock_balances SET avg_cost = ${newCost.toFixed(4)}
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
    await tx.execute(sql`
      UPDATE stock_layers SET unit_cost = GREATEST(0, unit_cost + ${newCost.minus(oldCost).toFixed(4)}::numeric)
      WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId}`);
    await tx.insert(stockMoves).values({
      tenantId: m.tenantId,
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: 'REVALUATION',
      qty: '0',
      unitCost: newCost.toFixed(4),
      balanceAfter: qty.toFixed(4),
      writedownValue: '0',
      refType: m.refType,
      refId: m.refId,
      refNumber: m.refNumber,
      date: m.date,
    });
    return applied;
  }
}
