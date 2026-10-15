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
import { customers, products, salesOrderLines, salesOrders, tenants, users, warehouses } from '../../../db/schema';
import { foreignTotals } from '../../../common/utils/fx';
import { FxService } from '../../fx/fx.service';
import { documentTotals, inclusiveDocument, lineTotal } from '../pricing';
import { PricingService } from '../pricing/price-lists';
import { CreateSalesOrderDto, SalesOrderLineDto, SalesOrderQueryDto } from '../sales.dto';
import { CreditService } from './credit.service';

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly credit: CreditService,
    private readonly audit: AuditService,
    private readonly fx: FxService,
    private readonly pricing: PricingService,
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

  async create(user: AuthUser, dto: CreateSalesOrderDto, opts: { consignment?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
      if (!customer || !customer.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
      const poNo = dto.customerPoNo?.trim() || null;
      if (customer.requirePo && !poNo) throw new BadRequestException(`${customer.name} mewajibkan nomor PO outlet pada setiap pesanan`);
      if (poNo) {
        const [dup] = await tx.select({ number: salesOrders.number }).from(salesOrders).where(and(eq(salesOrders.tenantId, user.tenantId), eq(salesOrders.customerId, customer.id), eq(salesOrders.customerPoNo, poNo), sql`${salesOrders.status} <> 'CANCELLED'`));
        if (dup) throw new BadRequestException(`Nomor PO ${poNo} sudah dipakai pada pesanan ${dup.number} (satu PO tidak boleh ditagih dua kali)`);
      }
      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      // Gudang titipan hanya dipakai lewat alur konsinyasi (laporan outlet → ditagih); gudang mobil hanya oleh sales pemiliknya atau Admin
      if (wh.kind === 'CONSIGNMENT' && !opts.consignment) throw new BadRequestException(`${wh.name} adalah gudang konsinyasi: jual lewat Penjualan › Konsinyasi (laporan penjualan outlet)`);
      if (wh.kind === 'VAN' && wh.vanUserId !== user.sub && !['OWNER', 'ADMIN'].includes(user.role)) throw new BadRequestException(`${wh.name} adalah stok mobil sales lain`);

      const prods = await tx.query.products.findMany({
        where: and(eq(products.tenantId, user.tenantId), inArray(products.id, dto.lines.map((l) => l.productId))),
        with: { uoms: true },
      });
      const byId = new Map(prods.map((p) => [p.id, p]));

      // sales pemegang pesanan: dipilih eksplisit (harus berperan Sales di perusahaan ini) atau pembuat pesanan bila ia Sales
      let salespersonId: string | null = null;
      if (dto.salespersonId) {
        const [sp] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, dto.salespersonId), eq(users.tenantId, user.tenantId), eq(users.role, 'SALES'), eq(users.isActive, true)));
        if (!sp) throw new BadRequestException('Sales tidak ditemukan / nonaktif');
        salespersonId = sp.id;
      } else if (user.role === 'SALES') {
        salespersonId = user.sub;
      }

      const { currency, rate: fxRate } = await this.fx.resolve(tx, user.tenantId, dto.currency, date, dto.fxRate);
      const foreign = currency !== 'IDR';
      if (foreign && dto.pricesIncludeVat) throw new BadRequestException('Pesanan valas memakai harga belum termasuk PPN');

      // Daftar harga pelanggan + promo: hanya mengisi harga/potongan yang kosong, dan menambah baris bonus (harga 0). Valas diisi manual.
      type PromoLine = SalesOrderLineDto & { promoId?: string; isBonus?: boolean };
      let rawLines: PromoLine[] = dto.lines;
      if (!foreign) {
        const r = await this.pricing.apply(tx, user.tenantId, customer, date, dto.lines, byId, dto.applyPromos ?? true);
        rawLines = [
          ...r.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: l.qty, price: l.price, discountPct: l.discountPct, promoId: (l as { promoId?: string }).promoId })),
          ...r.bonus.map((b) => ({ productId: b.productId, uom: b.uom, qty: b.qty, price: '0', discountPct: '0', promoId: b.promoId, isBonus: true })),
        ];
      }
      const lines = rawLines.map((l) => {
        const p = byId.get(l.productId);
        if (!p || !p.isActive) throw new BadRequestException(`Produk ${l.productId} tidak ditemukan / nonaktif`);
        if (p.inventoryKind === 'SEMI') throw new BadRequestException(`${p.sku} adalah barang setengah jadi: dibuat dan dipakai lewat perintah produksi, tidak dijual`);
        if (p.madeToOrder) throw new BadRequestException(`${p.sku} adalah menu yang dibuat saat dipesan: jual lewat Kasir (POS) agar bahan sesuai resep terpotong otomatis`);
        const uom = l.uom ?? p.baseUom;
        const factor = uom === p.baseUom ? '1' : p.uoms.find((u) => u.uom === uom)?.factor;
        if (!factor) throw new BadRequestException(`Satuan ${uom} tidak terdaftar untuk ${p.sku}`);
        if (D(l.qty).lte(0)) throw new BadRequestException(`Kuantitas ${p.sku} harus > 0`);
        const discountPct = D(l.discountPct);
        if (discountPct.lt(0) || discountPct.gt(100)) throw new BadRequestException('Diskon harus 0–100%');
        if (foreign && l.price === undefined) throw new BadRequestException(`Harga ${p.sku} dalam ${currency} wajib diisi`);
        // valas: harga diketik dalam mata uang dokumen (4 desimal); nilai Rupiah dihitung dari kurs di bawah
        const priceForeign = foreign ? D(l.price).toDecimalPlaces(4) : null;
        if (priceForeign?.isNegative()) throw new BadRequestException(`Harga ${p.sku} tidak boleh negatif`);
        const price = priceForeign ? money(priceForeign.times(fxRate)) : l.price !== undefined ? money(l.price) : money(D(p.sellPrice).times(factor));
        return {
          promoId: l.promoId ?? null,
          isBonus: !!l.isBonus,
          priceForeign,
          productId: p.id,
          uom,
          uomFactor: factor,
          qty: l.qty,
          price,
          discountPct,
          lineTotal: lineTotal({ qty: l.qty, price: priceForeign ?? price, discountPct }),
        };
      });
      // Valas: nilai baris (mata uang dokumen) dikonversi per baris; DPP rupiah = jumlah baris rupiah, PPN dari DPP rupiah
      const fxDoc = foreign ? foreignTotals(lines.map((l) => l.lineTotal), fxRate, outputVatRate(tenant), taxProfileOf(tenant.settings).vatRounding) : null;
      if (fxDoc) lines.forEach((l, i) => (l.lineTotal = fxDoc.lineIdr[i]));

      const rate = outputVatRate(tenant);
      const inclusive = !!dto.pricesIncludeVat && D(rate).gt(0);
      const doc = fxDoc
        ? { lines: lines.map((l) => ({ ...l, priceInclVat: null })), subtotal: fxDoc.subtotalIdr, taxAmount: fxDoc.taxIdr, total: fxDoc.totalIdr }
        : inclusive
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
          salespersonId,
          customerPoNo: poNo,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
          pricesIncludeVat: inclusive,
          currency,
          fxRate: fxRate.toFixed(6),
          totalForeign: fxDoc ? fxDoc.totalForeign.toFixed(2) : null,
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
          priceForeign: l.priceForeign ? l.priceForeign.toFixed(4) : null,
          promoId: l.promoId ?? null,
          isBonus: l.isBonus ?? false,
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
