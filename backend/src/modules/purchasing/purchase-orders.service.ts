import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { foreignTotals } from '../../common/utils/fx';
import { D, money } from '../../common/utils/money';
import { FxService } from '../fx/fx.service';
import { PriceAgreementsService } from './price-agreements';
import { CreatePurchaseOrderDto, PurchaseOrderQueryDto } from './purchasing.dto';

/** Purchase order: DRAFT → CONFIRMED (dikirim ke supplier) → BILLED (barang & faktur diterima) */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly fx: FxService,
    private readonly agreements: PriceAgreementsService,
  ) {}

  /** Status penerimaan dan penagihan turunan dari baris pesanan: NONE / PARTIAL / FULL */
  static progress(lines: { qty: string; receivedQty: string; billedQty: string }[]) {
    const state = (pick: 'receivedQty' | 'billedQty') => {
      const done = lines.reduce((a, l) => a + Number(l[pick]), 0);
      const all = lines.reduce((a, l) => a + Number(l.qty), 0);
      return done <= 0 ? 'NONE' : done + 0.00005 >= all ? 'FULL' : 'PARTIAL';
    };
    return { receiptStatus: state('receivedQty') as 'NONE' | 'PARTIAL' | 'FULL', billingStatus: state('billedQty') as 'NONE' | 'PARTIAL' | 'FULL' };
  }

  async list(tenantId: string, q: PurchaseOrderQueryDto) {
    const rows = await this.db.query.purchaseOrders.findMany({
      where: and(
        eq(purchaseOrders.tenantId, tenantId),
        q.status ? eq(purchaseOrders.status, q.status) : undefined,
        q.supplierId ? eq(purchaseOrders.supplierId, q.supplierId) : undefined,
      ),
      with: {
        supplier: { columns: { code: true, name: true } },
        invoices: { columns: { id: true, number: true } },
        lines: { columns: { qty: true, receivedQty: true, billedQty: true } },
      },
      orderBy: [desc(purchaseOrders.date), desc(purchaseOrders.number)],
      limit: 300,
    });
    // `invoice` (faktur pertama) dipertahankan untuk tampilan lama; `invoices` memuat semua faktur bertahap
    return rows.map(({ lines, ...o }) => ({ ...o, invoice: o.invoices[0] ?? null, ...PurchaseOrdersService.progress(lines) }));
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const o = await db.query.purchaseOrders.findFirst({
      where: and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)),
      with: {
        supplier: { columns: { id: true, code: true, name: true, address: true, phone: true, npwp: true } },
        warehouse: { columns: { id: true, code: true, name: true, address: true } },
        lines: { with: { product: { columns: { sku: true, name: true, baseUom: true } } } },
        invoices: { columns: { id: true, number: true, supplierInvoiceNo: true, date: true, total: true, status: true } },
        receipts: { columns: { id: true, number: true, date: true, status: true, value: true, supplierDeliveryNo: true, autoInvoiceId: true } },
      },
    });
    if (!o) throw new NotFoundException('Purchase order tidak ditemukan');
    return { ...o, invoice: o.invoices[0] ?? null, ...PurchaseOrdersService.progress(o.lines) };
  }

  async create(user: AuthUser, dto: CreatePurchaseOrderDto) {
    const id = await this.db.transaction((tx) => this.createIn(tx, user, dto));
    return this.get(user.tenantId, id);
  }

  /** Buat PO draft di dalam transaksi pemanggil (dipakai juga oleh konversi permintaan pembelian) */
  async createIn(tx: Tx, user: AuthUser, dto: CreatePurchaseOrderDto): Promise<string> {
    const date = toDocDate(dto.date);
    {
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
      if (wh.kind !== 'MAIN') throw new BadRequestException('Gudang konsinyasi/mobil hanya dipakai lewat menu Konsinyasi / Kanvas');

      const { currency, rate } = await this.fx.resolve(tx, user.tenantId, dto.currency, date, dto.fxRate);
      const foreign = currency !== 'IDR';
      const lines = await buildLines(tx, user.tenantId, dto.lines, 'required', foreign ? 4 : 2);
      if (!foreign) await this.agreements.enforce(tx, user, supplier.id, date, lines);
      // Valas: harga baris dalam mata uang PO; Rupiah dihitung pada kurs PO (kurs ini juga dipakai faktur dan penerimaan barang)
      const fxDoc = foreign ? foreignTotals(lines.map((l) => l.lineTotal), rate, tenant.ppnRate, taxProfileOf(tenant.settings).vatRounding) : null;
      const priceForeign = lines.map((l) => (foreign ? l.price : null));
      if (fxDoc) lines.forEach((l, i) => ((l.price = money(l.price.times(rate))), (l.lineTotal = fxDoc.lineIdr[i])));
      const totals = fxDoc ? { subtotal: fxDoc.subtotalIdr, taxAmount: fxDoc.taxIdr, total: fxDoc.totalIdr } : documentTotals(lines, tenant.ppnRate, taxProfileOf(tenant.settings).vatRounding);
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
          priceEstimate: dto.priceEstimate ?? false,
          currency,
          fxRate: rate.toFixed(6),
          totalForeign: fxDoc ? fxDoc.totalForeign.toFixed(2) : null,
          createdById: user.sub,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
        })
        .returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values(
        lines.map((l, i) => ({
          orderId: order.id,
          priceForeign: priceForeign[i]?.toFixed(4) ?? null,
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
    }
  }

  /** Buat dan langsung konfirmasi PO dari penawaran supplier; bila nilainya perlu persetujuan, PO tetap draft dan `approvalPending` true */
  async quick(user: AuthUser, dto: CreatePurchaseOrderDto) {
    const created = await this.create(user, { ...dto, priceEstimate: true });
    try {
      await this.confirm(user, created.id);
    } catch (e) {
      if (e instanceof ConflictException) return { ...(await this.get(user.tenantId, created.id)), approvalPending: true, approvalMessage: e.message };
      throw e;
    }
    return { ...(await this.get(user.tenantId, created.id)), approvalPending: false, approvalMessage: null as string | null };
  }

  /**
   * Riwayat harga beli aktual (dari faktur supplier, 12 bulan terakhir) per produk: terakhir, rata-rata 90 hari, terendah, tertinggi,
   * dan rincian per supplier — semuanya per satuan dasar, sebelum PPN.
   */
  async priceHistory(tenantId: string, productIds: string[]) {
    const ids = [...new Set(productIds)];
    const rows = (
      await this.db.execute<{ product_id: string; supplier_id: string; supplier_name: string; date: string; unit: string }>(sql`
        SELECT l.product_id, i.supplier_id, s.name AS supplier_name, i.date::text AS date,
               l.line_total / NULLIF(l.qty * l.uom_factor, 0) AS unit
        FROM purchase_invoice_lines l
        JOIN purchase_invoices i ON i.id = l.invoice_id
        JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.tenant_id = ${tenantId} AND i.kind = 'GOODS' AND l.product_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})
          AND i.date >= CURRENT_DATE - 365 AND l.qty * l.uom_factor > 0
        ORDER BY i.date DESC, i.created_at DESC`)
    ).rows;
    const today = Date.now();
    const out: Record<string, { last: number; lastDate: string; lastSupplier: string; avg90: number | null; min: number; max: number; count: number; suppliers: { supplierId: string; name: string; last: number; lastDate: string; avg: number; count: number }[] }> = {};
    for (const id of ids) {
      const mine = rows.filter((r) => r.product_id === id);
      if (!mine.length) continue;
      const u = mine.map((r) => Number(r.unit));
      const recent = mine.filter((r) => today - new Date(r.date).getTime() <= 90 * 86_400_000).map((r) => Number(r.unit));
      const bySup = new Map<string, typeof mine>();
      for (const r of mine) bySup.set(r.supplier_id, [...(bySup.get(r.supplier_id) ?? []), r]);
      const r2 = (x: number) => Math.round(x * 100) / 100;
      out[id] = {
        last: r2(u[0]),
        lastDate: mine[0].date,
        lastSupplier: mine[0].supplier_name,
        avg90: recent.length ? r2(recent.reduce((a, b) => a + b, 0) / recent.length) : null,
        min: r2(Math.min(...u)),
        max: r2(Math.max(...u)),
        count: mine.length,
        suppliers: [...bySup.entries()].map(([supplierId, rs]) => ({
          supplierId,
          name: rs[0].supplier_name,
          last: r2(Number(rs[0].unit)),
          lastDate: rs[0].date,
          avg: r2(rs.reduce((a, b) => a + Number(b.unit), 0) / rs.length),
          count: rs.length,
        })),
      };
    }
    return out;
  }

  async confirm(user: AuthUser, id: string) {
    // Pesanan bernilai besar dari peran yang tidak berwenang: butuh persetujuan (permintaan dibuat di luar transaksi)
    const [po] = await this.db.select({ number: purchaseOrders.number, total: purchaseOrders.total, status: purchaseOrders.status, supplierId: purchaseOrders.supplierId }).from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, user.tenantId)));
    // Supplier favorit: pesanan sampai batas yang ditetapkan untuknya disetujui otomatis
    const [sup] = po ? await this.db.select({ preferred: suppliers.isPreferred, limit: suppliers.autoApproveLimit }).from(suppliers).where(eq(suppliers.id, po.supplierId)) : [];
    const autoApproved = !!sup?.preferred && Number(sup.limit) > 0 && Number(po!.total) <= Number(sup.limit);
    if (po?.status === 'DRAFT' && !autoApproved) await this.approvals.gateDocument(this.db, user, { kind: 'PURCHASE_ORDER', refId: id, title: `Pesanan ${po.number}`, amount: Number(po.total) });
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
      const [{ receipts }] = (await tx.execute<{ receipts: number }>(sql`SELECT COUNT(*)::int AS receipts FROM goods_receipts WHERE purchase_order_id = ${id} AND status = 'RECEIVED'`)).rows;
      if (receipts > 0) throw new BadRequestException('PO sudah ada penerimaan barang; batalkan penerimaannya dulu atau buat retur pembelian');
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
