/**
 * Penerimaan barang (GRN) atas pesanan pembelian — mata rantai antara pesanan dan faktur supplier:
 *   pesanan → penerimaan barang (bisa bertahap) → faktur supplier (bisa bertahap) → pembayaran → jurnal & laporan
 *
 * Dua jalur, hasil pembukuan sama:
 *  - Terima dulu: penerimaan menambah stok dan mencatat Dr Persediaan | Cr Barang Diterima Belum Ditagih. Faktur menyusul
 *    (sebagian atau seluruhnya) dan memindahkan akun itu ke Utang Usaha. Penerimaan yang belum ditagih bisa dibatalkan.
 *  - Langsung faktur: stok dan utang dicatat bersama faktur (seperti sebelumnya) dan penerimaan dibuat otomatis, sudah
 *    terkait faktur, supaya rantai dokumen selalu lengkap.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { taxProfileOf } from '../../common/settings.service';
import { DocDate, toDocDate } from '../../common/utils/dates';
import { D, Dec, money, qty4, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders, suppliers, tenants } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { QcService } from '../production/qc.service';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { insertOne, patchById } from '../../db/owned';

export type LockedOrder = Awaited<ReturnType<PurchaseOrdersService['lock']>>;
export interface ReceiveItem {
  orderLineId: string;
  qty: string;
  lotNo?: string;
  expiryDate?: string;
  binId?: string;
}

/** Selisih kuantitas di bawah ini dianggap nol (pembulatan 4 desimal) */
export const QTY_EPS = D('0.00005');

@Injectable()
export class GoodsReceiptsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly orders: PurchaseOrdersService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly qc: QcService,
  ) {}

  async isPkp(tx: Tx, tenantId: string) {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return taxProfileOf(t?.settings).pkp;
  }

  /** Sisa yang belum diterima per baris pesanan */
  remaining(order: LockedOrder) {
    return new Map(order.lines.map((l) => [l.id, D(l.qty).minus(l.receivedQty)]));
  }

  /** Terima barang atas pesanan CONFIRMED. Tanpa `lines`: seluruh sisa pesanan diterima. */
  async receive(user: AuthUser, orderId: string, dto: { date?: string; lines?: ReceiveItem[]; supplierDeliveryNo?: string; notes?: string }) {
    const date = toDocDate(dto.date);
    // Penerimaan buta: Gudang mengisi jumlah hasil hitungannya sendiri (tidak terisi otomatis sesuai PO)
    const blind = user.role === 'WAREHOUSE' && (await this.approvals.policy(this.db, user.tenantId)).blindReceiving;
    if (blind && !dto.lines?.length) throw new BadRequestException('Isi jumlah barang yang Anda hitung pada setiap baris (penerimaan buta); jangan menerima otomatis sesuai PO.');
    const diffs: { sku: string; ordered: Dec; got: Dec }[] = [];
    let poNumber = '';
    const id = await this.db.transaction(async (tx) => {
      const order = await this.orders.lock(tx, user.tenantId, orderId);
      poNumber = order.number;
      if (order.status !== 'CONFIRMED') {
        throw new BadRequestException(`PO berstatus ${order.status}; hanya PO yang sudah dikonfirmasi yang bisa diterima barangnya`);
      }
      const left = this.remaining(order);
      const picks: ReceiveItem[] = dto.lines ?? order.lines.map((l) => ({ orderLineId: l.id, qty: left.get(l.id)!.toString() }));
      const items: { line: LockedOrder['lines'][number]; qty: Dec; lot?: { lotNo?: string; expiryDate?: string }; binId?: string }[] = [];
      const seen = new Set<string>();
      for (const p of picks) {
        const line = order.lines.find((l) => l.id === p.orderLineId);
        if (!line) throw new BadRequestException('Baris pesanan tidak ditemukan');
        if (seen.has(line.id)) throw new BadRequestException('Baris pesanan yang sama tercantum lebih dari sekali');
        seen.add(line.id);
        const q = D(p.qty);
        if (q.lt(0)) throw new BadRequestException('Jumlah diterima tidak boleh negatif');
        if (q.lte(QTY_EPS)) continue; // baris tanpa penerimaan dilewati
        if (q.gt(left.get(line.id)!.plus(QTY_EPS))) {
          throw new BadRequestException(`Jumlah diterima melebihi sisa pesanan (sisa ${left.get(line.id)!.toString()} dari ${D(line.qty).toString()})`);
        }
        items.push({ line, qty: q, lot: { lotNo: p.lotNo, expiryDate: p.expiryDate }, binId: p.binId });
      }
      if (!items.length) throw new BadRequestException('Tidak ada barang yang diterima: isi jumlah pada minimal satu baris');
      // Selisih terhadap sisa pesanan (kurang/lebih dari yang dipesan) dicatat untuk dikabarkan ke Pembelian dan Pemilik
      for (const l of order.lines) {
        const want = left.get(l.id)!;
        const got = items.find((i) => i.line.id === l.id)?.qty ?? ZERO;
        if (want.gt(QTY_EPS) && got.minus(want).abs().gt(QTY_EPS)) diffs.push({ sku: l.productId, ordered: want, got });
      }
      const receipt = await this.record(tx, user, order, items, date, { deliveryNo: dto.supplierDeliveryNo, notes: dto.notes });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'GoodsReceipt', entityId: receipt.id, data: { number: receipt.number } });
      return receipt.id;
    });
    const rec = await this.get(user.tenantId, id);
    if (diffs.length) {
      const names = (await this.db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM products WHERE tenant_id = ${user.tenantId} AND id IN (${sql.join(diffs.map((d) => sql`${d.sku}::uuid`), sql`, `)})`)).rows;
      const nm = new Map(names.map((n) => [n.id, n.name]));
      void this.approvals.notifyRoles(user.tenantId, {
        roles: ['PURCHASING', 'ADMIN', 'OWNER'],
        excludeUserId: user.sub,
        title: `⚠ Penerimaan ${poNumber}: ${diffs.length} baris tidak sama dengan pesanan`,
        lines: diffs.slice(0, 5).map((d) => `${nm.get(d.sku) ?? 'Barang'}: dipesan sisa ${d.ordered.toString()}, diterima ${d.got.toString()}`),
        path: '/purchase-orders',
      });
    } else {
      void this.approvals.notifyRoles(user.tenantId, { roles: ['PURCHASING'], excludeUserId: user.sub, info: true, title: `Barang PO ${poNumber} sudah diterima Gudang`, lines: ['Sesuai pesanan. Tagihan supplier dapat dicocokkan.'], path: '/purchase-orders' });
    }
    return rec;
  }

  /** Inti penerimaan: stok masuk, jurnal Dr Persediaan | Cr Barang Diterima Belum Ditagih, sisa pesanan diperbarui */
  async record(
    tx: Tx,
    user: AuthUser,
    order: LockedOrder,
    items: { line: LockedOrder['lines'][number]; qty: Dec; lot?: { lotNo?: string; expiryDate?: string }; binId?: string }[],
    date: DocDate,
    o: { deliveryNo?: string; notes?: string },
  ) {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
    // Non-PKP: PPN supplier tidak bisa dikreditkan → bagian harga perolehan sejak penerimaan
    const capitalize = D(order.taxAmount).gt(0) && !(await this.isPkp(tx, user.tenantId));
    const factor = capitalize && D(order.subtotal).gt(0) ? D(order.total).div(order.subtotal) : D(1);
    const number = await this.seq.next(tx, user.tenantId, 'GOODS_RECEIPT', date);
    const receipt = await insertOne(tx, goodsReceipts, {
        tenantId: user.tenantId,
        number,
        date,
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        warehouseId: order.warehouseId,
        supplierDeliveryNo: o.deliveryNo?.trim() || null,
        vatCapitalized: capitalize,
        notes: o.notes,
        createdById: user.sub,
      });

    // Barang wajib QC masuk karantina dulu (bukan gudang tujuan) dan diinspeksi; lolos → dipindah ke gudang tujuan PO
    const quarantine = await this.qc.inboundQuarantine(tx, user.tenantId, [...new Set(items.map((i) => i.line.productId))]);
    let total: Dec = ZERO;
    for (const { line, qty, lot, binId } of items) {
      const baseQty = qty.times(line.uomFactor);
      const net = D(line.lineTotal).times(qty).div(line.qty);
      const unitCost = qty4(net.times(factor).div(baseQty));
      const toQc = !!quarantine.warehouseId && quarantine.required.has(line.productId) && quarantine.warehouseId !== order.warehouseId;
      const moved = await this.stock.move(tx, {
        tenantId: user.tenantId,
        productId: line.productId,
        warehouseId: toQc ? quarantine.warehouseId! : order.warehouseId,
        skipAccessCheck: toQc,
        type: 'PURCHASE',
        qty: baseQty,
        unitCost,
        refType: 'GOODS_RECEIPT',
        refId: receipt.id,
        refNumber: number,
        date,
        lot,
        binId: toQc ? undefined : binId,
      });
      total = total.plus(moved.value);
      await tx.insert(goodsReceiptLines).values({
        receiptId: receipt.id,
        orderLineId: line.id,
        productId: line.productId,
        uom: line.uom,
        uomFactor: line.uomFactor,
        qty: qty.toFixed(4),
        unitCost: unitCost.toFixed(4),
        value: moved.value.toFixed(2),
      });
      await patchById(tx, purchaseOrderLines, line.id, { receivedQty: sql`${purchaseOrderLines.receivedQty} + ${qty.toFixed(4)}` });
      if (toQc) await this.qc.createForReceiptTx(tx, user, { receiptId: receipt.id, productId: line.productId, warehouseId: quarantine.warehouseId!, releaseWarehouseId: order.warehouseId, qty: baseQty.toFixed(4), unitCost: unitCost.toFixed(4), lot: { lotNo: lot?.lotNo, expiryDate: lot?.expiryDate } });
    }
    total = money(total);
    const journal = await this.posting.post(tx, {
      tenantId: user.tenantId,
      date,
      description: `Penerimaan barang ${number} (${order.number}) - ${supplier.name}`,
      sourceType: 'GOODS_RECEIPT',
      sourceId: receipt.id,
      createdById: user.sub,
      lines: [
        { key: SYS.INVENTORY, debit: total },
        { key: SYS.GRNI, credit: total },
      ],
    });
    await patchById(tx, goodsReceipts, receipt.id, { value: total.toFixed(2), journalId: journal.id });
    return { id: receipt.id, number };
  }

  /**
   * Dipanggil faktur yang langsung dibuat dari pesanan (stok dan utang sudah dicatat bersama faktur): catat penerimaan otomatis
   * yang sudah terkait faktur, supaya rantai dokumen selalu lengkap.
   */
  async recordWithInvoice(
    tx: Tx,
    user: AuthUser,
    p: { order: LockedOrder; date: DocDate; invoiceId: string; capitalize: boolean; values: Map<string, { unitCost: Dec; value: Dec }> },
  ) {
    const number = await this.seq.next(tx, user.tenantId, 'GOODS_RECEIPT', p.date);
    let total: Dec = ZERO;
    for (const v of p.values.values()) total = total.plus(v.value);
    const receipt = await insertOne(tx, goodsReceipts, {
        tenantId: user.tenantId,
        number,
        date: p.date,
        purchaseOrderId: p.order.id,
        supplierId: p.order.supplierId,
        warehouseId: p.order.warehouseId,
        value: money(total).toFixed(2),
        vatCapitalized: p.capitalize,
        autoInvoiceId: p.invoiceId,
        notes: 'Dibuat otomatis bersama faktur',
        createdById: user.sub,
      });
    for (const line of p.order.lines) {
      const v = p.values.get(line.id);
      await tx.insert(goodsReceiptLines).values({
        receiptId: receipt.id,
        orderLineId: line.id,
        productId: line.productId,
        uom: line.uom,
        uomFactor: line.uomFactor,
        qty: line.qty,
        unitCost: (v?.unitCost ?? ZERO).toFixed(4),
        value: (v?.value ?? ZERO).toFixed(2),
        billedQty: line.qty,
        billedValue: (v?.value ?? ZERO).toFixed(2),
      });
    }
    await tx
      .update(purchaseOrderLines)
      .set({ receivedQty: purchaseOrderLines.qty, billedQty: purchaseOrderLines.qty, billedAmount: purchaseOrderLines.lineTotal })
      .where(eq(purchaseOrderLines.orderId, p.order.id));
    return receipt;
  }

  /** Batalkan penerimaan yang belum ditagih sama sekali: stok keluar, jurnal dibalik, sisa pesanan kembali */
  async cancel(user: AuthUser, id: string, dto: { date?: string }) {
    const date = toDocDate(dto.date);
    await this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT id FROM goods_receipts WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Penerimaan barang tidak ditemukan');
      const receipt = await tx.query.goodsReceipts.findFirst({ where: eq(goodsReceipts.id, id), with: { lines: true } });
      if (!receipt) throw new NotFoundException('Penerimaan barang tidak ditemukan');
      if (receipt.status === 'CANCELLED') throw new BadRequestException('Penerimaan sudah dibatalkan');
      if (receipt.autoInvoiceId) throw new BadRequestException('Penerimaan ini dibuat bersama faktur; koreksi lewat retur pembelian');
      if (receipt.lines.some((l) => D(l.billedQty).gt(0))) throw new BadRequestException('Sebagian barang sudah difakturkan; koreksi lewat retur pembelian');
      const qcRows = await tx.execute(sql`SELECT 1 FROM qc_inspections WHERE receipt_id = ${id} LIMIT 1`);
      if (qcRows.rows.length) throw new BadRequestException('Penerimaan ini sudah memiliki inspeksi QC (barang di karantina atau sudah diputuskan); selesaikan lewat Pengendalian mutu');
      await this.orders.lock(tx, user.tenantId, receipt.purchaseOrderId);
      let out: Dec = ZERO;
      for (const l of receipt.lines) {
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.productId,
          warehouseId: receipt.warehouseId,
          type: 'PURCHASE_RETURN',
          qty: D(l.qty).times(l.uomFactor).negated(),
          reverseCost: l.unitCost,
          refType: 'GOODS_RECEIPT_CANCEL',
          refId: receipt.id,
          refNumber: receipt.number,
          date,
        });
        out = out.plus(moved.value);
        await patchById(tx, purchaseOrderLines, l.orderLineId, { receivedQty: sql`${purchaseOrderLines.receivedQty} - ${D(l.qty).toFixed(4)}` });
      }
      out = money(out);
      const diff = money(D(receipt.value).minus(out)); // biaya keluar memakai biaya stok saat ini; selisih ke Selisih Persediaan
      await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pembatalan penerimaan ${receipt.number}`,
        sourceType: 'GOODS_RECEIPT',
        sourceId: receipt.id,
        createdById: user.sub,
        lines: [
          { key: SYS.GRNI, debit: receipt.value },
          { key: SYS.INVENTORY, credit: out },
          { key: SYS.INVENTORY_ADJ, debit: diff.lt(0) ? diff.abs() : 0, credit: diff.gt(0) ? diff : 0 },
        ],
      });
      await patchById(tx, goodsReceipts, id, { status: 'CANCELLED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'GoodsReceipt', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  async list(tenantId: string, q: { from?: string; to?: string; purchaseOrderId?: string }) {
    const where = [eq(goodsReceipts.tenantId, tenantId)];
    if (q.from) where.push(gte(goodsReceipts.date, q.from));
    if (q.to) where.push(lte(goodsReceipts.date, q.to));
    if (q.purchaseOrderId) where.push(eq(goodsReceipts.purchaseOrderId, q.purchaseOrderId));
    return this.db.query.goodsReceipts.findMany({
      where: and(...where),
      with: { supplier: { columns: { code: true, name: true } }, order: { columns: { number: true } }, warehouse: { columns: { name: true } } },
      orderBy: [desc(goodsReceipts.date), desc(goodsReceipts.number)],
      limit: 300,
    });
  }

  async get(tenantId: string, id: string) {
    const r = await this.db.query.goodsReceipts.findFirst({
      where: and(eq(goodsReceipts.id, id), eq(goodsReceipts.tenantId, tenantId)),
      with: {
        supplier: { columns: { id: true, code: true, name: true, address: true, phone: true } },
        order: { columns: { id: true, number: true } },
        warehouse: { columns: { id: true, name: true } },
        lines: { with: { product: { columns: { sku: true, name: true } } } },
      },
    });
    if (!r) throw new NotFoundException('Penerimaan barang tidak ditemukan');
    return r;
  }
}
