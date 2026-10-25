/**
 * Surat jalan (pengiriman barang) — mata rantai antara pesanan dan faktur:
 *   penawaran → pesanan → surat jalan → faktur → pembayaran → jurnal & laporan
 *
 * Dua jalur, hasil pembukuan sama:
 *  - Kirim dulu: surat jalan mengeluarkan stok dan mencatat HPP (Dr HPP | Cr Persediaan). Faktur menyusul dan hanya mencatat
 *    piutang, penjualan, dan PPN keluaran. Surat jalan yang belum difakturkan bisa dibatalkan (stok dan jurnal dibalik).
 *  - Langsung faktur: stok dan HPP dicatat bersama faktur (seperti sebelumnya) dan surat jalan dibuat otomatis, sudah terkait faktur.
 * Pengiriman parsial: satu pesanan boleh dikirim bertahap (beberapa surat jalan). Pesanan tetap CONFIRMED sampai semua barang terkirim,
 * lalu DELIVERED; faktur baru bisa dibuat setelah semua terkirim dan menagih seluruh pesanan (belum ada faktur per surat jalan).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { WorkflowService } from '../../workflow/workflow.service';
import { ApprovalsService } from '../../../common/approvals/approvals.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { DocDate, toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { deliveryOrders, salesOrders } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { StockService } from '../../inventory/stock.service';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { insertOne, patchById } from '../../../db/owned';
import { DeliveriesRepository } from './deliveries.repository';
import type { OrderWithLines } from './deliveries.repository';

@Injectable()
export class DeliveriesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly orders: SalesOrdersService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly approvals: ApprovalsService,
    private readonly repo: DeliveriesRepository,
  ) {}

  /** Kirim barang atas pesanan CONFIRMED: stok keluar, HPP dijurnal, pesanan → DELIVERED */
  async deliver(user: AuthUser, orderId: string, dto: { date?: string; notes?: string; lines?: { orderLineId: string; qty: string }[] }) {
    await this.workflow.gate(user.tenantId, 'DELIVER', orderId);
    const date = toDocDate(dto.date);
    // Pengiriman buta: Gudang mengisi jumlah yang dikemasnya; harus sama dengan pesanan (pengiriman tidak parsial), selisih ditahan dan dikabarkan
    const blind = user.role === 'WAREHOUSE' && (await this.approvals.policy(this.db, user.tenantId)).blindDelivery;
    if (blind && !dto.lines?.length) throw new BadRequestException('Isi jumlah barang yang Anda kemas pada setiap baris (pengiriman buta); jangan mengirim otomatis sesuai pesanan.');
    if (blind) await this.assertPackedMatches(user, orderId, dto.lines!);
    let complete = true;
    const id = await this.db.transaction(async (tx) => {
      const order = await this.orders.lockOrder(tx, user.tenantId, orderId);
      if (order.status !== 'CONFIRMED') {
        throw new BadRequestException(`Pesanan berstatus ${order.status}; hanya pesanan CONFIRMED yang bisa dikirim`);
      }
      const [customer] = await this.repo.findCustomersById(tx, order.customerId);
      const number = await this.seq.next(tx, user.tenantId, 'DELIVERY', date);
      const delivery = await insertOne(tx, deliveryOrders, {
          tenantId: user.tenantId,
          number,
          date,
          salesOrderId: order.id,
          customerId: order.customerId,
          warehouseId: order.warehouseId,
          notes: dto.notes,
          createdById: user.sub,
        });

      const remaining = await this.remainingQty(tx, order.id, order.lines);
      const ship = this.planShipment(order.lines, remaining, dto.lines);
      let cogs: Dec = ZERO;
      for (const { line, qty } of ship) {
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: line.productId,
          warehouseId: order.warehouseId,
          type: 'SALE',
          qty: qty.times(line.uomFactor).negated(),
          refType: 'DELIVERY',
          refId: delivery.id,
          refNumber: number,
          date,
        });
        cogs = cogs.plus(moved.value);
        await this.repo.insertDeliveryOrderLines(tx, delivery.id, line.id, line.productId, line.uom, line.uomFactor, qty, moved.unitCost);
      }
      complete = order.lines.every((l) => D(remaining.get(l.id) ?? 0).minus(ship.find((x) => x.line.id === l.id)?.qty ?? 0).lte(0));
      cogs = money(cogs);
      let journalId: string | null = null;
      if (cogs.gt(0)) {
        const journal = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description: `Pengiriman ${number} - ${customer.name}`,
          sourceType: 'DELIVERY',
          sourceId: delivery.id,
          createdById: user.sub,
          lines: [
            { key: SYS.COGS, debit: cogs },
            { key: SYS.INVENTORY, credit: cogs },
          ],
        });
        journalId = journal.id;
      }
      await patchById(tx, deliveryOrders, delivery.id, { cogsAmount: cogs.toFixed(2), journalId });
      if (complete) await patchById(tx, salesOrders, order.id, { status: 'DELIVERED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'DeliveryOrder', entityId: delivery.id, data: { number, partial: !complete } });
      return delivery.id;
    });
    const rec = await this.get(user.tenantId, id);
    // Penagihan tahu barang sudah keluar (siap ditagih); Sales tahu pesanannya terkirim
    if (complete) void this.approvals.notifyRoles(user.tenantId, { roles: ['FINANCE', 'ADMIN'], excludeUserId: user.sub, info: true, title: `Surat jalan ${(rec as { number: string }).number} terkirim, siap ditagih`, lines: ['Catat faktur penjualan atas barang yang sudah dikirim.'], path: '/deliveries' });
    void this.approvals.notifyRoles(user.tenantId, { roles: ['SALES'], excludeUserId: user.sub, info: true, title: complete ? `Pesanan ${(rec as { number: string }).number} sudah dikirim Gudang` : `Pesanan sebagian dikirim (surat jalan ${(rec as { number: string }).number}); sisanya menyusul`, lines: [], path: '/deliveries' });
    return rec;
  }

  /** Sisa yang belum dikirim per baris pesanan (pesanan dikurangi surat jalan aktif) */
  async remainingQty(db: Db | Tx, orderId: string, lines: { id: string; qty: string }[]) {
    const r = await this.repo.queryDeliveryOrderLine(db, orderId);
    const sent = new Map(r.rows.map((x) => [x.order_line_id, D(x.q)]));
    return new Map(lines.map((l) => [l.id, D(l.qty).minus(sent.get(l.id) ?? 0)]));
  }

  /** Tentukan jumlah yang dikirim per baris: sesuai permintaan (tidak melebihi sisa) atau seluruh sisa bila tidak diisi */
  private planShipment<L extends { id: string }>(lines: L[], remaining: Map<string, Dec>, asked?: { orderLineId: string; qty: string }[]) {
    if (asked?.some((a) => !lines.some((l) => l.id === a.orderLineId))) throw new BadRequestException('Baris pesanan tidak ditemukan');
    const ship: { line: L; qty: Dec }[] = [];
    for (const l of lines) {
      const left = remaining.get(l.id) ?? ZERO;
      const want = asked ? D(asked.find((a) => a.orderLineId === l.id)?.qty ?? 0) : left;
      if (want.lt(0)) throw new BadRequestException('Jumlah kirim tidak boleh negatif');
      if (want.gt(left)) throw new BadRequestException('Jumlah kirim melebihi sisa pesanan yang belum dikirim');
      if (want.gt(0)) ship.push({ line: l, qty: want });
    }
    if (!ship.length) throw new BadRequestException('Tidak ada barang yang dikirim: semua sudah terkirim atau jumlah kirim kosong');
    return ship;
  }

  /** Jumlah yang dikemas Gudang harus sama dengan sisa yang belum dikirim; selisih menahan pengiriman dan dikabarkan ke Penjualan/Admin/Pemilik */
  private async assertPackedMatches(user: AuthUser, orderId: string, packed: { orderLineId: string; qty: string }[]) {
    const order = await this.db.query.salesOrders.findFirst({ where: and(eq(salesOrders.id, orderId), eq(salesOrders.tenantId, user.tenantId)), with: { lines: true } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    const remaining = await this.remainingQty(this.db, order.id, order.lines);
    const diffs: string[] = [];
    for (const l of order.lines) {
      const got = D(packed.find((p) => p.orderLineId === l.id)?.qty ?? '0');
      if (!got.eq(D(remaining.get(l.id) ?? 0))) diffs.push(l.productId);
    }
    if (packed.some((p) => !order.lines.some((l) => l.id === p.orderLineId))) throw new BadRequestException('Baris pesanan tidak ditemukan');
    if (!diffs.length) return;
    void this.approvals.notifyRoles(user.tenantId, { roles: ['SALES', 'ADMIN', 'OWNER'], excludeUserId: user.sub, title: `⚠ Pengiriman ${order.number} ditahan: ${diffs.length} baris jumlah kemasnya tidak sama dengan pesanan`, lines: ['Gudang menghitung berbeda dari pesanan. Periksa stok atau ubah pesanannya.'], path: '/sales-orders' });
    throw new BadRequestException(`Jumlah yang dikemas tidak sama dengan pesanan pada ${diffs.length} baris. Pengiriman ditahan; Penjualan/Admin sudah diberi tahu. Hitung ulang atau minta pesanan dikoreksi.`);
  }

  /** Batalkan surat jalan yang belum difakturkan: stok kembali dengan harga pokok semula, jurnal HPP dibalik, pesanan → CONFIRMED */
  async cancel(user: AuthUser, id: string, dto: { date?: string; reason?: string }) {
    const date = toDocDate(dto.date);
    // Surat jalan dibatalkan staf: barang sudah keluar fisik, jadi alasan wajib dan Pemilik/Admin diberi tahu
    if (!this.approvals.isApprover(user.role) && (dto.reason?.trim().length ?? 0) < 5) throw new BadRequestException('Isi alasan pembatalan surat jalan (minimal 5 huruf)');
    let dnNumber = '';
    await this.db.transaction(async (tx) => {
      const locked = await this.repo.queryDeliveryOrder(tx, id, user.tenantId);
      if (!locked.rows.length) throw new NotFoundException('Surat jalan tidak ditemukan');
      const delivery = await tx.query.deliveryOrders.findFirst({ where: eq(deliveryOrders.id, id), with: { lines: true } });
      if (!delivery) throw new NotFoundException('Surat jalan tidak ditemukan');
      if (delivery.status === 'CANCELLED') throw new BadRequestException('Surat jalan sudah dibatalkan');
      if (delivery.invoiceId) throw new BadRequestException('Surat jalan sudah difakturkan; koreksi lewat retur penjualan');
      await this.orders.lockOrder(tx, user.tenantId, delivery.salesOrderId);
      for (const l of delivery.lines) {
        const wd = await this.repo.queryStockMove(tx, delivery.id, l.productId);
        await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.productId,
          warehouseId: delivery.warehouseId,
          type: 'SALE_RETURN',
          qty: D(l.qty).times(l.uomFactor),
          unitCost: l.unitCost,
          writedownUnit: D(wd.rows[0]?.wu ?? 0),
          refType: 'DELIVERY_CANCEL',
          refId: delivery.id,
          refNumber: delivery.number,
          date,
        });
      }
      if (delivery.journalId) await this.posting.reverse(tx, user.tenantId, delivery.journalId, date, user.sub, true);
      dnNumber = delivery.number;
      await patchById(tx, deliveryOrders, id, { status: 'CANCELLED', cancelReason: dto.reason?.trim() || null, cancelledById: user.sub });
      await patchById(tx, salesOrders, delivery.salesOrderId, { status: 'CONFIRMED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'DeliveryOrder', entityId: id, data: { reason: dto.reason?.trim() || null } });
    });
    void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER', 'ADMIN', 'WAREHOUSE'], excludeUserId: user.sub, info: true, title: `Surat jalan ${dnNumber} dibatalkan`, lines: [dto.reason?.trim() ? `Alasan: ${dto.reason.trim()}` : 'Tanpa alasan tertulis'], path: '/deliveries' });
    return this.get(user.tenantId, id);
  }

  /**
   * Dipanggil faktur yang langsung dibuat dari pesanan (stok sudah keluar bersama faktur): catat surat jalan otomatis
   * yang sudah terkait faktur, supaya rantai dokumen selalu lengkap.
   */
  async recordWithInvoice(
    tx: Tx,
    user: AuthUser,
    p: { order: OrderWithLines; date: DocDate; invoiceId: string; cogs: Dec; costs: Map<string, { unitCost: Dec }> },
  ) {
    const number = await this.seq.next(tx, user.tenantId, 'DELIVERY', p.date);
    const delivery = await insertOne(tx, deliveryOrders, {
        tenantId: user.tenantId,
        number,
        date: p.date,
        salesOrderId: p.order.id,
        customerId: p.order.customerId,
        warehouseId: p.order.warehouseId,
        cogsAmount: p.cogs.toFixed(2),
        invoiceId: p.invoiceId,
        notes: 'Dibuat otomatis bersama faktur',
        createdById: user.sub,
      });
    for (const line of p.order.lines) {
      await this.repo.insertDeliveryOrderLinesForRecordWithInvoice(tx, delivery.id, line.id, line.productId, line.uom, line.uomFactor, line.qty, p);
    }
    return delivery;
  }

  /** Surat jalan aktif (belum dibatalkan) untuk sebuah pesanan */
  activeFor(tx: Tx, orderId: string) {
    return tx.query.deliveryOrders.findFirst({
      where: and(eq(deliveryOrders.salesOrderId, orderId), eq(deliveryOrders.status, 'DELIVERED')),
      with: { lines: true },
    });
  }

  /** Semua surat jalan aktif sebuah pesanan (pengiriman bisa bertahap) */
  activeAll(tx: Tx, orderId: string) {
    return tx.query.deliveryOrders.findMany({
      where: and(eq(deliveryOrders.salesOrderId, orderId), eq(deliveryOrders.status, 'DELIVERED')),
      with: { lines: true },
      orderBy: [deliveryOrders.createdAt],
    });
  }

  async list(tenantId: string, q: { from?: string; to?: string }) {
    const where = [eq(deliveryOrders.tenantId, tenantId)];
    if (q.from) where.push(gte(deliveryOrders.date, q.from));
    if (q.to) where.push(lte(deliveryOrders.date, q.to));
    return this.db.query.deliveryOrders.findMany({
      where: and(...where),
      orderBy: [desc(deliveryOrders.date), desc(deliveryOrders.number)],
      limit: 500,
      with: {
        customer: { columns: { id: true, code: true, name: true } },
        salesOrder: { columns: { id: true, number: true } },
        invoice: { columns: { id: true, number: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const d = await this.db.query.deliveryOrders.findFirst({
      where: and(eq(deliveryOrders.id, id), eq(deliveryOrders.tenantId, tenantId)),
      with: {
        customer: true,
        warehouse: true,
        salesOrder: { columns: { id: true, number: true } },
        invoice: { columns: { id: true, number: true } },
        lines: { with: { product: { columns: { id: true, sku: true, name: true } } } },
      },
    });
    if (!d) throw new NotFoundException('Surat jalan tidak ditemukan');
    return d;
  }

  /**
   * Jejak dokumen: penawaran → pesanan → surat jalan → faktur → pembayaran / retur → jurnal.
   * Bisa dimulai dari pesanan atau dari faktur.
   */
  async chain(tenantId: string, ref: { orderId?: string; invoiceId?: string }) {
    let orderId = ref.orderId;
    let invoiceId = ref.invoiceId;
    if (!orderId && invoiceId) {
      const r = await this.repo.queryInvoice(this.db, invoiceId, tenantId);
      if (!r.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      orderId = r.rows[0].sales_order_id ?? undefined;
    }
    const quotation = orderId ? ((await this.repo.queryQuotation(this.db, tenantId, orderId)).rows)[0] ?? null : null;
    const order = orderId ? ((await this.repo.querySalesOrder(this.db, tenantId, orderId)).rows)[0] ?? null : null;
    const deliveries = orderId
      ? (await this.repo.queryDeliveryOrderForChain(this.db, tenantId, orderId)).rows
      : [];
    const invoice = (
      (await this.repo.queryInvoiceForChain(this.db, invoiceId, tenantId, orderId)).rows
    )[0] ?? null;
    const payments = invoice
      ? (await this.repo.queryPayment(this.db, tenantId, invoice.id)).rows
      : [];
    const returns = invoice
      ? (await this.repo.querySalesReturn(this.db, tenantId, invoice.id)).rows
      : [];
    const journalIds = [...deliveries.map((d) => d.journal_id), invoice?.journal_id, ...payments.map((p) => p.journal_id), ...returns.map((r) => r.journal_id)].filter((x): x is string => !!x);
    const journals = journalIds.length
      ? (await this.repo.queryJournalEntry(this.db, tenantId, journalIds)).rows
      : [];
    return { quotation, order, deliveries, invoice, payments, returns, journals };
  }
}
