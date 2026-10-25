import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuthUser } from '../../common/auth/auth-user';
import { WorkflowService } from '../workflow/workflow.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService, taxProfileOf } from '../../common/settings.service';
import { lineTotal, roundVat } from '../sales/pricing';
import { addDays, assertNotFuture, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, qty4, ZERO } from '../../common/utils/money';
import { settleForeign } from '../../common/utils/fx';
import { FxService } from '../fx/fx.service';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  accounts,
  goodsReceiptBillings,
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
import { AssetsService } from '../assets/assets.service';
import { SYS } from '../accounting/default-coa';
import { BudgetService } from '../accounting/budget.service';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { QcService } from '../production/qc.service';
import { GoodsReceiptsService, QTY_EPS } from './goods-receipts.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreateBillDto, CreatePurchaseInvoiceDto, CreateSupplierPaymentDto, PurchaseInvoiceQueryDto } from './purchasing.dto';
import { PurchaseInvoiceRepository } from './purchase-invoice.repository';
import { patchById } from '../../db/owned';

/** Satu aset per unit (maks. 50 unit per baris) agar penyusutan & pelepasannya bisa per barang */
export const assetUnitCount = (qty: Dec) => (qty.isInteger() && qty.lte(50) ? qty.toNumber() : 1);

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
    private readonly approvals: ApprovalsService,
    private readonly workflow: WorkflowService,
    private readonly fx: FxService,
    private readonly budget: BudgetService,
    private readonly qc: QcService,
    private readonly repo: PurchaseInvoiceRepository,
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
  async createFromOrder(user: AuthUser, dto: CreatePurchaseInvoiceDto, opts: { approvalId?: string } = {}) {
    const date = toDocDate(dto.date);
    const control = await this.priceControl(user, dto, opts);
    const result = await this.db.transaction(async (tx) => {
      const order = await this.orders.lock(tx, user.tenantId, dto.purchaseOrderId);
      if (order.status !== 'CONFIRMED') {
        throw new BadRequestException(`PO berstatus ${order.status}; hanya PO yang sudah dikonfirmasi yang bisa difakturkan`);
      }
      const active = await tx.query.goodsReceipts.findMany({ where: and(eq(goodsReceipts.purchaseOrderId, order.id), eq(goodsReceipts.status, 'RECEIVED')), columns: { id: true } });
      // Pencocokan tiga arah: tagihan hanya atas barang yang sudah diterima Gudang. Jalur "terima sekaligus tagih" hanya untuk Pemilik/Admin.
      if (!active.length && !dto.lines && !this.approvals.isApprover(user.role)) {
        throw new BadRequestException('Barang pada PO ini belum diterima Gudang. Minta Gudang mencatat penerimaan barang dulu, baru faktur supplier dicatat.');
      }
      const r = active.length || dto.lines ? await this.billReceived(tx, user, order, dto, date) : await this.receiveAndBill(tx, user, order, dto, date);
      // jejak pengendalian harga: pembuat, alasan, penanda, dan persetujuan
      await patchById(tx, purchaseInvoices, r.id, {
          createdById: user.sub,
          approvalId: opts.approvalId ?? null,
          varianceReason: control.hasVariance ? dto.varianceReason : null,
          varianceNote: control.hasVariance ? (dto.varianceNote?.trim() || null) : null,
          priceFlags: control.flags.length ? control.flags.join(',') : null,
        });
      return r;
    });
    return { ...(await this.get(user.tenantId, result.id)), journalNumber: result.journalNumber };
  }

  /**
   * Pengendalian selisih harga (anti-fraud). Selisih apa pun wajib beralasan. Kenaikan harga per baris di atas toleransi, atau harga
   * di atas rata-rata harga beli 90 hari terakhir melebihi batas pembanding, harus disetujui pemilik/admin sebelum faktur dicatat
   * (permintaan menyimpan isi faktur dan menjalankannya saat disetujui). Pemilik/admin tidak terkena batas tetapi tetap tercatat.
   */
  private async priceControl(user: AuthUser, dto: CreatePurchaseInvoiceDto, opts: { approvalId?: string }) {
    const none = { hasVariance: false, flags: [] as string[] };
    const order = await this.db.query.purchaseOrders.findFirst({ where: and(eq(purchaseOrders.id, dto.purchaseOrderId), eq(purchaseOrders.tenantId, user.tenantId)), with: { lines: true } });
    if (!order) return none; // ditolak pada langkah berikutnya (PO tidak ditemukan)
    const foreign = order.currency !== 'IDR';
    // Kurs faktur yang diketik berbeda dari kurs PO: dibandingkan dengan kurs pasar tersimpan (kenaikan kurs = mark-up terselubung)
    const rate = foreign && dto.fxRate ? D(dto.fxRate) : D(order.fxRate);
    const rateTyped = foreign && !!dto.fxRate && !rate.eq(order.fxRate);
    if (!dto.prices?.length && !rateTyped) return none;
    const diffs = (dto.prices ?? [])
      .map((p) => {
        const line = order.lines.find((l) => l.id === p.orderLineId);
        if (!line) return null;
        // PO valas: harga dibandingkan dalam mata uang PO, sehingga perbedaan kurs saja tidak dianggap selisih harga
        const oldP = Number(foreign ? line.priceForeign : line.price);
        const newP = Number(p.price);
        return newP === oldP ? null : { line, oldP, newP, pct: oldP > 0 ? ((newP - oldP) / oldP) * 100 : 100 };
      })
      .filter((d): d is NonNullable<typeof d> => !!d);
    if (!diffs.length && !rateTyped) return none;
    if (diffs.length) {
      if (!dto.varianceReason) throw new BadRequestException('Harga faktur berbeda dari PO: pilih alasan selisih harga');
      if (dto.varianceReason === 'OTHER' && (dto.varianceNote?.trim().length ?? 0) < 5) throw new BadRequestException('Jelaskan alasan selisih harga pada catatan (minimal 5 huruf)');
    }

    const policy = await this.approvals.policy(this.db, user.tenantId);
    const flags: string[] = [];
    let exceeded = false;
    const idrRate = foreign ? rate.toNumber() : 1;
    const hist = policy.priceControl && diffs.length ? await this.orders.priceHistory(user.tenantId, [...new Set(diffs.map((d) => d.line.productId))]) : {};
    for (const d of diffs) {
      if (d.pct > policy.priceTolerancePct + 1e-9) exceeded = true;
      const h = hist[d.line.productId];
      if (h?.avg90 != null && (d.newP * idrRate) / Number(d.line.uomFactor) > h.avg90 * (1 + policy.priceBenchmarkPct / 100)) {
        flags.push('ABOVE_MARKET');
        exceeded = true;
      }
    }
    if (rateTyped) {
      const market = await this.fx.rateOn(this.db, user.tenantId, order.currency, toDocDate(dto.date));
      if (market && rate.gt(D(market).times(1 + policy.priceTolerancePct / 100))) {
        flags.push('RATE_ABOVE_MARKET');
        exceeded = true;
      }
    }
    if (policy.priceControl && exceeded && !this.approvals.isApprover(user.role) && !opts.approvalId) {
      const [dup] = (
        await this.db.execute<{ id: string }>(sql`
          SELECT id FROM approval_requests WHERE tenant_id = ${user.tenantId} AND kind = 'PURCHASE_INVOICE_PRICE' AND status = 'PENDING'
            AND ref_id = ${order.id} AND payload->>'supplierInvoiceNo' = ${dto.supplierInvoiceNo.trim()}`)
      ).rows;
      if (dup) throw this.approvals.required(dup.id, 'Faktur ini sudah dimintakan persetujuan dan masih menunggu keputusan pemilik atau admin.');
      const worst = diffs.reduce((a, d) => (d.pct > a ? d.pct : a), 0);
      const amount = diffs.reduce((a, d) => a + Math.max(0, (d.newP - d.oldP) * Number(d.line.qty) * idrRate), 0);
      const req = await this.approvals.create(this.db, user, {
        kind: 'PURCHASE_INVOICE_PRICE',
        refId: order.id,
        title: `Faktur ${dto.supplierInvoiceNo.trim()} (PO ${order.number}): ${diffs.length ? `harga ${worst > 0 ? `+${worst.toFixed(1)}%` : 'berbeda'} dari PO` : `kurs ${order.currency} ${rate.toString()} di atas kurs pasar`}`,
        amount,
        payload: JSON.parse(JSON.stringify({ ...dto, supplierInvoiceNo: dto.supplierInvoiceNo.trim() })),
      });
      throw this.approvals.required(req.id, 'Harga atau kurs faktur melebihi toleransi atau jauh di atas harga pasar; permintaan persetujuan dikirim ke pemilik atau admin. Faktur dicatat setelah disetujui.');
    }
    return { hasVariance: diffs.length > 0, flags: [...new Set(flags)] };
  }

  /**
   * Harga dan kurs faktur. PO Rupiah: `prices` (Rp) menimpa harga PO. PO valas: `prices` dalam mata uang PO dan `fxRate` kurs faktur
   * (kosong = kurs PO); harga Rupiah baris = harga valas × kurs faktur, sehingga selisih kurs antara PO/penerimaan dan faktur masuk ke
   * biaya perolehan lewat mekanisme selisih harga (persediaan dan HPP).
   */
  private pricing(order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto) {
    const foreign = order.currency !== 'IDR';
    if (dto.fxRate && !foreign) throw new BadRequestException('Kurs faktur hanya untuk PO dalam mata uang asing');
    const rate = foreign && dto.fxRate ? D(dto.fxRate) : D(order.fxRate);
    if (!rate.isFinite() || rate.lte(0)) throw new BadRequestException('Kurs harus lebih dari 0');
    const given = new Map<string, Dec>();
    for (const p of dto.prices ?? []) {
      if (!order.lines.some((l) => l.id === p.orderLineId)) throw new BadRequestException('Baris pesanan tidak ditemukan');
      if (given.has(p.orderLineId)) throw new BadRequestException('Harga untuk baris pesanan yang sama tercantum lebih dari sekali');
      const price = foreign ? D(p.price).toDecimalPlaces(4) : money(p.price);
      if (price.lte(0)) throw new BadRequestException('Harga faktur harus lebih dari 0');
      given.set(p.orderLineId, price);
    }
    const over = new Map<string, Dec>();
    const foreignPrice = new Map<string, Dec>();
    if (!foreign) {
      given.forEach((v, k) => over.set(k, v));
      return { rate, over, foreignPrice, given };
    }
    const rateChanged = !rate.eq(order.fxRate);
    for (const l of order.lines) {
      const po = D(l.priceForeign ?? 0);
      const pf = given.get(l.id) ?? po;
      foreignPrice.set(l.id, pf);
      if (rateChanged || !pf.eq(po)) over.set(l.id, money(pf.times(rate)));
    }
    return { rate, over, foreignPrice, given };
  }

  /** Mata uang faktur = mata uang PO; kurs = kurs faktur; total valas = DPP valas + PPN Rupiah ÷ kurs faktur */
  private fxFields(order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, p: { rate: Dec; tax: Dec; lineForeign: Dec }) {
    if (order.currency === 'IDR') return {};
    return { currency: order.currency, fxRate: p.rate.toFixed(6), totalForeign: p.lineForeign.plus(money(p.tax.div(p.rate))).toFixed(2) };
  }

  /** PPN faktur dari DPP-nya (tarif dan pembulatan sesuai pengaturan perusahaan) */
  private async vatOn(tx: Tx, tenantId: string, dpp: Dec) {
    const [t] = await tx.select({ ppnRate: tenants.ppnRate, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return roundVat(money(dpp.times(t.ppnRate).div(100)), taxProfileOf(t.settings).vatRounding);
  }

  /** Jalur langsung faktur: barang diterima dan ditagih sekaligus (satu jurnal), seluruh pesanan */
  private async receiveAndBill(tx: Tx, user: AuthUser, order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto, date: string) {
    const supplier = await this.repo.supplierById(tx, order.supplierId);
    // Non-PKP: PPN masukan tidak bisa dikreditkan → menjadi bagian harga perolehan persediaan
    const capitalize = D(order.taxAmount).gt(0) && !(await this.isPkp(tx, user.tenantId));
    // Harga faktur (bila berbeda dari PO) menjadi biaya perolehan sejak awal; tanpa isian memakai harga PO
    const pr = this.pricing(order, dto);
    const over = pr.over;
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
        ...this.fxFields(order, { rate: pr.rate, tax: taxAmount, lineForeign: order.lines.reduce<Dec>((a, l) => a.plus(lineTotal({ qty: l.qty, price: pr.foreignPrice.get(l.id) ?? 0, discountPct: l.discountPct })), ZERO) }),
      })
      .returning();

    let stockValue: Dec = ZERO;
    const values = new Map<string, { unitCost: Dec; value: Dec }>();
    const lotOf = new Map((dto.lots ?? []).map((l) => [l.orderLineId, { lotNo: l.lotNo, expiryDate: l.expiryDate }]));
    // Barang wajib QC tidak boleh lolos ke gudang lewat jalur faktur langsung: masuk karantina dan diinspeksi
    const quarantine = await this.qc.inboundQuarantine(tx, user.tenantId, [...new Set(order.lines.map((l) => l.productId))]);
    const qcItems: { productId: string; qty: string; unitCost: string; lot?: { lotNo?: string; expiryDate?: string } }[] = [];
    for (const line of order.lines) {
      const baseQty = D(line.qty).times(line.uomFactor);
      const dpp = dppOf(line);
      const unitCost = qty4(dpp.times(factor).div(baseQty));
      const toQc = !!quarantine.warehouseId && quarantine.required.has(line.productId) && quarantine.warehouseId !== order.warehouseId;
      const moved = await this.stock.move(tx, {
        tenantId: user.tenantId,
        productId: line.productId,
        warehouseId: toQc ? quarantine.warehouseId! : order.warehouseId,
        skipAccessCheck: toQc,
        type: 'PURCHASE',
        qty: baseQty,
        unitCost,
        refType: 'PURCHASE_INVOICE',
        refId: invoice.id,
        refNumber: number,
        date,
        lot: lotOf.get(line.id),
      });
      stockValue = stockValue.plus(moved.value);
      values.set(line.id, { unitCost, value: moved.value });
      if (toQc) qcItems.push({ productId: line.productId, qty: baseQty.toFixed(4), unitCost: unitCost.toFixed(4), lot: lotOf.get(line.id) });
      await tx.insert(purchaseInvoiceLines).values({
        invoiceId: invoice.id,
        productId: line.productId,
        uom: line.uom,
        uomFactor: line.uomFactor,
        qty: line.qty,
        price: (over.get(line.id) ?? D(line.price)).toFixed(2),
        priceForeign: pr.foreignPrice.get(line.id)?.toFixed(4) ?? null,
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

    const autoReceipt = await this.receipts.recordWithInvoice(tx, user, { order, date, invoiceId: invoice.id, capitalize, values });
    for (const it of qcItems) await this.qc.createForReceiptTx(tx, user, { receiptId: autoReceipt.id, productId: it.productId, warehouseId: quarantine.warehouseId!, releaseWarehouseId: order.warehouseId, qty: it.qty, unitCost: it.unitCost, lot: it.lot });
    await patchById(tx, purchaseOrders, order.id, { status: 'BILLED' });
    await patchById(tx, purchaseInvoices, invoice.id, { journalId: journal.id });
    await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseInvoice', entityId: invoice.id, data: { number, journal: journal.number } });
    return { id: invoice.id, journalNumber: journal.number };
  }

  /**
   * Jalur terima dulu: tagih barang yang sudah diterima. Jurnal: Dr Barang Diterima Belum Ditagih (nilai penerimaan), Dr PPN Masukan
   * | Cr Utang Usaha. Selisih pembulatan antara DPP dan nilai penerimaan masuk ke Selisih Persediaan.
   */
  private async billReceived(tx: Tx, user: AuthUser, order: Awaited<ReturnType<PurchaseOrdersService['lock']>>, dto: CreatePurchaseInvoiceDto, date: string) {
    const supplier = await this.repo.supplierById(tx, order.supplierId);
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

    const pr = this.pricing(order, dto);
    const over = pr.over;
    for (const id of pr.given.keys()) if (!items.some((x) => x.line.id === id)) throw new BadRequestException('Harga faktur diisi untuk baris yang tidak ditagih pada faktur ini');
    let subtotal: Dec = ZERO;
    let poSubtotal: Dec = ZERO;
    let grni: Dec = ZERO;
    let capitalized = false;
    const invLines: { line: (typeof order.lines)[number]; q: Dec; dpp: Dec; poDpp: Dec; value: Dec; baseQty: Dec }[] = [];
    const billings: { receiptId: string; receiptLineId: string; qty: Dec; value: Dec }[] = [];
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
        await patchById(tx, goodsReceiptLines, r.rl.id, { billedQty: sql`${goodsReceiptLines.billedQty} + ${take.toFixed(4)}`, billedValue: sql`${goodsReceiptLines.billedValue} + ${chunk.toFixed(2)}` });
        billings.push({ receiptId: r.rl.receiptId, receiptLineId: r.rl.id, qty: take, value: chunk });
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
        ...this.fxFields(order, { rate: pr.rate, tax, lineForeign: invLines.reduce<Dec>((a, x) => a.plus(lineTotal({ qty: x.q, price: pr.foreignPrice.get(x.line.id) ?? 0, discountPct: x.line.discountPct })), ZERO) }),
      })
      .returning();
    if (billings.length) await tx.insert(goodsReceiptBillings).values(billings.map((b) => ({ tenantId: user.tenantId, receiptId: b.receiptId, receiptLineId: b.receiptLineId, invoiceId: invoice.id, date, qty: b.qty.toFixed(4), value: b.value.toFixed(2) })));

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
        priceForeign: pr.foreignPrice.get(x.line.id)?.toFixed(4) ?? null,
        discountPct: x.line.discountPct,
        lineTotal: x.dpp.toFixed(2),
        unitCost: qty4(x.value.plus(variances[i].times(capFactor)).div(x.baseQty)).toFixed(4),
        priceVariance: variances[i].toFixed(2),
        orderLineId: x.line.id,
      });
      await patchById(tx, purchaseOrderLines, x.line.id, { billedQty: sql`${purchaseOrderLines.billedQty} + ${x.q.toFixed(4)}`, billedAmount: sql`${purchaseOrderLines.billedAmount} + ${x.poDpp.toFixed(2)}` });
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
    await patchById(tx, purchaseInvoices, invoice.id, { journalId: journal.id });
    // pesanan tuntas bila seluruh barang sudah ditagih
    const after = await tx.select({ qty: purchaseOrderLines.qty, billedQty: purchaseOrderLines.billedQty }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
    if (after.every((l) => D(l.billedQty).plus(QTY_EPS).gte(l.qty))) {
      await patchById(tx, purchaseOrders, order.id, { status: 'BILLED' });
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
}
