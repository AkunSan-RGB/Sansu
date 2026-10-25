import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { returnForeign } from '../../common/utils/fx';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { invoiceLines, invoices, purchaseInvoiceLines, purchaseInvoices, purchaseReturns, salesReturns } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { lineTotal } from '../sales/pricing';
import { CreateReturnDto } from './returns.dto';
import { insertOne, patchById } from '../../db/owned';
import { ReturnsRepository } from './returns.repository';
import type { SourceLine } from './returns.repository';

/**
 * PPN retur: proporsional terhadap faktur asal. Jika retur ini menghabiskan seluruh sisa barang,
 * PPN = sisa PPN faktur agar total retur tidak selisih sen dari faktur.
 */
function returnTax(subtotal: Dec, inv: { subtotal: string; taxAmount: string }, prevTax: Dec, isFinal: boolean): Dec {
  if (isFinal) return money(D(inv.taxAmount).minus(prevTax));
  if (D(inv.subtotal).isZero()) return ZERO;
  return money(subtotal.times(inv.taxAmount).div(inv.subtotal));
}

/** Validasi baris retur terhadap baris faktur asal; kembalikan baris terhitung. */
function buildReturnLines(source: SourceLine[], dto: CreateReturnDto) {
  const byId = new Map(source.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const lines = dto.lines
    .filter((l) => D(l.qty).gt(0))
    .map((l) => {
      const src = byId.get(l.invoiceLineId);
      if (!src) throw new BadRequestException('Baris faktur tidak ditemukan');
      if (seen.has(src.id)) throw new BadRequestException('Baris faktur duplikat');
      seen.add(src.id);
      const remaining = D(src.qty).minus(src.returnedQty);
      if (D(l.qty).gt(remaining)) {
        throw new BadRequestException(`Qty retur melebihi sisa yang bisa diretur (${remaining.toString()} ${src.uom})`);
      }
      return { src, qty: D(l.qty), total: lineTotal({ qty: l.qty, price: src.price, discountPct: src.discountPct }) };
    });
  if (!lines.length) throw new BadRequestException('Isi minimal satu baris retur');
  const subtotal = lines.reduce<Dec>((a, l) => a.plus(l.total), ZERO);
  const isFinal = source.every((s) => {
    const r = lines.find((l) => l.src.id === s.id);
    return D(s.qty).minus(s.returnedQty).minus(r?.qty ?? 0).isZero();
  });
  return { lines, subtotal, isFinal };
}

@Injectable()
export class ReturnsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly repo: ReturnsRepository,
  ) {}

  // ================= Retur penjualan =================

  listSales(tenantId: string) {
    return this.db.query.salesReturns.findMany({
      where: eq(salesReturns.tenantId, tenantId),
      with: {
        customer: { columns: { code: true, name: true } },
        invoice: { columns: { number: true } },
        lines: { with: { product: { columns: { sku: true, name: true } } } },
      },
      orderBy: [desc(salesReturns.date), desc(salesReturns.number)],
      limit: 300,
    });
  }

  /**
   * Retur penjualan (nota kredit) — satu transaksi:
   *  - stok kembali masuk dengan HPP saat faktur dibuat
   *  - Dr Retur Penjualan, Dr PPN Keluaran | Cr Piutang
   *  - Dr Persediaan | Cr HPP
   *  - piutang faktur berkurang
   */
  async createSales(user: AuthUser, dto: CreateReturnDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    // Pemisahan fungsi (bila dinyalakan): retur atas faktur yang dibuat orang yang sama menunggu persetujuan Pemilik/Admin
    if (!opts.approved && !this.approvals.isApprover(user.role) && (await this.approvals.policy(this.db, user.tenantId)).salesSeparateDuties) {
      const creator = await this.approvals.invoiceCreator(this.db, user.tenantId, dto.invoiceId);
      if (creator && creator === user.sub) {
        const [inv] = await this.repo.findInvoicesById(this.db, dto.invoiceId, user.tenantId);
        const req = await this.approvals.create(this.db, user, { kind: 'SALES_RETURN', refId: null, title: `Retur penjualan faktur ${inv?.n ?? ''} oleh pembuat fakturnya`, amount: 0, payload: JSON.parse(JSON.stringify(dto)) });
        throw this.approvals.required(req.id, 'Retur atas faktur yang Anda buat sendiri menunggu persetujuan pemilik atau admin (pemisahan fungsi); permintaan dikirim dan retur dicatat setelah disetujui.');
      }
    }
    // Retur penjualan = kredit nota yang mengurangi piutang: bernilai besar oleh staf (selain Pemilik/Admin) menunggu persetujuan
    if (!opts.approved) {
      const pol = await this.approvals.policy(this.db, user.tenantId);
      if (pol.salesReturn > 0) {
        const inv = await this.db.query.invoices.findFirst({ where: and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, user.tenantId)), with: { lines: true } });
        const value = (inv?.lines ?? []).reduce((a, l) => {
          const q = dto.lines.find((x) => x.invoiceLineId === l.id)?.qty;
          return q ? a + Number(q) * Number(l.price) * (1 - Number(l.discountPct) / 100) : a;
        }, 0);
        if (value >= pol.salesReturn && this.approvals.isApprover(user.role)) {
          // Pemilik/Admin tidak dibatasi, tetapi Pemilik diberi tahu (kecuali dia sendiri pelakunya)
          void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `⚠ Retur penjualan faktur ${inv?.number ?? ''} bernilai besar dicatat tanpa persetujuan terpisah`, lines: [`≈ Rp${Math.round(value).toLocaleString('id-ID')}`], path: '/returns?tab=sales' });
        } else if (value >= pol.salesReturn) {
          const req = await this.approvals.create(this.db, user, { kind: 'SALES_RETURN', refId: null, title: `Retur penjualan faktur ${inv?.number ?? ''} (≈ Rp${Math.round(value).toLocaleString('id-ID')})`, amount: value, payload: JSON.parse(JSON.stringify(dto)) });
          throw this.approvals.required(req.id, 'Nilai retur mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan retur dicatat setelah disetujui.');
        }
      }
    }
    return this.db.transaction(async (tx) => {
      await this.lockRow(tx, 'invoices', dto.invoiceId, user.tenantId);
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, dto.invoiceId), with: { lines: true } });
      if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
      if (date < inv.date) throw new BadRequestException('Tanggal retur tidak boleh sebelum tanggal faktur');
      if (inv.kind === 'SERVICE') {
        throw new BadRequestException('Faktur jasa tidak bisa diretur. Untuk pengurangan tagihan jasa, catat nota kredit lewat jurnal penyesuaian.');
      }
      const [order] = inv.salesOrderId
        ? await this.repo.listSalesOrdersById(tx, inv.salesOrderId)
        : [];
      if (!order) throw new BadRequestException('Gudang asal faktur tidak diketahui');
      const [customer] = await this.repo.findCustomersById(tx, inv.customerId);

      // Barang yang sudah/sedang ditukar-guling tidak boleh diretur lagi (outlet tidak boleh dapat pengganti sekaligus nota kredit)
      for (const l of dto.lines) {
        if (D(l.qty).lte(0)) continue;
        const sw = await this.repo.queryGoodsSwapLine(tx, l.invoiceLineId);
        const src = inv.lines.find((x) => x.id === l.invoiceLineId);
        if (src && D(sw.rows[0].q).gt(0) && D(l.qty).gt(D(src.qty).minus(src.returnedQty).minus(sw.rows[0].q))) {
          throw new BadRequestException(`Sebagian barang pada baris ini sudah/sedang ditukar-guling (${D(sw.rows[0].q).toFixed(0)} ${src.uom}); jumlah retur melebihi sisa yang boleh diretur`);
        }
      }
      const { lines, subtotal, isFinal } = buildReturnLines(inv.lines, dto);
      const prevTax = await this.sumTax(tx, 'sales_returns', 'invoice_id', inv.id);
      const tax = returnTax(subtotal, inv, prevTax, isFinal);
      const total = subtotal.plus(tax);
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (total.gt(outstanding)) {
        throw new BadRequestException(
          `Nilai retur ${total.toFixed(2)} melebihi sisa piutang faktur ${outstanding.toFixed(2)}. ` +
            'Untuk faktur yang sudah dibayar, catat pengembalian dana lewat Kas Keluar.',
        );
      }

      const number = await this.seq.next(tx, user.tenantId, 'SALES_RETURN', date);
      const ret = await insertOne(tx, salesReturns, {
          tenantId: user.tenantId,
          number,
          date,
          invoiceId: inv.id,
          customerId: inv.customerId,
          warehouseId: order.warehouseId,
          reason: dto.reason,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          total: total.toFixed(2),
          costAmount: '0',
        });

      let cost: Dec = ZERO;
      for (const l of lines) {
        // Barang kembali membawa penurunan nilai yang melekat saat dijual (agar koreksi fiskal ikut terbalik)
        const wd = await this.repo.queryStockMove(tx, inv.id, inv.deliveryOrderId, l);
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.src.productId,
          warehouseId: order.warehouseId,
          type: 'SALE_RETURN',
          qty: l.qty.times(l.src.uomFactor),
          unitCost: l.src.unitCost,
          writedownUnit: D(wd.rows[0]?.wu ?? 0),
          refType: 'SALES_RETURN',
          refId: ret.id,
          refNumber: number,
          date,
        });
        cost = cost.plus(moved.value);
        await this.repo.insertSalesReturnLines(tx, ret.id, l.src.id, l.src.productId, l.src.uom, l.qty, l.total);
        await patchById(tx, invoiceLines, l.src.id, { returnedQty: D(l.src.returnedQty).plus(l.qty).toFixed(4) });
      }

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Retur penjualan ${number} atas ${inv.number} - ${customer.name}`,
        sourceType: 'SALES_RETURN',
        sourceId: ret.id,
        createdById: user.sub,
        lines: [
          { key: SYS.SALES_RETURN, debit: subtotal },
          { key: SYS.VAT_OUT, debit: tax },
          { key: SYS.AR, credit: total },
          { key: SYS.INVENTORY, debit: cost },
          { key: SYS.COGS, credit: cost },
        ],
      });

      const returned = D(inv.returnedAmount).plus(total);
      const retForeign = inv.currency === 'IDR' ? ZERO : returnForeign({ returnIdr: total, totalIdr: inv.total, paidIdr: inv.paidAmount, returnedIdr: inv.returnedAmount, totalForeign: inv.totalForeign ?? 0, paidForeign: inv.paidForeign, returnedForeign: inv.returnedForeign, rate: inv.fxRate });
      await patchById(tx, invoices, inv.id, {
          returnedAmount: returned.toFixed(2),
          returnedForeign: D(inv.returnedForeign).plus(retForeign).toFixed(2),
          status: returned.plus(inv.paidAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        });
      await patchById(tx, salesReturns, ret.id, { costAmount: money(cost).toFixed(2), journalId: journal.id });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'SalesReturn', entityId: ret.id });
      return { ...ret, total: total.toFixed(2), journalNumber: journal.number };
    });
  }

  // ================= Retur pembelian =================

  listPurchase(tenantId: string) {
    return this.db.query.purchaseReturns.findMany({
      where: eq(purchaseReturns.tenantId, tenantId),
      with: {
        supplier: { columns: { code: true, name: true } },
        invoice: { columns: { number: true, supplierInvoiceNo: true } },
        lines: { with: { product: { columns: { sku: true, name: true } } } },
      },
      orderBy: [desc(purchaseReturns.date), desc(purchaseReturns.number)],
      limit: 300,
    });
  }

  /**
   * Retur pembelian (nota debit):
   *  - stok keluar dengan HPP rata-rata saat ini
   *  - Dr Hutang | Cr PPN Masukan, Cr Persediaan (nilai stok keluar),
   *    selisih harga beli vs HPP rata-rata → Selisih Persediaan
   */
  async createPurchase(user: AuthUser, dto: CreateReturnDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      await this.lockRow(tx, 'purchase_invoices', dto.invoiceId, user.tenantId);
      const inv = await tx.query.purchaseInvoices.findFirst({
        where: eq(purchaseInvoices.id, dto.invoiceId),
        with: { lines: true },
      });
      if (!inv) throw new NotFoundException('Faktur pembelian tidak ditemukan');
      if (date < inv.date) throw new BadRequestException('Tanggal retur tidak boleh sebelum tanggal faktur');
      if (inv.kind !== 'GOODS' || !inv.warehouseId) {
        throw new BadRequestException('Retur hanya untuk faktur barang dagang. Untuk tagihan biaya/aset, minta nota kredit supplier dan catat lewat jurnal.');
      }
      const warehouseId = inv.warehouseId;
      const [supplier] = await this.repo.findSuppliersById(tx, inv.supplierId);

      const { lines, subtotal, isFinal } = buildReturnLines(
        inv.lines.map((l) => ({ ...l, productId: l.productId! })),
        dto,
      );
      const prevTax = await this.sumTax(tx, 'purchase_returns', 'purchase_invoice_id', inv.id);
      const tax = returnTax(subtotal, inv, prevTax, isFinal);
      const total = subtotal.plus(tax);
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (total.gt(outstanding)) {
        throw new BadRequestException(
          `Nilai retur ${total.toFixed(2)} melebihi sisa hutang faktur ${outstanding.toFixed(2)}. ` +
            'Untuk faktur yang sudah dibayar, catat pengembalian dana dari supplier lewat Kas Masuk.',
        );
      }

      const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_RETURN', date);
      const ret = await insertOne(tx, purchaseReturns, {
          tenantId: user.tenantId,
          number,
          date,
          purchaseInvoiceId: inv.id,
          supplierId: inv.supplierId,
          warehouseId,
          reason: dto.reason,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          total: total.toFixed(2),
        });

      let stockValue: Dec = ZERO;
      for (const l of lines) {
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.src.productId,
          warehouseId,
          type: 'PURCHASE_RETURN',
          qty: l.qty.times(l.src.uomFactor).negated(),
          refType: 'PURCHASE_RETURN',
          refId: ret.id,
          refNumber: number,
          date,
        });
        stockValue = stockValue.plus(moved.value);
        await this.repo.insertPurchaseReturnLines(tx, ret.id, l.src.id, l.src.productId, l.src.uom, l.qty, l.total);
        await patchById(tx, purchaseInvoiceLines, l.src.id, { returnedQty: D(l.src.returnedQty).plus(l.qty).toFixed(4) });
      }
      // PPN faktur non-PKP sudah masuk harga perolehan → ikut keluar bersama persediaan, bukan mengurangi PPN Masukan
      const vatBack = inv.vatCapitalized ? ZERO : tax;
      const diff = money(total.minus(vatBack).minus(stockValue)); // + : harga beli > HPP rata-rata

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Retur pembelian ${number} atas ${inv.number} - ${supplier.name}`,
        sourceType: 'PURCHASE_RETURN',
        sourceId: ret.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AP, debit: total },
          { key: SYS.VAT_IN, credit: vatBack },
          { key: SYS.INVENTORY, credit: stockValue },
          { key: SYS.INVENTORY_ADJ, credit: diff.gt(0) ? diff : 0, debit: diff.lt(0) ? diff.abs() : 0 },
        ],
      });

      const returned = D(inv.returnedAmount).plus(total);
      const retForeign = inv.currency === 'IDR' ? ZERO : returnForeign({ returnIdr: total, totalIdr: inv.total, paidIdr: inv.paidAmount, returnedIdr: inv.returnedAmount, totalForeign: inv.totalForeign ?? 0, paidForeign: inv.paidForeign, returnedForeign: inv.returnedForeign, rate: inv.fxRate });
      await patchById(tx, purchaseInvoices, inv.id, {
          returnedAmount: returned.toFixed(2),
          returnedForeign: D(inv.returnedForeign).plus(retForeign).toFixed(2),
          status: returned.plus(inv.paidAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        });
      await patchById(tx, purchaseReturns, ret.id, { journalId: journal.id });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseReturn', entityId: ret.id });
      return { ...ret, total: total.toFixed(2), journalNumber: journal.number };
    });
  }

  private async lockRow(tx: Tx, table: 'invoices' | 'purchase_invoices', id: string, tenantId: string) {
    const res = await this.repo.queryLockRow(tx, table, id, tenantId);
    if (!res.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
  }

  private async sumTax(tx: Tx, table: 'sales_returns' | 'purchase_returns', fk: string, id: string): Promise<Dec> {
    const res = await this.repo.querySumTax(tx, table, fk, id);
    return D(res.rows[0].v);
  }
}
