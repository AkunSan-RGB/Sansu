import { inventoryLines, semiSet } from './inventory-accounts';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { WritedownCandidate, WritedownRecoverable } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { inventoryWritedowns, products, users, warehouses } from '../../db/schema';
import { frameworkOf } from '../accounting/coa-sync';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from './stock.service';
import { CreateWritedownDto } from './writedown.dto';
import { insertOne, patchById } from '../../db/owned';

@Injectable()
export class WritedownService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const allowed = allowedWarehouses(user);
    const rows = await this.db
      .select({
        id: inventoryWritedowns.id,
        number: inventoryWritedowns.number,
        kind: inventoryWritedowns.kind,
        date: inventoryWritedowns.date,
        warehouseId: inventoryWritedowns.warehouseId,
        warehouseName: warehouses.name,
        reason: inventoryWritedowns.reason,
        lines: inventoryWritedowns.lines,
        total: inventoryWritedowns.total,
        journalId: inventoryWritedowns.journalId,
        createdByName: users.name,
        createdAt: inventoryWritedowns.createdAt,
      })
      .from(inventoryWritedowns)
      .innerJoin(warehouses, eq(warehouses.id, inventoryWritedowns.warehouseId))
      .leftJoin(users, eq(users.id, inventoryWritedowns.createdById))
      .where(
        and(
          eq(inventoryWritedowns.tenantId, user.tenantId),
          allowed ? inArray(inventoryWritedowns.warehouseId, allowed) : undefined,
        ),
      )
      .orderBy(desc(inventoryWritedowns.date), desc(inventoryWritedowns.number))
      .limit(300);
    return rows;
  }

  async get(user: AuthUser, id: string) {
    const row = (await this.list(user)).find((r) => r.id === id);
    if (!row) throw new NotFoundException('Dokumen penurunan nilai tidak ditemukan');
    return row;
  }

  /**
   * Indikasi penurunan nilai: barang dengan stok yang harga jualnya (dikurangi taksiran biaya menjual)
   * di bawah biaya rata-rata. Barang rusak/usang/kedaluwarsa tetap perlu dinilai manual.
   */
  async candidates(user: AuthUser, warehouseId?: string, costToSellPct = 0): Promise<WritedownCandidate[]> {
    const allowed = allowedWarehouses(user);
    if (warehouseId) assertWarehouseAccess(user, warehouseId);
    const pct = Math.min(Math.max(costToSellPct, 0), 90);
    const res = await this.db.execute<{
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      warehouse_id: string;
      warehouse_name: string;
      qty: string;
      avg_cost: string;
      sell_price: string;
    }>(sql`
      SELECT b.product_id, p.sku, p.name, p.base_uom AS unit, b.warehouse_id, w.name AS warehouse_name,
             b.qty, b.avg_cost, p.sell_price
      FROM stock_balances b
      JOIN products p ON p.id = b.product_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.tenant_id = ${user.tenantId} AND b.qty > 0 AND p.sell_price > 0
        AND p.sell_price * (100 - ${pct}) / 100 < b.avg_cost
        ${warehouseId ? sql`AND b.warehouse_id = ${warehouseId}` : sql``}
        ${
          allowed
            ? sql`AND b.warehouse_id IN (${sql.join(
                allowed.map((a) => sql`${a}`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY (b.avg_cost - p.sell_price * (100 - ${pct}) / 100) * b.qty DESC
      LIMIT 500`);
    return res.rows.map((r) => {
      const nrv = money(
        D(r.sell_price)
          .times(100 - pct)
          .div(100),
      );
      const loss = money(D(r.qty).times(r.avg_cost)).minus(money(D(r.qty).times(nrv)));
      return {
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        qty: D(r.qty).toString(),
        avgCost: D(r.avg_cost).toFixed(2),
        sellPrice: D(r.sell_price).toFixed(2),
        nrv: nrv.toFixed(2),
        loss: loss.toFixed(2),
      };
    });
  }

  /**
   * Barang yang nilainya pernah diturunkan dan masih punya sisa penurunan (bisa dipulihkan).
   * Nilai pulih yang disarankan = min(NRV terkini, biaya sebelum diturunkan).
   */
  async recoverable(user: AuthUser, warehouseId?: string, costToSellPct = 0): Promise<WritedownRecoverable[]> {
    const allowed = allowedWarehouses(user);
    if (warehouseId) assertWarehouseAccess(user, warehouseId);
    const pct = Math.min(Math.max(costToSellPct, 0), 90);
    const res = await this.db.execute<{
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      warehouse_id: string;
      warehouse_name: string;
      qty: string;
      avg_cost: string;
      writedown_unit: string;
      sell_price: string;
    }>(sql`
      SELECT b.product_id, p.sku, p.name, p.base_uom AS unit, b.warehouse_id, w.name AS warehouse_name,
             b.qty, b.avg_cost, b.writedown_unit, p.sell_price
      FROM stock_balances b
      JOIN products p ON p.id = b.product_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.tenant_id = ${user.tenantId} AND b.qty > 0 AND b.writedown_unit > 0
        ${warehouseId ? sql`AND b.warehouse_id = ${warehouseId}` : sql``}
        ${allowed ? sql`AND b.warehouse_id IN (${sql.join(allowed.map((a) => sql`${a}`), sql`, `)})` : sql``}
      ORDER BY b.writedown_unit * b.qty DESC
      LIMIT 500`);
    return res.rows.map((r) => {
      const avg = D(r.avg_cost);
      const maxCost = avg.plus(r.writedown_unit);
      const nrv = money(D(r.sell_price).times(100 - pct).div(100));
      const suggested = nrv.lt(maxCost) ? nrv : maxCost;
      const gain = suggested.gt(avg) ? money(D(r.qty).times(suggested)).minus(money(D(r.qty).times(avg))) : ZERO;
      return {
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        qty: D(r.qty).toString(),
        avgCost: avg.toFixed(2),
        maxCost: maxCost.toFixed(2),
        sellPrice: D(r.sell_price).toFixed(2),
        nrv: nrv.toFixed(2),
        suggestedCost: suggested.gt(avg) ? suggested.toFixed(2) : null,
        gain: gain.toFixed(2),
      };
    });
  }

  async create(user: AuthUser, dto: CreateWritedownDto) {
    const kind = dto.kind ?? 'WRITEDOWN';
    const reversal = kind === 'REVERSAL';
    const date = toDocDate(dto.date);
    const ids = dto.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Barang yang sama tercantum lebih dari sekali');
    assertWarehouseAccess(user, dto.warehouseId);
    // ED SAK EMKM Bab 9: persediaan hanya sebesar biaya perolehan
    if ((await frameworkOf(this.db, user.tenantId)) === 'SAK_EMKM') throw new BadRequestException('SAK EMKM mengukur persediaan sebesar biaya perolehan; penurunan nilai persediaan hanya untuk SAK EP');
    return this.db.transaction(async (tx) => {
      const [wh] = await tx
        .select({ id: warehouses.id, name: warehouses.name })
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      const prods = await tx
        .select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom })
        .from(products)
        .where(and(eq(products.tenantId, user.tenantId), inArray(products.id, ids)));
      const byId = new Map(prods.map((p) => [p.id, p]));
      if (byId.size !== ids.length) throw new BadRequestException('Ada barang yang tidak ditemukan');

      const number = await this.seq.next(tx, user.tenantId, reversal ? 'INVENTORY_WRITEUP' : 'INVENTORY_WRITEDOWN', date);
      const doc = await insertOne(tx, inventoryWritedowns, {
          tenantId: user.tenantId,
          number,
          kind,
          date,
          warehouseId: wh.id,
          reason: dto.reason.trim(),
          createdById: user.sub,
        });

      let total: Dec = ZERO;
      const lines = [];
      const moved: { productId: string; value: Dec }[] = [];
      for (const l of dto.lines) {
        const p = byId.get(l.productId)!;
        const r = await this.stock.revalue(tx, {
          tenantId: user.tenantId,
          productId: p.id,
          warehouseId: wh.id,
          newCost: l.newCost,
          kind,
          refType: 'INVENTORY_WRITEDOWN',
          refId: doc.id,
          refNumber: number,
          date,
        });
        total = total.plus(r.amount);
        moved.push({ productId: p.id, value: r.amount });
        lines.push({
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          qty: r.qty.toString(),
          oldCost: r.oldCost.toFixed(4),
          newCost: r.newCost.toFixed(4),
          amount: r.amount.toFixed(2),
        });
      }
      total = money(total);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `${reversal ? 'Pemulihan' : 'Penurunan'} nilai persediaan ${number} - ${wh.name}: ${dto.reason.trim()}`.slice(0, 500),
        sourceType: 'INVENTORY_WRITEDOWN',
        sourceId: doc.id,
        createdById: user.sub,
        lines: [
          // Pemulihan diakui sebagai pengurang beban penurunan nilai (SAK EP 13.20)
          { key: SYS.INVENTORY_WRITEDOWN, debit: reversal ? 0 : total, credit: reversal ? total : 0 },
          ...inventoryLines(moved, await semiSet(tx, user.tenantId, moved.map((x) => x.productId)), reversal ? 'debit' : 'credit'),
        ],
      });
      await patchById(tx, inventoryWritedowns, doc.id, { lines, total: total.toFixed(2), journalId: journal.id });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'InventoryWritedown',
        entityId: doc.id,
        data: { number, kind, total: total.toFixed(2), items: lines.length },
      });
      return { id: doc.id, number, total: total.toFixed(2), journalNumber: journal.number };
    });
  }
}
