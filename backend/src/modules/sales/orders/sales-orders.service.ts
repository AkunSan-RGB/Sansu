import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { ApprovalsService } from '../../../common/approvals/approvals.service';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { outputVatRate, taxProfileOf } from '../../../common/settings.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, products, promos, salesOrderLines, salesOrders, stockBalances, tenants, users, warehouses } from '../../../db/schema';
import { foreignTotals } from '../../../common/utils/fx';
import { FxService } from '../../fx/fx.service';
import { documentTotals, inclusiveDocument, lineTotal } from '../pricing';
import { PricingService } from '../pricing/price-lists.service';
import { CreateSalesOrderDto, SalesOrderLineDto, SalesOrderQueryDto } from '../sales.dto';
import { CreditService } from './credit.service';
import { ReferenceRepository } from '../../../db/reference.repository';
import { patchById } from '../../../db/owned';
import { SalesOrdersRepository } from './sales-orders.repository';

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly credit: CreditService,
    private readonly audit: AuditService,
    private readonly fx: FxService,
    private readonly pricing: PricingService,
    private readonly approvals: ApprovalsService,
    private readonly refs: ReferenceRepository,
    private readonly repo: SalesOrdersRepository,
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
    // Jumlah yang sudah dikirim per baris (pengiriman bisa bertahap)
    const sent = await this.repo.queryDeliveryOrderLine(db, id);
    const m = new Map(sent.rows.map((r) => [r.id, r.q]));
    return { ...o, lines: o.lines.map((l) => ({ ...l, deliveredQty: m.get(l.id) ?? '0' })) };
  }

  async create(user: AuthUser, dto: CreateSalesOrderDto, opts: { consignment?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      const [tenant] = await this.repo.findTenantsById(tx, user.tenantId);
      const customer = await this.refs.customer(tx, user.tenantId, dto.customerId);
      if (!customer || !customer.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
      const poNo = dto.customerPoNo?.trim() || null;
      if (customer.requirePo && !poNo && !opts.consignment) throw new BadRequestException(`${customer.name} mewajibkan nomor PO outlet pada setiap pesanan`);
      if (poNo) {
        const [dup] = await this.repo.findSalesOrdersByCustomerIdAndCustomerPoNoAndStatus(tx, user.tenantId, customer.id, poNo);
        if (dup) throw new BadRequestException(`Nomor PO ${poNo} sudah dipakai pada pesanan ${dup.number} (satu PO tidak boleh ditagih dua kali)`);
      }
      const wh = await this.refs.warehouse(tx, user.tenantId, dto.warehouseId);
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      // Gudang titipan hanya dipakai lewat alur konsinyasi (laporan outlet → ditagih); gudang mobil hanya oleh sales pemiliknya atau Admin
      if (wh.kind === 'CONSIGNMENT' && !opts.consignment) throw new BadRequestException(`${wh.name} adalah gudang konsinyasi: jual lewat Penjualan › Konsinyasi (laporan penjualan outlet)`);
      if (wh.kind === 'VAN' && wh.vanUserId !== user.sub && !['OWNER', 'ADMIN'].includes(user.role)) throw new BadRequestException(`${wh.name} adalah stok mobil sales lain`);
      // Penjualan dari mobil oleh Sales hanya lewat Kanvas (harga & potongan dikunci server); pesanan biasa dengan harga/potongan bebas ditolak
      if (wh.kind === 'VAN' && user.role === 'SALES' && !opts.consignment && dto.lines.some((l) => l.price !== undefined || D(l.discountPct).gt(0)))
        throw new BadRequestException('Penjualan dari mobil dilakukan lewat Penjualan › Kanvas; harga dan potongan tidak dapat diisi sendiri');

      const prods = await tx.query.products.findMany({
        where: and(eq(products.tenantId, user.tenantId), inArray(products.id, dto.lines.map((l) => l.productId))),
        with: { uoms: true },
      });
      const byId = new Map(prods.map((p) => [p.id, p]));

      // sales pemegang pesanan: dipilih eksplisit (harus berperan Sales di perusahaan ini) atau pembuat pesanan bila ia Sales
      let salespersonId: string | null = null;
      // Sales tidak boleh mengalihkan pesanan (dan komisinya) ke sales lain; hanya Admin/Pemilik yang menunjuk
      if (dto.salespersonId && user.role === 'SALES' && dto.salespersonId !== user.sub) throw new BadRequestException('Sales hanya dapat mencatat pesanan atas namanya sendiri');
      if (dto.salespersonId) {
        const [sp] = await this.repo.findUsersByIdAndRoleAndIsActive(tx, dto.salespersonId, user.tenantId);
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
      const promoIds = [...new Set(rawLines.map((l) => l.promoId).filter((x): x is string => !!x))];
      const funded = new Map<string, { s: string | null; p: string }>();
      if (promoIds.length) {
        const pr = await this.repo.listPromosById(tx, user.tenantId, promoIds);
        for (const r of pr) funded.set(r.id, { s: r.s, p: r.p });
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
          fundedSupplierId: l.promoId ? (funded.get(l.promoId)?.s ?? null) : null,
          fundedPct: l.promoId ? (funded.get(l.promoId)?.p ?? '0') : '0',
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
          promoFundedSupplierId: l.fundedSupplierId ?? null,
          promoFundedPct: l.fundedPct ?? '0',
        })),
      );
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'SalesOrder', entityId: order.id });
      return order.id;
    }).catch((e) => {
      // dua pesanan bersamaan dengan nomor PO outlet yang sama: yang kedua ditolak indeks unik
      const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
      if ((err.code ?? err.cause?.code) === '23505' && `${err.constraint ?? err.cause?.constraint}`.includes('customer_po')) throw new BadRequestException('Nomor PO outlet ini sudah dipakai pada pesanan lain (satu PO tidak boleh ditagih dua kali)');
      throw e;
    });
    return this.get(user.tenantId, id);
  }

  /** DRAFT → CONFIRMED: cek faktur jatuh tempo & limit kredit. */
  async confirm(user: AuthUser, id: string, opts: { internal?: boolean } = {}) {
    // Persetujuan: pesanan bernilai besar, atau diskon per baris di atas batas, oleh staf (selain Pemilik/Admin) menunggu persetujuan.
    // Alur internal (kanvas/konsinyasi) harga dan potongannya sudah dikunci server sehingga tidak dikenai gerbang ini.
    if (!opts.internal) {
      const pre = await this.db.query.salesOrders.findFirst({ where: and(eq(salesOrders.id, id), eq(salesOrders.tenantId, user.tenantId)), with: { lines: true } });
      if (pre?.status === 'DRAFT') {
        const pol = await this.approvals.policy(this.db, user.tenantId);
        const maxDisc = Math.max(0, ...pre.lines.map((l) => Number(l.discountPct)));
        const byDiscount = pol.salesDiscountMaxPct > 0 && maxDisc > pol.salesDiscountMaxPct;
        const byValue = pol.salesOrder > 0 && Number(pre.total) >= pol.salesOrder;
        // Harga jual (setelah diskon) di bawah harga pokok rata-rata gudang: menembus batas diskon lewat harga yang diketik langsung
        let belowCost: string[] = [];
        if (pol.salesBelowCost) {
          const bal = await this.repo.listStockBalancesByWarehouseIdAndProductId(this.db, user.tenantId, pre.warehouseId, pre.lines);
          const avg = new Map(bal.map((b) => [b.productId, Number(b.avg)]));
          belowCost = pre.lines
            .filter((l) => Number(l.price) > 0 && (avg.get(l.productId) ?? 0) > 0 && Number(l.price) * (1 - Number(l.discountPct) / 100) < (avg.get(l.productId) ?? 0) * Number(l.uomFactor) - 0.005)
            .map((l) => l.productId);
        }
        const byCost = belowCost.length > 0;
        const why = byCost ? `Ada ${belowCost.length} baris dijual di bawah harga pokok` : byDiscount ? `Diskon ${maxDisc}% melebihi batas ${pol.salesDiscountMaxPct}%` : 'Nilai pesanan mencapai batas persetujuan';
        const risky = byDiscount || byValue || byCost;
        if (risky && this.approvals.isApprover(user.role)) {
          // Pemilik/Admin tidak dibatasi, tetapi Pemilik diberi tahu (kecuali dia sendiri pelakunya) dan tercatat di jejak audit
          await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CONFIRM_RISKY', entity: 'SalesOrder', entityId: id, data: { why } });
          void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `⚠ Pesanan ${pre.number} dikonfirmasi tanpa persetujuan terpisah`, lines: [why], path: '/sales-orders' });
        }
        await this.approvals.gateIf(
          this.db,
          user,
          { kind: 'SALES_ORDER', refId: id, title: `Pesanan ${pre.number}${byCost ? ' (harga di bawah pokok)' : byDiscount ? ` (diskon ${maxDisc}%)` : ''}`, amount: Number(pre.total) },
          risky,
          why,
        );
      }
    }
    let number = '';
    let customerId = '';
    await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, id);
      if (order.status !== 'DRAFT') throw new BadRequestException(`Order berstatus ${order.status}, tidak bisa dikonfirmasi`);
      await this.credit.assertCanOrder(tx, user.tenantId, order.customerId, D(order.total), order.id);
      await patchById(tx, salesOrders, id, { status: 'CONFIRMED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CONFIRM', entity: 'SalesOrder', entityId: id });
      number = order.number;
      customerId = order.customerId;
    });
    // Gudang tahu pesanan apa yang harus disiapkan dan dikirim
    const [c] = await this.repo.findCustomersById(this.db, customerId);
    void this.approvals.notifyRoles(user.tenantId, { roles: ['WAREHOUSE'], excludeUserId: user.sub, info: true, title: `Pesanan ${number} untuk ${c?.name ?? 'pelanggan'} siap disiapkan dan dikirim`, lines: ['Siapkan barang, hitung, lalu catat pengiriman (surat jalan).'], path: '/sales-orders' });
    return this.get(user.tenantId, id);
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    let was = '';
    let number = '';
    await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, id);
      if (order.status === 'INVOICED') throw new BadRequestException('Order sudah difakturkan; buat retur penjualan');
      if (order.status === 'DELIVERED') throw new BadRequestException('Barang sudah dikirim; batalkan surat jalannya dulu atau buat faktur');
      if (order.status === 'CANCELLED') throw new BadRequestException('Order sudah dibatalkan');
      if ((await this.repo.queryDeliveryOrder(tx, id)).rows.length) throw new BadRequestException('Sebagian barang sudah dikirim; batalkan surat jalannya dulu');
      // Pesanan yang sudah dikonfirmasi lalu dibatalkan staf: wajib alasan (tidak boleh dipakai menghilangkan jejak penjualan)
      if (order.status === 'CONFIRMED' && !this.approvals.isApprover(user.role) && (reason?.trim().length ?? 0) < 5) {
        throw new BadRequestException('Isi alasan pembatalan pesanan yang sudah dikonfirmasi (minimal 5 huruf)');
      }
      was = order.status;
      number = order.number;
      await patchById(tx, salesOrders, id, { status: 'CANCELLED', cancelReason: reason?.trim() || null, cancelledById: user.sub });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'SalesOrder', entityId: id, data: { reason: reason?.trim() || null, wasStatus: order.status } });
    });
    if (was === 'CONFIRMED') {
      void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER', 'ADMIN', 'WAREHOUSE'], excludeUserId: user.sub, info: true, title: `Pesanan ${number} yang sudah dikonfirmasi dibatalkan`, lines: [reason?.trim() ? `Alasan: ${reason.trim()}` : 'Tanpa alasan tertulis'], path: '/sales-orders' });
    }
    return this.get(user.tenantId, id);
  }

  /** Pengiriman buta: Gudang tidak melihat jumlah pesanan (hanya menghitung dan mengisi yang dikemas) */
  async forViewer<T extends { status: string; lines?: { qty: string; deliveredQty?: string }[] }>(user: AuthUser, o: T): Promise<T & { blindDelivery: boolean }> {
    const blind = user.role === 'WAREHOUSE' && o.status === 'CONFIRMED' && (await this.approvals.policy(this.db, user.tenantId)).blindDelivery;
    if (!blind) return { ...o, blindDelivery: false };
    return { ...o, blindDelivery: true, lines: o.lines?.map((l) => ({ ...l, qty: '0', deliveredQty: '0' })) };
  }

  /** Kunci baris order agar konfirmasi/faktur tidak berjalan dua kali bersamaan. */
  async lockOrder(tx: Tx, tenantId: string, id: string) {
    const locked = await this.repo.querySalesOrder(tx, id, tenantId);
    if (!locked.rows.length) throw new NotFoundException('Sales order tidak ditemukan');
    const order = await tx.query.salesOrders.findFirst({ where: eq(salesOrders.id, id), with: { lines: true } });
    return order!;
  }
}
