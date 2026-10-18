import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, deliveryOrders, invoiceLines, invoices, payments, salesOrders } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { StockService } from '../../inventory/stock.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { CreateInvoiceDto, InvoiceQueryDto } from '../sales.dto';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly deliveries: DeliveriesService,
    private readonly posting: PostingService,
    private readonly orders: SalesOrdersService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, q: InvoiceQueryDto) {
    return this.db.query.invoices.findMany({
      where: and(
        eq(invoices.tenantId, tenantId),
        q.status ? eq(invoices.status, q.status) : undefined,
        q.customerId ? eq(invoices.customerId, q.customerId) : undefined,
      ),
      with: { customer: { columns: { code: true, name: true } } },
      orderBy: [desc(invoices.date), desc(invoices.number)],
      limit: 300,
    });
  }

  async get(tenantId: string, id: string) {
    const inv = await this.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)),
      with: {
        customer: true,
        salesOrder: { columns: { number: true } },
        lines: { with: { product: { columns: { sku: true, name: true } } } },
        serviceLines: { with: { account: { columns: { code: true, name: true } } } },
        project: { columns: { id: true, code: true, name: true } },
        payments: { orderBy: [asc(payments.date)] },
      },
    });
    if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
    return inv;
  }

  /**
   * Faktur dari sales order — satu transaksi atomik:
   *  1. Kurangi stok (HPP rata-rata) per baris
   *  2. Buat faktur
   *  3. Jurnal: Dr Piutang | Cr Penjualan, Cr PPN Keluaran | Dr HPP | Cr Persediaan
   *  4. Order → INVOICED
   * Jika salah satu gagal (mis. stok kurang), semuanya dibatalkan.
   */
  /** Staf (selain Pemilik/Admin) hanya boleh menagih pesanan yang sudah dikirim Gudang (ada surat jalan) */
  async assertDeliveredBeforeInvoice(user: AuthUser, orderId: string) {
    if (['OWNER', 'ADMIN'].includes(user.role)) return;
    const [o] = await this.db.select({ status: salesOrders.status }).from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.tenantId, user.tenantId)));
    if (o?.status === 'CONFIRMED') {
      throw new BadRequestException('Barang pada pesanan ini belum dikirim Gudang. Minta Gudang mencatat pengiriman (surat jalan) dulu, baru faktur dicatat.');
    }
  }

  async createFromOrder(user: AuthUser, dto: CreateInvoiceDto) {
    const date = toDocDate(dto.date);
    const result = await this.db.transaction(async (tx) => {
      const order = await this.orders.lockOrder(tx, user.tenantId, dto.salesOrderId);
      if (order.status !== 'CONFIRMED' && order.status !== 'DELIVERED') {
        throw new BadRequestException(`Order berstatus ${order.status}; hanya order CONFIRMED atau sudah dikirim yang bisa difakturkan`);
      }
      // Sudah dikirim: stok dan HPP dicatat di surat jalan, faktur hanya piutang + penjualan + PPN
      const delivery = order.status === 'DELIVERED' ? await this.deliveries.activeFor(tx, order.id) : undefined;
      if (order.status === 'DELIVERED' && !delivery) throw new BadRequestException('Surat jalan pesanan ini tidak ditemukan');
      const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
      const number = await this.seq.next(tx, user.tenantId, 'INVOICE', date);

      // Header dulu untuk mendapatkan id (referensi kartu stok)
      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          dueDate: addDays(date, customer.paymentTermDays),
          customerId: customer.id,
          salesOrderId: order.id,
          deliveryOrderId: delivery?.id,
          subtotal: order.subtotal,
          taxAmount: order.taxAmount,
          total: order.total,
          currency: order.currency,
          fxRate: order.fxRate,
          totalForeign: order.totalForeign,
        })
        .returning();

      let cogs: Dec = ZERO;
      const costs = new Map<string, { unitCost: Dec }>();
      for (const line of order.lines) {
        let unitCost: Dec;
        if (delivery) {
          const dl = delivery.lines.find((x) => x.orderLineId === line.id);
          if (!dl) throw new BadRequestException('Baris surat jalan tidak cocok dengan pesanan');
          unitCost = D(dl.unitCost);
        } else {
          const baseQty = D(line.qty).times(line.uomFactor);
          const moved = await this.stock.move(tx, {
            tenantId: user.tenantId,
            productId: line.productId,
            warehouseId: order.warehouseId,
            type: 'SALE',
            qty: baseQty.negated(),
            refType: 'INVOICE',
            refId: invoice.id,
            refNumber: number,
            date,
          });
          cogs = cogs.plus(moved.value);
          unitCost = moved.unitCost;
        }
        costs.set(line.id, { unitCost });
        await tx.insert(invoiceLines).values({
          invoiceId: invoice.id,
          productId: line.productId,
          uom: line.uom,
          uomFactor: line.uomFactor,
          qty: line.qty,
          price: line.price,
          priceForeign: line.priceForeign,
          discountPct: line.discountPct,
          lineTotal: line.lineTotal,
          unitCost: unitCost.toFixed(4),
        });
      }
      cogs = delivery ? D(delivery.cogsAmount) : money(cogs);

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Penjualan ${number} - ${customer.name}`,
        sourceType: 'INVOICE',
        sourceId: invoice.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AR, debit: order.total },
          { key: SYS.SALES, credit: order.subtotal },
          { key: SYS.VAT_OUT, credit: order.taxAmount },
          ...(delivery ? [] : [{ key: SYS.COGS, debit: cogs }, { key: SYS.INVENTORY, credit: cogs }]),
        ],
      });

      if (delivery) {
        await tx.update(deliveryOrders).set({ invoiceId: invoice.id }).where(eq(deliveryOrders.id, delivery.id));
      } else {
        const sj = await this.deliveries.recordWithInvoice(tx, user, { order, date, invoiceId: invoice.id, cogs, costs });
        await tx.update(invoices).set({ deliveryOrderId: sj.id }).where(eq(invoices.id, invoice.id));
      }
      await tx.update(salesOrders).set({ status: 'INVOICED' }).where(eq(salesOrders.id, order.id));
      await tx
        .update(invoices)
        .set({ cogsAmount: cogs.toFixed(2), journalId: journal.id })
        .where(eq(invoices.id, invoice.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'Invoice',
        entityId: invoice.id,
        data: { number, journal: journal.number },
      });
      return { id: invoice.id, journalNumber: journal.number };
    });
    return { ...(await this.get(user.tenantId, result.id)), journalNumber: result.journalNumber };
  }

  /** Umur piutang per pelanggan: belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari. */
  async arAging(tenantId: string) {
    const today = todayJakarta();
    const open = await this.db.query.invoices.findMany({
      where: and(eq(invoices.tenantId, tenantId), ne(invoices.status, 'PAID')),
      with: { customer: { columns: { id: true, code: true, name: true } } },
    });
    type Bucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
    const map = new Map<string, { customer: { id: string; code: string; name: string }; total: Dec } & Record<Bucket, Dec>>();

    for (const inv of open) {
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      const days = diffDays(inv.dueDate, today);
      const bucket: Bucket = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const row = map.get(inv.customerId) ?? {
        customer: inv.customer,
        total: ZERO,
        current: ZERO,
        d1_30: ZERO,
        d31_60: ZERO,
        d61_90: ZERO,
        d90_plus: ZERO,
      };
      row[bucket] = row[bucket].plus(outstanding);
      row.total = row.total.plus(outstanding);
      map.set(inv.customerId, row);
    }
    return [...map.values()].sort((a, b) => b.total.comparedTo(a.total));
  }
}
