import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService, taxProfileOf } from '../../common/settings.service';
import { lineTotal, roundVat } from '../sales/pricing';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, qty4, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  accounts,
  goodsReceiptLines,
  goodsReceipts,
  purchaseInvoiceLines,
  purchaseInvoices,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  supplierPayments,
  suppliers,
  tenants,
} from '../../db/schema';
import { AssetsService } from '../assets/assets.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { GoodsReceiptsService, QTY_EPS } from './goods-receipts.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreateBillDto, CreatePurchaseInvoiceDto, CreateSupplierPaymentDto, PurchaseInvoiceQueryDto } from './purchasing.dto';

/** Satu aset per unit (maks. 50 unit per baris) agar penyusutan & pelepasannya bisa per barang */
const assetUnitCount = (qty: Dec) => (qty.isInteger() && qty.lte(50) ? qty.toNumber() : 1);

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly orders: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
  ) {}

  list(tenantId: string, q: PurchaseInvoiceQueryDto) {
    return this.db.query.purchaseInvoices.findMany({
      where: and(
        eq(purchaseInvoices.tenantId, tenantId),
        q.status ? eq(purchaseInvoices.status, q.status) : undefined,
        q.supplierId ? eq(purchaseInvoices.supplierId, q.supplierId) : undefined,
      ),
      with: { supplier: { columns: { code: true, name: true } } },
      orderBy: [desc(purchaseInvoices.date), desc(purchaseInvoices.number)],
      limit: 300,
    });
  }

  async get(tenantId: string, id: string) {
    const inv = await this.db.query.purchaseInvoices.findFirst({
      where: and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.tenantId, tenantId)),
      with: {
        supplier: true,
        purchaseOrder: { columns: { number: true } },
        lines: {
          with: {
            product: { columns: { sku: true, name: true } },
            account: { columns: { code: true, name: true } },
            assetCategory: { columns: { name: true } },
            asset: { columns: { id: true, code: true, name: true } },
          },
        },
        payments: { orderBy: [asc(supplierPayments.date)] },
      },
    });
    if (!inv) throw new NotFoundException('Faktur pembelian tidak ditemukan');
    return inv;
  }

  /**
   * Faktur supplier atas pesanan pembelian. Dua jalur:
   *  - Pesanan belum ada penerimaan barang dan `lines` kosong → barang diterima dan ditagih sekaligus (satu jurnal), penerimaan dibuat otomatis.
   *  - Sudah ada penerimaan barang → faktur menagih barang yang sudah diterima tetapi belum ditagih (seluruhnya atau sebagian,
   *    lewat `lines`) dan menutup "Barang Diterima Belum Ditagih" ke Utang Usaha.
   */
  async createFromOrder(user: AuthUser, dto: CreatePurchaseInvoiceDto) {
    const date = toDocDate(dto.date);
    const result = await this.db.transaction(async (tx) => {
      const order = await this.orders.lock(tx, user.tenantId, dto.purchaseOrderId);
      if (order.status !== 'CONFIRMED') {
        throw new BadRequestException(`PO berstatus ${order.status}; hanya PO yang sudah dikonfirmasi yang bisa difakturkan`);
      }
      const active = await tx.query.goodsReceipts.findMany({ where: and(eq(goodsReceipts.purchaseOrderId, order.id), eq(goodsReceipts.status, 'RECEIVED')), columns: { id: true } });
      return active.length || dto.lines ? this.billReceived(tx, user, order, dto, date) : this.receiveAndBill(tx, user, order, dto, date);
    });
    return { ...(await this.get(user.tenantId, result.id)), journalNumber: result.journalNumber };
  }

  /** Harga faktur per baris pesanan yang menimpa harga PO (kosong = semua memakai harga PO) */
  private priceOverrides(order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto) {
    const m = new Map<string, Dec>();
    for (const p of dto.prices ?? []) {
      if (!order.lines.some((l) => l.id === p.orderLineId)) throw new BadRequestException('Baris pesanan tidak ditemukan');
      if (m.has(p.orderLineId)) throw new BadRequestException('Harga untuk baris pesanan yang sama tercantum lebih dari sekali');
      const price = money(p.price);
      if (price.lte(0)) throw new BadRequestException('Harga faktur harus lebih dari 0');
      m.set(p.orderLineId, price);
    }
    return m;
  }

  /** PPN faktur dari DPP-nya (tarif dan pembulatan sesuai pengaturan perusahaan) */
  private async vatOn(tx: Tx, tenantId: string, dpp: Dec) {
    const [t] = await tx.select({ ppnRate: tenants.ppnRate, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return roundVat(money(dpp.times(t.ppnRate).div(100)), taxProfileOf(t.settings).vatRounding);
  }

  /** Jalur langsung faktur: barang diterima dan ditagih sekaligus (satu jurnal), seluruh pesanan */
  private async receiveAndBill(tx: Tx, user: AuthUser, order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto, date: string) {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
    // Non-PKP: PPN masukan tidak bisa dikreditkan → menjadi bagian harga perolehan persediaan
    const capitalize = D(order.taxAmount).gt(0) && !(await this.isPkp(tx, user.tenantId));
    // Harga faktur (bila berbeda dari PO) menjadi biaya perolehan sejak awal; tanpa isian memakai harga PO
    const over = this.priceOverrides(order, dto);
    const dppOf = (l: (typeof order.lines)[number]) => (over.has(l.id) ? lineTotal({ qty: l.qty, price: over.get(l.id)!, discountPct: l.discountPct }) : D(l.lineTotal));
    const subtotal = order.lines.reduce<Dec>((a, l) => a.plus(dppOf(l)), ZERO);
    const taxAmount = over.size && D(order.taxAmount).gt(0) ? await this.vatOn(tx, user.tenantId, subtotal) : D(order.taxAmount);
    const total = subtotal.plus(taxAmount);
    const costBase = capitalize ? total : subtotal;
    const factor = subtotal.gt(0) ? costBase.div(subtotal) : D(1);
    const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_INVOICE', date);
    const [invoice] = await tx
      .insert(purchaseInvoices)
      .values({
        tenantId: user.tenantId,
        number,
        supplierInvoiceNo: dto.supplierInvoiceNo.trim(),
        date,
        dueDate: addDays(date, supplier.paymentTermDays),
        supplierId: supplier.id,
        purchaseOrderId: order.id,
        warehouseId: order.warehouseId,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        total: total.toFixed(2),
        priceVariance: subtotal.minus(order.subtotal).toFixed(2),
        vatCapitalized: capitalize,
      })
      .returning();

    let stockValue: Dec = ZERO;
    const values = new Map<string, { unitCost: Dec; value: Dec }>();
    for (const line of order.lines) {
      const baseQty = D(line.qty).times(line.uomFactor);
      const dpp = dppOf(line);
      const unitCost = qty4(dpp.times(factor).div(baseQty));
      const moved = await this.stock.move(tx, {
        tenantId: user.tenantId,
        productId: line.productId,
        warehouseId: order.warehouseId,
        type: 'PURCHASE',
        qty: baseQty,
        unitCost,
        refType: 'PURCHASE_INVOICE',
        refId: invoice.id,
        refNumber: number,
        date,
      });
      stockValue = stockValue.plus(moved.value);
      values.set(line.id, { unitCost, value: moved.value });
      await tx.insert(purchaseInvoiceLines).values({
        invoiceId: invoice.id,
        productId: line.productId,
        uom: line.uom,
        uomFactor: line.uomFactor,
        qty: line.qty,
        price: (over.get(line.id) ?? D(line.price)).toFixed(2),
        discountPct: line.discountPct,
        lineTotal: dpp.toFixed(2),
        unitCost: unitCost.toFixed(4),
        priceVariance: dpp.minus(line.lineTotal).toFixed(2),
        orderLineId: line.id,
      });
    }
    // Selisih pembulatan antara DPP (atau DPP+PPN bila non-PKP) dan nilai stok (biaya satuan 4 desimal) → Selisih Persediaan
    const rounding = money(costBase.minus(stockValue));

    const journal = await this.posting.post(tx, {
      tenantId: user.tenantId,
      date,
      description: `Pembelian ${number} (${dto.supplierInvoiceNo}) - ${supplier.name}`,
      sourceType: 'PURCHASE_INVOICE',
      sourceId: invoice.id,
      createdById: user.sub,
      lines: [
        { key: SYS.INVENTORY, debit: stockValue },
        { key: SYS.INVENTORY_ADJ, debit: rounding.gt(0) ? rounding : 0, credit: rounding.lt(0) ? rounding.abs() : 0 },
        { key: SYS.VAT_IN, debit: capitalize ? 0 : taxAmount },
        { key: SYS.AP, credit: total },
      ],
    });

    await this.receipts.recordWithInvoice(tx, user, { order, date, invoiceId: invoice.id, capitalize, values });
    await tx.update(purchaseOrders).set({ status: 'BILLED' }).where(eq(purchaseOrders.id, order.id));
    await tx.update(purchaseInvoices).set({ journalId: journal.id }).where(eq(purchaseInvoices.id, invoice.id));
    await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseInvoice', entityId: invoice.id, data: { number, journal: journal.number } });
    return { id: invoice.id, journalNumber: journal.number };
  }

  /**
   * Jalur terima dulu: tagih barang yang sudah diterima. Jurnal: Dr Barang Diterima Belum Ditagih (nilai penerimaan), Dr PPN Masukan
   * | Cr Utang Usaha. Selisih pembulatan antara DPP dan nilai penerimaan masuk ke Selisih Persediaan.
   */
  private async billReceived(tx: Tx, user: AuthUser, order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto, date: string) {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
    const picks = new Map<string, Dec>();
    if (dto.lines) {
      for (const p of dto.lines) {
        if (!order.lines.some((l) => l.id === p.orderLineId)) throw new BadRequestException('Baris pesanan tidak ditemukan');
        if (picks.has(p.orderLineId)) throw new BadRequestException('Baris pesanan yang sama tercantum lebih dari sekali');
        const q = D(p.qty);
        if (q.lt(0)) throw new BadRequestException('Jumlah ditagih tidak boleh negatif');
        picks.set(p.orderLineId, q);
      }
    }
    const want = (l: (typeof order.lines)[number]) => (dto.lines ? (picks.get(l.id) ?? ZERO) : D(l.receivedQty).minus(l.billedQty));
    const items = order.lines.map((line) => ({ line, q: want(line) })).filter((x) => x.q.gt(QTY_EPS));
    if (!items.length) {
      throw new BadRequestException(dto.lines ? 'Tidak ada barang yang ditagih: isi jumlah pada minimal satu baris' : 'Tidak ada barang yang sudah diterima dan belum ditagih. Terima barang dulu.');
    }
    for (const { line, q } of items) {
      const open = D(line.receivedQty).minus(line.billedQty);
      if (q.gt(open.plus(QTY_EPS))) {
        throw new BadRequestException(`Jumlah ditagih melebihi barang yang sudah diterima dan belum ditagih (${open.toString()} dari ${D(line.qty).toString()} dipesan). Terima barang dulu atau kurangi jumlahnya.`);
      }
    }

    // Penerimaan paling lama ditagih lebih dulu
    const recLines = await tx
      .select({ rl: goodsReceiptLines, date: goodsReceipts.date, number: goodsReceipts.number, capitalized: goodsReceipts.vatCapitalized })
      .from(goodsReceiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
      .where(and(eq(goodsReceipts.purchaseOrderId, order.id), eq(goodsReceipts.status, 'RECEIVED')))
      .orderBy(asc(goodsReceipts.date), asc(goodsReceipts.number), asc(goodsReceiptLines.id))
      .for('update', { of: goodsReceiptLines });

    const over = this.priceOverrides(order, dto);
    for (const id of over.keys()) if (!items.some((x) => x.line.id === id)) throw new BadRequestException('Harga faktur diisi untuk baris yang tidak ditagih pada faktur ini');
    let subtotal: Dec = ZERO;
    let poSubtotal: Dec = ZERO;
    let grni: Dec = ZERO;
    let capitalized = false;
    const invLines: { line: (typeof order.lines)[number]; q: Dec; dpp: Dec; poDpp: Dec; value: Dec; baseQty: Dec }[] = [];
    for (const { line, q } of items) {
      let need = q;
      let value: Dec = ZERO;
      for (const r of recLines.filter((x) => x.rl.orderLineId === line.id)) {
        if (need.lte(QTY_EPS)) break;
        const open = D(r.rl.qty).minus(r.rl.billedQty);
        if (open.lte(QTY_EPS)) continue;
        const take = open.lt(need) ? open : need;
        const finishes = D(r.rl.billedQty).plus(take).plus(QTY_EPS).gte(r.rl.qty);
        const chunk = finishes ? D(r.rl.value).minus(r.rl.billedValue) : money(D(r.rl.value).times(take).div(r.rl.qty));
        value = value.plus(chunk);
        need = need.minus(take);
        if (r.capitalized) capitalized = true;
        await tx
          .update(goodsReceiptLines)
          .set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${take.toFixed(4)}`, billedValue: sql`${goodsReceiptLines.billedValue} + ${chunk.toFixed(2)}` })
          .where(eq(goodsReceiptLines.id, r.rl.id));
        r.rl.billedQty = D(r.rl.billedQty).plus(take).toFixed(4);
        r.rl.billedValue = D(r.rl.billedValue).plus(chunk).toFixed(2);
      }
      const done = D(line.billedQty).plus(q).plus(QTY_EPS).gte(line.qty);
      const poDpp = done ? D(line.lineTotal).minus(line.billedAmount) : money(D(line.lineTotal).times(q).div(line.qty));
      // harga faktur menggantikan harga PO untuk baris yang diisi
      const dpp = over.has(line.id) ? lineTotal({ qty: q, price: over.get(line.id)!, discountPct: line.discountPct }) : poDpp;
      subtotal = subtotal.plus(dpp);
      poSubtotal = poSubtotal.plus(poDpp);
      grni = grni.plus(value);
      invLines.push({ line, q, dpp, poDpp, value, baseQty: q.times(line.uomFactor) });
    }

    // PPN: sebanding dengan DPP yang sudah ditagih; faktur yang menuntaskan pesanan memikul sisa pembulatan
    const prior = (await tx.execute<{ tax: string; sub: string; var: string }>(sql`
      SELECT COALESCE(SUM(tax_amount), 0) AS tax, COALESCE(SUM(subtotal), 0) AS sub, COALESCE(SUM(price_variance), 0) AS var FROM purchase_invoices WHERE purchase_order_id = ${order.id}`)).rows[0];
    const variances = invLines.map((x) => x.dpp.minus(x.poDpp));
    // Ada selisih harga (pada faktur ini atau sebelumnya): PPN mengikuti DPP faktur, bukan pro-rata PO
    const actualVat = variances.some((v) => !v.isZero()) || !D(prior.var).isZero();
    let tax: Dec;
    if (actualVat) {
      tax = D(order.taxAmount).gt(0) ? await this.vatOn(tx, user.tenantId, subtotal) : ZERO;
    } else {
      const cumulative = D(prior.sub).plus(subtotal);
      const complete = cumulative.plus(0.005).gte(order.subtotal);
      tax = complete ? money(D(order.taxAmount).minus(prior.tax)) : money(D(order.taxAmount).times(cumulative).div(order.subtotal).minus(prior.tax));
    }
    const total = subtotal.plus(tax);

    const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_INVOICE', date);
    const [invoice] = await tx
      .insert(purchaseInvoices)
      .values({
        tenantId: user.tenantId,
        number,
        supplierInvoiceNo: dto.supplierInvoiceNo.trim(),
        date,
        dueDate: addDays(date, supplier.paymentTermDays),
        supplierId: supplier.id,
        purchaseOrderId: order.id,
        warehouseId: order.warehouseId,
        subtotal: subtotal.toFixed(2),
        taxAmount: tax.toFixed(2),
        total: total.toFixed(2),
        priceVariance: subtotal.minus(poSubtotal).toFixed(2),
        vatCapitalized: capitalized,
      })
      .returning();

    // Biaya perolehan mengikuti harga faktur: selisih harga dibagi ke stok yang masih ada (persediaan) dan ke barang yang sudah terjual (HPP)
    const capFactor = capitalized && D(order.subtotal).gt(0) ? D(order.total).div(order.subtotal) : D(1);
    let toInventory: Dec = ZERO;
    let toCogs: Dec = ZERO;
    for (const [i, x] of invLines.entries()) {
      if (variances[i].isZero()) continue;
      const v = money(variances[i].times(capFactor));
      const [bal] = (await tx.execute<{ qty: string }>(sql`SELECT qty FROM stock_balances WHERE tenant_id = ${user.tenantId} AND product_id = ${x.line.productId} AND warehouse_id = ${order.warehouseId}`)).rows;
      const onHand = D(bal?.qty ?? 0);
      const share = onHand.lte(0) ? ZERO : onHand.gte(x.baseQty) ? D(1) : onHand.div(x.baseQty);
      const inv = money(v.times(share));
      const applied = inv.isZero() ? ZERO : await this.stock.adjustCost(tx, { tenantId: user.tenantId, productId: x.line.productId, warehouseId: order.warehouseId, amount: inv, refType: 'PURCHASE_INVOICE', refId: invoice.id, refNumber: number, date });
      toInventory = toInventory.plus(applied);
      toCogs = toCogs.plus(v.minus(inv));
    }
    // sisa (pembulatan / stok tak cukup menampung) masuk Selisih Persediaan agar jurnal seimbang
    const rounding = money(subtotal.plus(capitalized ? tax : 0).minus(grni).minus(toInventory).minus(toCogs));
    for (const [i, x] of invLines.entries()) {
      await tx.insert(purchaseInvoiceLines).values({
        invoiceId: invoice.id,
        productId: x.line.productId,
        uom: x.line.uom,
        uomFactor: x.line.uomFactor,
        qty: x.q.toFixed(4),
        price: (over.get(x.line.id) ?? D(x.line.price)).toFixed(2),
        discountPct: x.line.discountPct,
        lineTotal: x.dpp.toFixed(2),
        unitCost: qty4(x.value.plus(variances[i].times(capFactor)).div(x.baseQty)).toFixed(4),
        priceVariance: variances[i].toFixed(2),
        orderLineId: x.line.id,
      });
      await tx
        .update(purchaseOrderLines)
        .set({ billedQty: sql`${purchaseOrderLines.billedQty} + ${x.q.toFixed(4)}`, billedAmount: sql`${purchaseOrderLines.billedAmount} + ${x.poDpp.toFixed(2)}` })
        .where(eq(purchaseOrderLines.id, x.line.id));
    }
    const journal = await this.posting.post(tx, {
      tenantId: user.tenantId,
      date,
      description: `Pembelian ${number} (${dto.supplierInvoiceNo}) - ${supplier.name}`,
      sourceType: 'PURCHASE_INVOICE',
      sourceId: invoice.id,
      createdById: user.sub,
      lines: [
        { key: SYS.GRNI, debit: grni },
        { key: SYS.INVENTORY, debit: toInventory.gt(0) ? toInventory : 0, credit: toInventory.lt(0) ? toInventory.abs() : 0 },
        { key: SYS.COGS, debit: toCogs.gt(0) ? toCogs : 0, credit: toCogs.lt(0) ? toCogs.abs() : 0 },
        { key: SYS.INVENTORY_ADJ, debit: rounding.gt(0) ? rounding : 0, credit: rounding.lt(0) ? rounding.abs() : 0 },
        { key: SYS.VAT_IN, debit: capitalized ? 0 : tax },
        { key: SYS.AP, credit: total },
      ],
    });
    await tx.update(purchaseInvoices).set({ journalId: journal.id }).where(eq(purchaseInvoices.id, invoice.id));
    // pesanan tuntas bila seluruh barang sudah ditagih
    const after = await tx.select({ qty: purchaseOrderLines.qty, billedQty: purchaseOrderLines.billedQty }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
    if (after.every((l) => D(l.billedQty).plus(QTY_EPS).gte(l.qty))) {
      await tx.update(purchaseOrders).set({ status: 'BILLED' }).where(eq(purchaseOrders.id, order.id));
    }
    await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseInvoice', entityId: invoice.id, data: { number, journal: journal.number } });
    return { id: invoice.id, journalNumber: journal.number };
  }

  /**
   * Tagihan supplier untuk biaya atau aset tetap (tanpa PO / tanpa stok):
   *  Dr Beban (per baris) · Dr Aset tetap (per baris aset — otomatis masuk daftar aset) · Dr PPN Masukan
   *  Cr Utang Usaha (yang dibayar ke supplier) · Cr Utang PPh 23 / 4(2) (PPh yang dipotong)
   */
  private async isPkp(tx: Tx, tenantId: string) {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return taxProfileOf(t?.settings).pkp;
  }

  async createBill(user: AuthUser, dto: CreateBillDto) {
    const date = toDocDate(dto.date);
    const result = await this.db.transaction(async (tx) => {
      const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, dto.supplierId), eq(suppliers.tenantId, user.tenantId)));
      if (!supplier) throw new NotFoundException('Supplier tidak ditemukan');
      const [tenant] = await tx.select({ ppnRate: tenants.ppnRate, settings: tenants.settings }).from(tenants).where(eq(tenants.id, user.tenantId));
      const pkp = taxProfileOf(tenant.settings).pkp;
      if (dto.projectId) {
        const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, dto.projectId), eq(projects.tenantId, user.tenantId)));
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      }

      type Line = { dto: (typeof dto.lines)[number]; qty: Dec; total: Dec; debitAccountId: string; exempt: boolean };
      const lines: Line[] = [];
      for (const l of dto.lines) {
        const q = D(l.qty ?? '1');
        const price = money(l.price);
        if (q.lte(0) || price.lte(0)) throw new BadRequestException(`Jumlah & harga baris "${l.description}" harus > 0`);
        let debitAccountId: string;
        let exempt = false;
        if (l.type === 'ASSET') {
          if (!l.assetCategoryId) throw new BadRequestException(`Pilih kategori aset untuk "${l.description}"`);
          const cat = await this.assets.category(user.tenantId, l.assetCategoryId);
          if (!cat) throw new BadRequestException('Kategori aset tidak ditemukan');
          debitAccountId = cat.assetAccountId;
          exempt = this.assets.isThresholdExempt(cat);
        } else {
          if (!l.accountId) throw new BadRequestException(`Pilih akun untuk "${l.description}"`);
          const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, l.accountId), eq(accounts.tenantId, user.tenantId)));
          if (!acc || !acc.isPostable) throw new BadRequestException(`Akun untuk "${l.description}" tidak valid`);
          if (acc.isCashAccount) throw new BadRequestException('Akun kas/bank tidak bisa dipakai di baris tagihan');
          debitAccountId = acc.id;
        }
        lines.push({ dto: l, qty: q, total: money(q.times(price)), debitAccountId, exempt });
      }
      const subtotal = lines.reduce<Dec>((a, l) => a.plus(l.total), ZERO);
      const tax = dto.withVat === false ? ZERO : roundVat(money(subtotal.times(tenant.ppnRate).div(100)), taxProfileOf(tenant.settings).vatRounding);
      const whBase = lines.filter((l) => l.dto.withholding ?? l.dto.type === 'EXPENSE').reduce<Dec>((a, l) => a.plus(l.total), ZERO);
      const whRate = dto.withholdingType ? D(dto.withholdingRate ?? (dto.withholdingType === 'PPH23' ? '2' : '10')) : ZERO;
      const withholding = money(whBase.times(whRate).div(100));
      const total = subtotal.plus(tax).minus(withholding);
      // Non-PKP: PPN dibagi ke tiap baris (biaya / harga perolehan aset), sisa pembulatan ke baris terakhir
      const capitalize = !pkp && tax.gt(0);
      const costs = lines.map((l) => l.total);
      if (capitalize) {
        let left = tax;
        lines.forEach((l, i) => {
          const share = i === lines.length - 1 ? left : money(tax.times(l.total).div(subtotal));
          costs[i] = l.total.plus(share);
          left = left.minus(share);
        });
      }

      // Batas kapitalisasi: harga perolehan per unit (sudah termasuk PPN yang tidak dapat dikreditkan)
      // di bawah batas → langsung beban, tidak didaftarkan sebagai aset
      const { capitalizationThreshold: threshold } = await this.settings.reporting(tx, user.tenantId);
      const expensed = lines.map((l, i) => l.dto.type === 'ASSET' && !l.exempt && threshold > 0 && costs[i].div(assetUnitCount(l.qty)).lt(threshold));
      let smallAssetAccountId: string | undefined;
      if (expensed.some(Boolean)) {
        const [small] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.tenantId, user.tenantId), eq(accounts.systemKey, SYS.SMALL_ASSET_EXPENSE)));
        if (!small) throw new BadRequestException('Akun "Beban Peralatan Kecil" belum ada di bagan akun');
        smallAssetAccountId = small.id;
      }

      const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_INVOICE', date);
      const [invoice] = await tx
        .insert(purchaseInvoices)
        .values({
          tenantId: user.tenantId,
          number,
          kind: 'BILL',
          supplierInvoiceNo: dto.supplierInvoiceNo.trim(),
          date,
          dueDate: dto.dueDate ? toDocDate(dto.dueDate) : addDays(date, supplier.paymentTermDays),
          supplierId: supplier.id,
          description: dto.description,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          withholdingType: withholding.gt(0) ? dto.withholdingType : null,
          withholdingAmount: withholding.toFixed(2),
          withholdingBase: withholding.gt(0) ? whBase.toFixed(2) : '0',
          withholdingRate: withholding.gt(0) ? whRate.toFixed(2) : null,
          total: total.toFixed(2),
          vatCapitalized: capitalize,
          projectId: dto.projectId,
        })
        .returning();

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Tagihan ${number} (${dto.supplierInvoiceNo}) - ${supplier.name}${dto.description ? ` · ${dto.description}` : ''}`,
        sourceType: 'PURCHASE_INVOICE',
        sourceId: invoice.id,
        reference: dto.supplierInvoiceNo,
        createdById: user.sub,
        lines: [
          ...lines.map((l, i) =>
            expensed[i]
              ? { accountId: smallAssetAccountId, debit: costs[i], memo: `${l.dto.description} (di bawah batas kapitalisasi, dibebankan)` }
              : { accountId: l.debitAccountId, debit: costs[i], memo: l.dto.description },
          ),
          { key: SYS.VAT_IN, debit: capitalize ? 0 : tax },
          { key: SYS.AP, credit: total },
          { key: dto.withholdingType === 'PPH4_2' ? SYS.PPH4_2_PAYABLE : SYS.PPH23_PAYABLE, credit: withholding },
        ],
      });

      for (const [idx, l] of lines.entries()) {
        let assetId: string | undefined;
        if (l.dto.type === 'ASSET' && !expensed[idx]) {
          // Satu aset per unit agar penyusutan & pelepasannya bisa per barang
          const lineCost = costs[idx];
          const n = assetUnitCount(l.qty);
          const unitCost = n > 1 ? money(lineCost.div(n)) : lineCost;
          for (let i = 0; i < n; i++) {
            const cost = i === n - 1 ? lineCost.minus(unitCost.times(n - 1)) : unitCost;
            const asset = await this.assets.registerFromPurchase(tx, user.tenantId, {
              categoryId: l.dto.assetCategoryId!,
              name: n > 1 ? `${l.dto.description} (${i + 1}/${n})` : l.dto.description,
              date,
              cost,
              usefulLifeMonths: l.dto.usefulLifeMonths,
              location: l.dto.location,
              journalId: journal.id,
              purchaseInvoiceId: invoice.id,
              notes: `Dibeli dari ${supplier.name}, faktur ${dto.supplierInvoiceNo}`,
            });
            assetId ??= asset.id;
          }
        }
        await tx.insert(purchaseInvoiceLines).values({
          invoiceId: invoice.id,
          lineType: l.dto.type,
          accountId: l.dto.type === 'EXPENSE' ? l.debitAccountId : expensed[idx] ? smallAssetAccountId : null,
          assetCategoryId: l.dto.assetCategoryId,
          assetId,
          description: l.dto.description,
          uom: 'UNIT',
          uomFactor: '1',
          qty: l.qty.toFixed(4),
          price: money(l.dto.price).toFixed(2),
          lineTotal: l.total.toFixed(2),
          unitCost: '0',
        });
      }
      await tx.update(purchaseInvoices).set({ journalId: journal.id }).where(eq(purchaseInvoices.id, invoice.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'PurchaseBill',
        entityId: invoice.id,
        data: { number, journal: journal.number },
      });
      return { id: invoice.id, journalNumber: journal.number, expensedLines: expensed.filter(Boolean).length };
    });
    return { ...(await this.get(user.tenantId, result.id)), journalNumber: result.journalNumber, expensedLines: result.expensedLines };
  }

  /** Pembayaran hutang: Dr Hutang Usaha | Cr Kas/Bank */
  async pay(user: AuthUser, dto: CreateSupplierPaymentDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');

    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id FROM purchase_invoices WHERE id = ${dto.purchaseInvoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Faktur pembelian tidak ditemukan');
      const [inv] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, dto.purchaseInvoiceId));
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, inv.supplierId));

      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (amount.gt(outstanding)) {
        throw new BadRequestException(`Pembayaran ${amount.toFixed(2)} melebihi sisa hutang ${outstanding.toFixed(2)}`);
      }
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      const number = await this.seq.next(tx, user.tenantId, 'SUPPLIER_PAYMENT', date);
      const [payment] = await tx
        .insert(supplierPayments)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          supplierId: inv.supplierId,
          purchaseInvoiceId: inv.id,
          amount: amount.toFixed(2),
          cashAccountId: cash.id,
          notes: dto.notes,
        })
        .returning();

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Bayar hutang ${inv.number} - ${supplier.name} (${number})`,
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: payment.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AP, debit: amount },
          { accountId: cash.id, credit: amount },
        ],
      });

      const paid = D(inv.paidAmount).plus(amount);
      await tx
        .update(purchaseInvoices)
        .set({ paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' })
        .where(eq(purchaseInvoices.id, inv.id));
      await tx.update(supplierPayments).set({ journalId: journal.id }).where(eq(supplierPayments.id, payment.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'SupplierPayment', entityId: payment.id });
      return { ...payment, journalNumber: journal.number };
    });
  }

  listPayments(tenantId: string) {
    return this.db.query.supplierPayments.findMany({
      where: eq(supplierPayments.tenantId, tenantId),
      with: {
        supplier: { columns: { code: true, name: true } },
        invoice: { columns: { number: true, supplierInvoiceNo: true } },
        cashAccount: { columns: { code: true, name: true } },
      },
      orderBy: [desc(supplierPayments.date), desc(supplierPayments.number)],
      limit: 300,
    });
  }

  /** Umur hutang per supplier */
  async apAging(tenantId: string) {
    const today = todayJakarta();
    const open = await this.db.query.purchaseInvoices.findMany({
      where: and(eq(purchaseInvoices.tenantId, tenantId), ne(purchaseInvoices.status, 'PAID')),
      with: { supplier: { columns: { id: true, code: true, name: true } } },
    });
    type Bucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
    const map = new Map<string, { supplier: { id: string; code: string; name: string }; total: Dec } & Record<Bucket, Dec>>();
    for (const inv of open) {
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (outstanding.lte(0)) continue;
      const days = diffDays(inv.dueDate, today);
      const bucket: Bucket = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const row = map.get(inv.supplierId) ?? {
        supplier: inv.supplier,
        total: ZERO,
        current: ZERO,
        d1_30: ZERO,
        d31_60: ZERO,
        d61_90: ZERO,
        d90_plus: ZERO,
      };
      row[bucket] = row[bucket].plus(outstanding);
      row.total = row.total.plus(outstanding);
      map.set(inv.supplierId, row);
    }
    return [...map.values()].sort((a, b) => b.total.comparedTo(a.total));
  }
}
