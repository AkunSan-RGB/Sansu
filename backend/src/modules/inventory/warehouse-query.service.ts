import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { D, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { products, stockBalances, stockCounts, stockMinimums, stockTransfers, warehouses } from '../../db/schema';
import { WarehouseOpsService, UUID } from './warehouse-ops.service';
import { findOwned } from '../../db/owned';
import { WarehouseQueryRepository } from './warehouse-query.repository';

@Injectable()
export class WarehouseQueryService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly ops: WarehouseOpsService,
    private readonly repo: WarehouseQueryRepository,
  ) {}


  // ===================== Transfer =====================
  async listTransfers(u: AuthUser, warehouseId?: string) {
    const allowed = allowedWarehouses(u);
    if (warehouseId && !UUID.test(warehouseId)) throw new BadRequestException('Gudang tidak valid');
    if (warehouseId) assertWarehouseAccess(u, warehouseId);
    const rows = await this.repo.queryStockTransfer(this.db, u, warehouseId, allowed);
    return rows.rows;
  }


  async getTransfer(u: AuthUser, id: string) {
    const t = await findOwned(this.db, stockTransfers, u.tenantId, id);
    if (!t) throw new NotFoundException('Transfer tidak ditemukan');
    const allowed = allowedWarehouses(u);
    if (allowed && !allowed.includes(t.fromWarehouseId) && !allowed.includes(t.toWarehouseId))
      throw new NotFoundException('Transfer tidak ditemukan');
    const [from, to] = await Promise.all([
      this.ops.warehouse(this.db, u.tenantId, t.fromWarehouseId),
      this.ops.warehouse(this.db, u.tenantId, t.toWarehouseId),
    ]);
    const lines = await this.repo.listStockTransferLinesWithProductsByTransferId(this.db, id);
    const [by] = t.createdById
      ? await this.repo.listUsersById(this.db, t.createdById)
      : [];
    const [rb] = t.receivedById
      ? await this.repo.listUsersByIdForGetTransfer(this.db, t.receivedById)
      : [];
    return {
      ...t,
      from: { id: from.id, code: from.code, name: from.name, address: from.address },
      to: { id: to.id, code: to.code, name: to.name, address: to.address },
      createdBy: by?.name ?? null,
      receivedBy: rb?.name ?? null,
      lines,
    };
  }


  // ===================== Stock opname =====================
  async listCounts(u: AuthUser, warehouseId?: string) {
    return this.db
      .select({
        id: stockCounts.id,
        number: stockCounts.number,
        date: stockCounts.date,
        status: stockCounts.status,
        category: stockCounts.category,
        notes: stockCounts.notes,
        adjustmentNumber: stockCounts.adjustmentNumber,
        warehouseId: stockCounts.warehouseId,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        binId: stockCounts.binId,
        binCode: sql<string | null>`(SELECT b.code FROM warehouse_bins b WHERE b.id = ${stockCounts.binId})`,
        lines: sql<number>`(SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = ${stockCounts.id})::int`,
        counted: sql<number>`(SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = ${stockCounts.id} AND l.counted_qty IS NOT NULL)::int`,
        createdAt: stockCounts.createdAt,
      })
      .from(stockCounts)
      .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
      .where(and(eq(stockCounts.tenantId, u.tenantId), this.ops.scope(u, stockCounts.warehouseId, warehouseId)))
      .orderBy(desc(stockCounts.createdAt))
      .limit(300);
  }


  async getCount(u: AuthUser, id: string) {
    const c = await this.ops.ownCount(u, id);
    const wh = await this.ops.warehouse(this.db, u.tenantId, c.warehouseId);
    const lines = await this.repo.sumStockCountLinesWithProductsByCountId(this.db, c, id);
    // Opname buta: penghitung (Gudang) tidak melihat stok sistem selama opname masih berjalan
    const blind = u.role === 'WAREHOUSE' && c.status === 'DRAFT' && (await this.approvals.policy(this.db, u.tenantId)).blindCount;
    const binCode = c.binId ? ((await this.repo.queryWarehouseBin(this.db, c.binId)).rows[0]?.code ?? null) : null;
    return {
      ...c,
      binCode,
      blindCount: blind,
      warehouse: { id: wh.id, code: wh.code, name: wh.name },
      lines: blind ? lines.map((l) => ({ ...l, systemQty: '0', currentQty: '0', avgCost: '0' })) : lines,
    };
  }


  // ===================== Stok minimum =====================
  async minimums(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    await this.ops.warehouse(this.db, u.tenantId, warehouseId);
    return this.repo.listProductsByIsActiveAndSku(this.db, warehouseId, u.tenantId);
  }


  /** Produk yang stoknya di bawah minimum (semua gudang yang boleh diakses) */
  async lowStock(u: AuthUser, warehouseId?: string) {
    const rows = await this.db
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        baseUom: products.baseUom,
        warehouseId: warehouses.id,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        qty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        minQty: stockMinimums.minQty,
      })
      .from(stockMinimums)
      .innerJoin(products, eq(products.id, stockMinimums.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockMinimums.warehouseId))
      .leftJoin(
        stockBalances,
        and(
          eq(stockBalances.productId, stockMinimums.productId),
          eq(stockBalances.warehouseId, stockMinimums.warehouseId),
        ),
      )
      .where(
        and(
          eq(stockMinimums.tenantId, u.tenantId),
          eq(products.isActive, true),
          eq(warehouses.isActive, true),
          sql`COALESCE(${stockBalances.qty}, 0) < ${stockMinimums.minQty}`,
          this.ops.scope(u, stockMinimums.warehouseId, warehouseId),
        ),
      )
      .orderBy(asc(warehouses.code), asc(products.sku));
    return rows.map((r) => ({ ...r, shortage: D(r.minQty).minus(r.qty).toFixed(4) }));
  }


  // ===================== Rekap semua gudang =====================
  async matrix(u: AuthUser, opts: { includeZero?: boolean; category?: string }) {
    const allowed = allowedWarehouses(u);
    const whs = await this.repo.listWarehousesByIdAndCode(this.db, u.tenantId, allowed);
    const ids = whs.map((w) => w.id);
    const bal = ids.length
      ? await this.repo.listStockBalancesByWarehouseId(this.db, u.tenantId, ids)
      : [];
    const mins = ids.length
      ? await this.repo.listStockMinimumsByWarehouseId(this.db, u.tenantId, ids)
      : [];
    const prods = await this.repo.listProductsByCategoryAndSku(this.db, u.tenantId, opts);
    const byProd = new Map<
      string,
      {
        qty: Record<string, string>;
        value: ReturnType<typeof D>;
        total: ReturnType<typeof D>;
        min: Record<string, string>;
      }
    >();
    const get = (id: string) => {
      let r = byProd.get(id);
      if (!r) byProd.set(id, (r = { qty: {}, value: ZERO, total: ZERO, min: {} }));
      return r;
    };
    for (const b of bal) {
      const r = get(b.productId);
      r.qty[b.warehouseId] = D(b.qty).toFixed(4);
      r.total = r.total.plus(b.qty);
      r.value = r.value.plus(D(b.qty).times(b.avgCost));
    }
    for (const m of mins) get(m.productId).min[m.warehouseId] = D(m.minQty).toFixed(4);
    const rows = prods
      .map((p) => {
        const r = byProd.get(p.id);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          baseUom: p.baseUom,
          isActive: p.isActive,
          qty: r?.qty ?? {},
          min: r?.min ?? {},
          totalQty: (r?.total ?? ZERO).toFixed(4),
          value: (r?.value ?? ZERO).toFixed(2),
        };
      })
      .filter((r) => (opts.includeZero ? r.isActive || !D(r.totalQty).isZero() : !D(r.totalQty).isZero()));
    const totals = {
      value: rows.reduce((s, r) => s.plus(r.value), ZERO).toFixed(2),
      byWarehouse: Object.fromEntries(
        ids.map((id) => [
          id,
          bal
            .filter((b) => b.warehouseId === id)
            .reduce((s, b) => s.plus(D(b.qty).times(b.avgCost)), ZERO)
            .toFixed(2),
        ]),
      ),
    };
    return { warehouses: whs, rows, totals };
  }
}
