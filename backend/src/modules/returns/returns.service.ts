import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { returnForeign } from '../../common/utils/fx';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  customers,
  invoiceLines,
  invoices,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseReturnLines,
  purchaseReturns,
  salesOrders,
  salesReturnLines,
  salesReturns,
  suppliers,
} from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { lineTotal } from '../sales/pricing';
import { CreateReturnDto } from './returns.dto';

interface SourceLine {
  id: string;
  productId: string;
  uom: string;
  uomFactor: string;
  qty: string;
  price: string;
  discountPct: string;
  returnedQty: string;
  unitCost: string;
}

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
    // Retur penjualan = kredit nota yang mengurangi piutang: bernilai besar oleh staf (selain Pemilik/Admin) menunggu persetujuan
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const pol = await this.approvals.policy(this.db, user.tenantId);
      if (pol.salesReturn > 0) {
        const inv = await this.db.query.invoices.findFirst({ where: and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, user.tenantId)), with: { lines: true } });
        const value = (inv?.lines ?? []).reduce((a, l) => {
          const q = dto.lines.find((x) => x.invoiceLineId === l.id)?.qty;
          return q ? a + Number(q) * Number(l.price) * (1 - Number(l.discountPct) / 100) : a;
        }, 0);
        if (value >= pol.salesReturn) {
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
        ? await tx.select({ warehouseId: salesOrders.warehouseId }).from(salesOrders).where(eq(salesOrders.id, inv.salesOrderId))
        : [];
      if (!order) throw new BadRequestException('Gudang asal faktur tidak diketahui');
      const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));

      // Barang yang sudah/sedang ditukar-guling tidak boleh diretur lagi (outlet tidak boleh dapat pengganti sekaligus nota kredit)
      for (const l of dto.lines) {
        if (D(l.qty).lte(0)) continue;
        const sw = await tx.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${l.invoiceLineId} AND s.status IN ('PENDING', 'APPROVED')`);
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
      const [ret] = await tx
        .insert(salesReturns)
        .values({
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
        })
        .returning();

      let cost: Dec = ZERO;
      for (const l of lines) {
        // Barang kembali membawa penurunan nilai yang melekat saat dijual (agar koreksi fiskal ikut terbalik)
        const wd = await tx.execute<{ wu: string }>(sql`
          SELECT COALESCE(SUM(-writedown_value) / NULLIF(SUM(-qty), 0), 0) AS wu FROM stock_moves
          WHERE ((ref_type = 'INVOICE' AND ref_id = ${inv.id}) OR (ref_type = 'DELIVERY' AND ref_id = ${inv.deliveryOrderId ?? inv.id})) AND product_id = ${l.src.productId} AND type = 'SALE'`);
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
        await tx.insert(salesReturnLines).values({
          returnId: ret.id,
          invoiceLineId: l.src.id,
          productId: l.src.productId,
          uom: l.src.uom,
          qty: l.qty.toFixed(4),
          lineTotal: l.total.toFixed(2),
        });
        await tx
          .update(invoiceLines)
          .set({ returnedQty: D(l.src.returnedQty).plus(l.qty).toFixed(4) })
          .where(eq(invoiceLines.id, l.src.id));
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
      await tx
        .update(invoices)
        .set({
          returnedAmount: returned.toFixed(2),
          returnedForeign: D(inv.returnedForeign).plus(retForeign).toFixed(2),
          status: returned.plus(inv.paidAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        })
        .where(eq(invoices.id, inv.id));
      await tx
        .update(salesReturns)
        .set({ costAmount: money(cost).toFixed(2), journalId: journal.id })
        .where(eq(salesReturns.id, ret.id));
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
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, inv.supplierId));

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
      const [ret] = await tx
        .insert(purchaseReturns)
        .values({
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
        })
        .returning();

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
        await tx.insert(purchaseReturnLines).values({
          returnId: ret.id,
          invoiceLineId: l.src.id,
          productId: l.src.productId,
          uom: l.src.uom,
          qty: l.qty.toFixed(4),
          lineTotal: l.total.toFixed(2),
        });
        await tx
          .update(purchaseInvoiceLines)
          .set({ returnedQty: D(l.src.returnedQty).plus(l.qty).toFixed(4) })
          .where(eq(purchaseInvoiceLines.id, l.src.id));
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
      await tx
        .update(purchaseInvoices)
        .set({
          returnedAmount: returned.toFixed(2),
          returnedForeign: D(inv.returnedForeign).plus(retForeign).toFixed(2),
          status: returned.plus(inv.paidAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        })
        .where(eq(purchaseInvoices.id, inv.id));
      await tx.update(purchaseReturns).set({ journalId: journal.id }).where(eq(purchaseReturns.id, ret.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseReturn', entityId: ret.id });
      return { ...ret, total: total.toFixed(2), journalNumber: journal.number };
    });
  }

  private async lockRow(tx: Tx, table: 'invoices' | 'purchase_invoices', id: string, tenantId: string) {
    const res = await tx.execute(
      sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
    if (!res.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
  }

  private async sumTax(tx: Tx, table: 'sales_returns' | 'purchase_returns', fk: string, id: string): Promise<Dec> {
    const res = await tx.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(tax_amount), 0) AS v FROM ${sql.identifier(table)} WHERE ${sql.identifier(fk)} = ${id}`,
    );
    return D(res.rows[0].v);
  }
}
