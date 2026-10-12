import { inventoryLines, semiSet } from './inventory-accounts';
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { products, stockBalances, stockMoves, warehouses } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockAdjustmentDto, StockQueryDto } from './dto/inventory.dto';
import { StockService } from './stock.service';

@Injectable()
export class InventoryService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async balances(tenantId: string, q: StockQueryDto, u?: AuthUser) {
    if (q.warehouseId) assertWarehouseAccess(u, q.warehouseId);
    const allowed = allowedWarehouses(u);
    const rows = await this.db
      .select({
        productId: stockBalances.productId,
        warehouseId: stockBalances.warehouseId,
        qty: stockBalances.qty,
        avgCost: stockBalances.avgCost,
        sku: products.sku,
        productName: products.name,
        baseUom: products.baseUom,
        warehouseCode: warehouses.code,
      })
      .from(stockBalances)
      .innerJoin(products, eq(products.id, stockBalances.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          q.warehouseId ? eq(stockBalances.warehouseId, q.warehouseId) : allowed ? inArray(stockBalances.warehouseId, allowed) : undefined,
          q.productId ? eq(stockBalances.productId, q.productId) : undefined,
        ),
      )
      .orderBy(products.sku);
    return rows.map((r) => ({ ...r, value: D(r.qty).times(r.avgCost).toFixed(2) }));
  }

  /** Kartu stok */
  moves(tenantId: string, q: StockQueryDto, u?: AuthUser) {
    if (q.warehouseId) assertWarehouseAccess(u, q.warehouseId);
    const allowed = allowedWarehouses(u);
    return this.db.query.stockMoves.findMany({
      where: and(
        eq(stockMoves.tenantId, tenantId),
        q.warehouseId ? eq(stockMoves.warehouseId, q.warehouseId) : allowed ? inArray(stockMoves.warehouseId, allowed) : undefined,
        q.productId ? eq(stockMoves.productId, q.productId) : undefined,
      ),
      with: { product: { columns: { sku: true, name: true } }, warehouse: { columns: { code: true } } },
      orderBy: [desc(stockMoves.createdAt)],
      limit: 300,
    });
  }

  /**
   * Penyesuaian stok (saldo awal, hasil stock opname, barang rusak).
   * Membuat mutasi stok + jurnal persediaan dalam satu transaksi.
   */
  async adjust(user: AuthUser, dto: StockAdjustmentDto, outerTx?: Tx) {
    const date = toDocDate(dto.date);
    const run = async (tx: Tx) => {
      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');

      const productIds = [...new Set(dto.lines.map((l) => l.productId))];
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, user.tenantId), inArray(products.id, productIds)));
      if (found.length !== productIds.length) throw new BadRequestException('Ada produk yang tidak ditemukan');

      const id = randomUUID();
      const number = await this.seq.next(tx, user.tenantId, 'STOCK_ADJUSTMENT', date);
      let valueIn: Dec = ZERO;
      let valueOut: Dec = ZERO;
      const ins: { productId: string; value: Dec }[] = [];
      const outs: { productId: string; value: Dec }[] = [];

      for (const line of dto.lines) {
        const qty = D(line.qty);
        const r = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: line.productId,
          warehouseId: dto.warehouseId,
          type: qty.isPositive() ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          qty,
          unitCost: line.unitCost,
          refType: 'STOCK_ADJUSTMENT',
          refId: id,
          refNumber: number,
          date,
        });
        if (qty.isPositive()) {
          valueIn = valueIn.plus(r.value);
          ins.push({ productId: line.productId, value: r.value });
        } else {
          valueOut = valueOut.plus(r.value);
          outs.push({ productId: line.productId, value: r.value });
        }
      }

      const semi = await semiSet(tx, user.tenantId, dto.lines.map((l) => l.productId));
      // Saldo awal → Ekuitas Saldo Awal; selain itu → Selisih Persediaan
      const counterKey = dto.reason === 'OPENING' ? SYS.OPENING_EQUITY : SYS.INVENTORY_ADJ;
      let journalNumber: string | null = null;
      if (valueIn.plus(valueOut).gt(0)) {
        const journal = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description: `Penyesuaian stok ${number} (${dto.reason})${dto.notes ? ' - ' + dto.notes : ''}`,
          sourceType: 'STOCK_ADJUSTMENT',
          sourceId: id,
          createdById: user.sub,
          lines: [
            ...inventoryLines(ins, semi, 'debit'),
            { key: counterKey, credit: valueIn },
            { key: SYS.INVENTORY_ADJ, debit: valueOut },
            ...inventoryLines(outs, semi, 'credit'),
          ],
        });
        journalNumber = journal.number;
      }

      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'STOCK_ADJUST',
        entity: 'StockAdjustment',
        entityId: id,
        data: { number, reason: dto.reason, lines: dto.lines },
      });

      return { id, number, valueIn: valueIn.toFixed(2), valueOut: valueOut.toFixed(2), journalNumber };
    };
    // dipakai juga oleh impor data (satu transaksi untuk seluruh file)
    return outerTx ? run(outerTx) : this.db.transaction(run);
  }
}
