import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseOrderLines, purchaseOrders, suppliers, tenants, warehouses } from '../../db/schema';
import { buildLines } from '../master-data/products/line-builder';
import { taxProfileOf } from '../../common/settings.service';
import { documentTotals } from '../sales/pricing';
import { CreatePurchaseOrderDto, PurchaseOrderQueryDto } from './purchasing.dto';

/** Purchase order: DRAFT → CONFIRMED (dikirim ke supplier) → BILLED (barang & faktur diterima) */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  list(tenantId: string, q: PurchaseOrderQueryDto) {
    return this.db.query.purchaseOrders.findMany({
      where: and(
        eq(purchaseOrders.tenantId, tenantId),
        q.status ? eq(purchaseOrders.status, q.status) : undefined,
        q.supplierId ? eq(purchaseOrders.supplierId, q.supplierId) : undefined,
      ),
      with: { supplier: { columns: { code: true, name: true } }, invoice: { columns: { id: true, number: true } } },
      orderBy: [desc(purchaseOrders.date), desc(purchaseOrders.number)],
      limit: 300,
    });
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const o = await db.query.purchaseOrders.findFirst({
      where: and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)),
      with: {
        supplier: { columns: { id: true, code: true, name: true, address: true, phone: true, npwp: true } },
        warehouse: { columns: { id: true, code: true, name: true, address: true } },
        lines: { with: { product: { columns: { sku: true, name: true, baseUom: true } } } },
        invoice: { columns: { id: true, number: true } },
      },
    });
    if (!o) throw new NotFoundException('Purchase order tidak ditemukan');
    return o;
  }

  async create(user: AuthUser, dto: CreatePurchaseOrderDto) {
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, dto.supplierId), eq(suppliers.tenantId, user.tenantId)));
      if (!supplier || !supplier.isActive) throw new BadRequestException('Supplier tidak ditemukan / nonaktif');
      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');

      const lines = await buildLines(tx, user.tenantId, dto.lines, 'required');
      const totals = documentTotals(lines, tenant.ppnRate, taxProfileOf(tenant.settings).vatRounding);
      const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_ORDER', date);
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          supplierId: supplier.id,
          warehouseId: wh.id,
          notes: dto.notes,
          createdById: user.sub,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
        })
        .returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values(
        lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          uom: l.uom,
          uomFactor: l.uomFactor,
          qty: l.qty,
          price: l.price.toFixed(2),
          discountPct: l.discountPct.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
        })),
      );
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseOrder', entityId: order.id });
      return order.id;
    });
    return this.get(user.tenantId, id);
  }

  async confirm(user: AuthUser, id: string) {
    // Pesanan bernilai besar dari peran yang tidak berwenang: butuh persetujuan (permintaan dibuat di luar transaksi)
    const [po] = await this.db.select({ number: purchaseOrders.number, total: purchaseOrders.total, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, user.tenantId)));
    if (po?.status === 'DRAFT') await this.approvals.gateDocument(this.db, user, { kind: 'PURCHASE_ORDER', refId: id, title: `PO ${po.number}`, amount: Number(po.total) });
    await this.db.transaction(async (tx) => {
      const order = await this.lock(tx, user.tenantId, id);
      if (order.status !== 'DRAFT') throw new BadRequestException(`PO berstatus ${order.status}, tidak bisa dikonfirmasi`);
      await tx.update(purchaseOrders).set({ status: 'CONFIRMED' }).where(eq(purchaseOrders.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CONFIRM', entity: 'PurchaseOrder', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  async cancel(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const order = await this.lock(tx, user.tenantId, id);
      if (order.status === 'BILLED') throw new BadRequestException('PO sudah difakturkan; buat retur pembelian');
      if (order.status === 'CANCELLED') throw new BadRequestException('PO sudah dibatalkan');
      await tx.update(purchaseOrders).set({ status: 'CANCELLED' }).where(eq(purchaseOrders.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'PurchaseOrder', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  async lock(tx: Tx, tenantId: string, id: string) {
    const locked = await tx.execute(sql`
      SELECT id FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!locked.rows.length) throw new NotFoundException('Purchase order tidak ditemukan');
    const order = await tx.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id), with: { lines: true } });
    return order!;
  }
}
