import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { outputVatRate, taxProfileOf } from '../../../common/settings.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, products, salesOrderLines, salesOrders, tenants, warehouses } from '../../../db/schema';
import { documentTotals, inclusiveDocument, lineTotal } from '../pricing';
import { CreateSalesOrderDto, SalesOrderQueryDto } from '../sales.dto';
import { CreditService } from './credit.service';

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly credit: CreditService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, q: SalesOrderQueryDto) {
    return this.db.query.salesOrders.findMany({
      where: and(
        eq(salesOrders.tenantId, tenantId),
        q.status ? eq(salesOrders.status, q.status) : undefined,
        q.customerId ? eq(salesOrders.customerId, q.customerId) : undefined,
      ),
      with: { customer: { columns: { code: true, name: true } }, invoice: { columns: { id: true, number: true } } },
      orderBy: [desc(salesOrders.date), desc(salesOrders.number)],
      limit: 300,
    });
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const o = await db.query.salesOrders.findFirst({
      where: and(eq(salesOrders.id, id), eq(salesOrders.tenantId, tenantId)),
      with: {
        customer: { columns: { id: true, code: true, name: true } },
        warehouse: { columns: { id: true, code: true, name: true } },
        lines: { with: { product: { columns: { sku: true, name: true, baseUom: true } } } },
        invoice: { columns: { id: true, number: true } },
      },
    });
    if (!o) throw new NotFoundException('Sales order tidak ditemukan');
    return o;
  }

  async create(user: AuthUser, dto: CreateSalesOrderDto) {
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
      if (!customer || !customer.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');

      const prods = await tx.query.products.findMany({
        where: and(eq(products.tenantId, user.tenantId), inArray(products.id, dto.lines.map((l) => l.productId))),
        with: { uoms: true },
      });
      const byId = new Map(prods.map((p) => [p.id, p]));

      const lines = dto.lines.map((l) => {
        const p = byId.get(l.productId);
        if (!p || !p.isActive) throw new BadRequestException(`Produk ${l.productId} tidak ditemukan / nonaktif`);
        const uom = l.uom ?? p.baseUom;
        const factor = uom === p.baseUom ? '1' : p.uoms.find((u) => u.uom === uom)?.factor;
        if (!factor) throw new BadRequestException(`Satuan ${uom} tidak terdaftar untuk ${p.sku}`);
        if (D(l.qty).lte(0)) throw new BadRequestException(`Kuantitas ${p.sku} harus > 0`);
        const discountPct = D(l.discountPct);
        if (discountPct.lt(0) || discountPct.gt(100)) throw new BadRequestException('Diskon harus 0–100%');
        const price = l.price !== undefined ? money(l.price) : money(D(p.sellPrice).times(factor));
        return {
          productId: p.id,
          uom,
          uomFactor: factor,
          qty: l.qty,
          price,
          discountPct,
          lineTotal: lineTotal({ qty: l.qty, price, discountPct }),
        };
      });

      const rate = outputVatRate(tenant);
      const inclusive = !!dto.pricesIncludeVat && D(rate).gt(0);
      const doc = inclusive
        ? inclusiveDocument(lines, rate)
        : { lines: lines.map((l) => ({ ...l, priceInclVat: null })), ...documentTotals(lines, rate, taxProfileOf(tenant.settings).vatRounding) };
      const totals = doc;
      const number = await this.seq.next(tx, user.tenantId, 'SALES_ORDER', date);
      const [order] = await tx
        .insert(salesOrders)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          customerId: customer.id,
          warehouseId: wh.id,
          notes: dto.notes,
          createdById: user.sub,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
          pricesIncludeVat: inclusive,
        })
        .returning({ id: salesOrders.id });
      await tx.insert(salesOrderLines).values(
        doc.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          uom: l.uom,
          uomFactor: l.uomFactor,
          qty: l.qty,
          price: l.price.toFixed(2),
          discountPct: l.discountPct.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          priceInclVat: l.priceInclVat ? l.priceInclVat.toFixed(2) : null,
        })),
      );
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'SalesOrder', entityId: order.id });
      return order.id;
    });
    return this.get(user.tenantId, id);
  }

  /** DRAFT → CONFIRMED: cek faktur jatuh tempo & limit kredit. */
  async confirm(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, id);
      if (order.status !== 'DRAFT') throw new BadRequestException(`Order berstatus ${order.status}, tidak bisa dikonfirmasi`);
      await this.credit.assertCanOrder(tx, user.tenantId, order.customerId, D(order.total), order.id);
      await tx.update(salesOrders).set({ status: 'CONFIRMED' }).where(eq(salesOrders.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CONFIRM', entity: 'SalesOrder', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  async cancel(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, id);
      if (order.status === 'INVOICED') throw new BadRequestException('Order sudah difakturkan; buat retur penjualan');
      if (order.status === 'DELIVERED') throw new BadRequestException('Barang sudah dikirim; batalkan surat jalannya dulu atau buat faktur');
      if (order.status === 'CANCELLED') throw new BadRequestException('Order sudah dibatalkan');
      await tx.update(salesOrders).set({ status: 'CANCELLED' }).where(eq(salesOrders.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'SalesOrder', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  /** Kunci baris order agar konfirmasi/faktur tidak berjalan dua kali bersamaan. */
  async lockOrder(tx: Tx, tenantId: string, id: string) {
    const locked = await tx.execute(sql`
      SELECT id FROM sales_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!locked.rows.length) throw new NotFoundException('Sales order tidak ditemukan');
    const order = await tx.query.salesOrders.findFirst({ where: eq(salesOrders.id, id), with: { lines: true } });
    return order!;
  }
}
