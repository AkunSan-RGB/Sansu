import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { POS_PAYMENT_METHODS, type PosPaymentMethod } from '@sansu/shared';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { localTaxOf, outputVatRate, taxProfileOf } from '../../common/settings.service';
import { nowAt, todayJakarta } from '../../common/utils/dates';
import { D, Dec, Decimal, money, ZERO } from '../../common/utils/money';
import { InjectDb } from '../../db/db.module';
import { posOrders, posSessions, products } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { StockService } from '../inventory/stock.service';
import { inventoryLines, semiSet } from '../inventory/inventory-accounts';
import { componentNeeds, portionsAvailable, recipesFor } from './recipe-issue';
import { LoyaltyService } from './loyalty.service';
import { earnPoints } from '@sansu/shared';
import { buildLines } from '../master-data/products/line-builder';
import { documentTotals, inclusiveTotals } from '../sales/pricing';
import { PosProductQueryDto, OpenSessionDto, CreatePosOrderDto, CloseSessionDto, PosQuoteDto } from './pos.dto';
import { PricingService } from '../sales/pricing/price-lists.service';
import { Db, DbOrTx, Tx } from '../../db/db';
import { ReferenceRepository } from '../../db/reference.repository';
import { insertOne, patchById } from '../../db/owned';
import { PosRepository } from './pos.repository';

@Injectable()
export class PosService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly loyalty: LoyaltyService,
    private readonly approvals: ApprovalsService,
    private readonly refs: ReferenceRepository,
    private readonly repo: PosRepository,
    private readonly pricing: PricingService,
  ) {}

  /** Produk untuk layar kasir: harga, satuan, barcode, dan stok di gudang sesi */
  async products(tenantId: string, q: PosProductQueryDto) {
    const term = q.q?.trim();
    const rows = await this.db.query.products.findMany({
      where: and(
        eq(products.tenantId, tenantId),
        eq(products.isActive, true),
        term ? or(ilike(products.name, `%${term}%`), ilike(products.sku, `%${term}%`), eq(products.barcode, term)) : undefined,
      ),
      with: { uoms: true },
      orderBy: products.name,
      limit: 200,
    });
    const stock = q.warehouseId
      ? await this.repo.listStockBalancesByWarehouseId(this.db, tenantId, q.warehouseId)
      : [];
    const byId = new Map(stock.map((s) => [s.productId, s.qty]));
    // menu yang dibuat saat dipesan: "stok" = porsi yang masih bisa dibuat dari bahan (resep belum ada = 0)
    const menu = rows.filter((p) => p.madeToOrder);
    const portions = new Map<string, string>();
    if (menu.length && q.warehouseId) {
      for (const m of menu) {
        try {
          const rec = await recipesFor(this.db, tenantId, [m]);
          for (const [k, v] of await portionsAvailable(this.db, tenantId, q.warehouseId, rec)) portions.set(k, v);
        } catch {
          portions.set(m.id, '0');
        }
      }
    }
    return rows.map((p) => ({ ...p, stock: p.madeToOrder ? (portions.get(p.id) ?? '0') : (byId.get(p.id) ?? '0') }));
  }

  /** Sesi terbuka milik kasir yang sedang login */
  async current(user: AuthUser) {
    const s = await this.db.query.posSessions.findFirst({
      where: and(eq(posSessions.tenantId, user.tenantId), eq(posSessions.userId, user.sub), eq(posSessions.status, 'OPEN')),
      with: {
        warehouse: { columns: { id: true, code: true, name: true } },
        cashAccount: { columns: { id: true, code: true, name: true } },
        bankAccount: { columns: { id: true, code: true, name: true } },
      },
    });
    if (!s) return null;
    const summary = await this.summary(this.db, s.id, s.openingCash);
    // Tutup kasir buta: Kasir tidak melihat uang tunai yang seharusnya ada (modal awal + penjualan tunai − retur tunai) sebelum menghitung laci
    if (user.role === 'CASHIER' && (await this.approvals.policy(this.db, user.tenantId)).blindCashClose) {
      return { ...s, summary: { ...summary, blind: true, expectedCash: '0.00', cashRefunds: '0.00', byMethod: { ...summary.byMethod, CASH: '0.00' } } };
    }
    return { ...s, summary };
  }

  async open(user: AuthUser, dto: OpenSessionDto) {
    return this.db.transaction(async (tx) => {
      const [existing] = await this.repo.findPosSessionsByUserIdAndStatus(tx, user.sub);
      if (existing) throw new BadRequestException(`Anda masih punya sesi kasir terbuka (${existing.number})`);
      const wh = await this.refs.warehouse(tx, user.tenantId, dto.warehouseId);
      if (!wh) throw new BadRequestException('Gudang / toko tidak ditemukan');
      if (wh.kind !== 'MAIN') throw new BadRequestException('Gudang konsinyasi/mobil hanya dipakai lewat menu Konsinyasi / Kanvas');
      // kasir yang dibatasi ke toko tertentu tidak bisa membuka sesi di toko lain
      assertWarehouseAccess(user, wh.id);
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'CASH');
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.bankAccountId, 'BANK');
      const opening = money(dto.openingCash);
      if (opening.isNegative()) throw new BadRequestException('Modal awal tidak boleh negatif');
      const today = todayJakarta();
      const number = await this.seq.next(tx, user.tenantId, 'POS_SESSION', today);
      const s = await insertOne(tx, posSessions, {
          tenantId: user.tenantId,
          number,
          userId: user.sub,
          warehouseId: wh.id,
          cashAccountId: cash.id,
          bankAccountId: bank.id,
          openingCash: opening.toFixed(2),
          openedAt: nowAt(8),
        });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'OPEN', entity: 'PosSession', entityId: s.id });
      return s;
    });
  }

  /**
   * Penjualan kasir — satu transaksi:
   *  stok keluar (HPP rata-rata) · jurnal Dr Kas/Bank | Cr Penjualan, Cr PPN Keluaran · Dr HPP | Cr Persediaan
   */
  async createOrder(user: AuthUser, dto: CreatePosOrderDto) {
    const result = await this.db.transaction((tx) => this.createOrderTx(tx, user, dto));
    return this.getOrder(user.tenantId, result);
  }

  /** Inti penjualan kasir di dalam transaksi pemanggil (dipakai juga oleh pembayaran pesanan meja); mengembalikan id transaksi */
  /**
   * Harga dan potongan yang berlaku untuk keranjang: daftar harga pelanggan, bila tidak ada daftar harga toko (gudang sesi), lalu
   * harga jual master; ditambah promo diskon yang aktif. Bonus barang tidak dipakai di kasir. Hasil sama persis dengan yang
   * dipakai server untuk memeriksa kasir, jadi layar kasir cukup menampilkan angka ini.
   */
  async priceCart(db: DbOrTx, tenantId: string, warehouseId: string, customerId: string | undefined, date: string, lines: { productId: string; uom?: string; qty: string }[]) {
    const [wh] = await this.repo.findWarehousePriceList(db, tenantId, warehouseId);
    let priceListId = wh?.priceListId ?? null;
    if (customerId) {
      const [c] = await this.repo.findCustomersById(db, customerId, tenantId);
      if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
      priceListId = c.priceListId ?? priceListId;
    }
    const prods = await db.query.products.findMany({ where: and(eq(products.tenantId, tenantId), inArray(products.id, lines.map((l) => l.productId))), with: { uoms: true } });
    const byId = new Map(prods.map((p) => [p.id, p]));
    const r = await this.pricing.apply(db, tenantId, { priceListId }, date, lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: l.qty })), byId, true);
    const priced = r.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new BadRequestException(`Produk ${l.productId} tidak ditemukan`);
      const uom = l.uom ?? p.baseUom;
      const factor = uom === p.baseUom ? '1' : (p.uoms.find((u) => u.uom === uom)?.factor ?? '1');
      return {
        productId: l.productId,
        uom,
        qty: l.qty,
        price: money(l.price ?? D(p.sellPrice).times(factor)).toFixed(2),
        discountPct: D(l.discountPct ?? 0).toString(),
        source: l.priceSource,
        promoName: (l as { promoName?: string }).promoName ?? null,
      };
    });
    // Bonus barang: hanya barang stok biasa (bukan menu/setengah jadi) dan dibatasi sisa stok toko setelah barang yang dibeli
    const stockRows = r.bonus.length ? await this.repo.listStockBalancesByWarehouseId(db, tenantId, warehouseId) : [];
    const avail = new Map(stockRows.map((x) => [x.productId, D(x.qty)]));
    const bought = new Map<string, Dec>();
    for (const l of priced) {
      const p = byId.get(l.productId)!;
      const f = l.uom === p.baseUom ? D(1) : D(p.uoms.find((u) => u.uom === l.uom)?.factor ?? 1);
      bought.set(l.productId, (bought.get(l.productId) ?? ZERO).plus(D(l.qty).times(f)));
    }
    const bonus: { productId: string; sku: string; name: string; uom: string; qty: string; promoName: string }[] = [];
    for (const b of r.bonus) {
      const p = byId.get(b.productId);
      if (!p || p.madeToOrder || p.inventoryKind === 'SEMI') continue;
      const free = (avail.get(b.productId) ?? ZERO).minus(bought.get(b.productId) ?? ZERO);
      const give = Decimal.min(D(b.qty), free.lt(0) ? ZERO : free);
      if (give.lte(0)) continue;
      bonus.push({ productId: b.productId, sku: p.sku, name: p.name, uom: p.baseUom, qty: give.toString(), promoName: b.promoName });
      avail.set(b.productId, free.minus(give).plus(bought.get(b.productId) ?? ZERO));
    }
    return { lines: priced, bonus };
  }

  /** Kutipan harga untuk layar kasir (tanpa menyimpan apa pun) */
  async quote(user: AuthUser, dto: PosQuoteDto) {
    const [s] = await this.repo.findPosSessionsById(this.db, dto.sessionId);
    if (!s || s.tenantId !== user.tenantId) throw new NotFoundException('Sesi kasir tidak ditemukan');
    if (s.status !== 'OPEN') throw new BadRequestException(`Sesi ${s.number} sudah ditutup`);
    return this.priceCart(this.db, user.tenantId, s.warehouseId, dto.customerId, todayJakarta(), dto.lines);
  }

  async createOrderTx(
    tx: Tx,
    user: AuthUser,
    dto: CreatePosOrderDto,
    extra: { tabId?: string; online?: { channel: string; externalRef: string | null; feePct: number } } = {},
  ): Promise<string> {
    const session = await this.lockSession(tx, user, dto.sessionId);
    const date = todayJakarta();
    const [tenant] = await this.repo.findTenantsById(tx, user.tenantId);
    if (dto.customerId) {
      const [c] = await this.repo.findCustomersById(tx, dto.customerId, user.tenantId);
      if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
    }
    // Harga yang berlaku (daftar harga toko/pelanggan + promo diskon) dihitung server; baris tanpa harga/diskon memakainya
    const expected = await this.priceCart(tx, user.tenantId, session.warehouseId, dto.customerId, date, dto.lines);
    let lines = await buildLines(
      tx,
      user.tenantId,
      dto.lines.map((l, i) => ({ ...l, price: l.price ?? expected.lines[i].price, discountPct: l.discountPct ?? expected.lines[i].discountPct })),
      'sell',
      2,
      { menuOk: true },
    );
    // Anti-fraud: kasir/sales tidak boleh mengubah harga atau memberi diskon sendiri; hanya supervisor (Pemilik, Admin, Keuangan)
    if (user.role === 'CASHIER' || user.role === 'SALES') {
      const masters = await tx.query.products.findMany({ where: and(eq(products.tenantId, user.tenantId), inArray(products.id, lines.map((l) => l.productId))), columns: { id: true, sellPrice: true } });
      const m = new Map(masters.map((p) => [p.id, p]));
      for (const [i, l] of lines.entries()) {
        const p = m.get(l.productId)!;
        const master = money(D(p.sellPrice).times(l.uomFactor));
        // barang tanpa harga jual (mis. bahan baku) tidak boleh "dijual" kasir: stoknya berkurang tanpa pendapatan (celah barang gratis)
        if (master.lte(0)) {
          const [pn] = await this.repo.findProductsById(tx, l.productId);
          throw new BadRequestException(`Harga jual ${pn?.name ?? 'barang'} (${pn?.sku ?? ''}) belum diisi (Rp 0), jadi tidak bisa dijual di kasir. Isi harga jual di Produk, atau minta supervisor.`);
        }
        // yang boleh: harga & potongan persis seperti hitungan server (harga master, daftar harga toko/pelanggan, promo aktif)
        if (!l.price.eq(money(expected.lines[i].price)) || !l.discountPct.eq(D(expected.lines[i].discountPct))) {
          throw new ForbiddenException('Harga dan diskon hanya dapat diubah oleh supervisor (Pemilik, Admin, atau Keuangan). Kasir menjual dengan harga yang berlaku (harga master/daftar harga toko dan promo aktif).');
        }
      }
    }
    // Bonus barang promo ditambahkan server (harga 0; stok dan HPP tercatat); klien tidak mengirimnya
    const requested = lines.length;
    if (expected.bonus.length)
      lines = [
        ...lines,
        ...(await buildLines(tx, user.tenantId, expected.bonus.map((b) => ({ productId: b.productId, uom: b.uom, qty: b.qty, price: '0', discountPct: '0' })), 'sell', 2, {})),
      ];
    // Harga rak termasuk PPN → DPP & PPN dihitung mundur; non-PKP → tanpa PPN
    const inclusive = taxProfileOf(tenant.settings).posPricesIncludeVat;
    // Pajak daerah (PB1/PBJT) menggantikan PPN pada penjualan kasir bila dinyalakan
    const local = localTaxOf(tenant.settings);
    const rate = local.enabled ? local.rate : outputVatRate(tenant);
    const totals = inclusive ? inclusiveTotals(lines, rate) : documentTotals(lines, rate, taxProfileOf(tenant.settings).vatRounding);

    // Pembayaran: non-tunai tidak boleh lebih dari tagihan; kelebihan tunai = kembalian
    // Pesanan online dibayar platform kemudian (piutang platform); metode itu tidak boleh dipilih kasir pada penjualan biasa
    const online = extra.online ?? null;
    if (!online && dto.payments?.some((p) => p.method === 'PLATFORM')) throw new BadRequestException('Metode "Dibayar platform" hanya untuk pesanan online');
    const payments: { method: PosPaymentMethod; amount: string }[] = online ? [{ method: 'PLATFORM', amount: totals.total.toFixed(2) }] : dto.payments;
    if (!payments?.length) throw new BadRequestException('Pembayaran wajib diisi');
    const platformFee = online ? money(totals.subtotal.times(online.feePct).div(100)) : ZERO;
    // tukar poin loyalitas (nilai potongan dihitung dari aturan; keabsahan diperiksa saat saldo dikunci setelah transaksi dibuat)
    const loyalty = await this.loyalty.settings(user.tenantId, tx);
    if (dto.redeemPoints) {
      if (!dto.customerId) throw new BadRequestException('Tukar poin membutuhkan pelanggan terdaftar');
      if (online) throw new BadRequestException('Pesanan online tidak dapat memakai poin');
      if (!loyalty.enabled) throw new BadRequestException('Program loyalitas belum diaktifkan');
    }
    const redeemValue = dto.redeemPoints ? money(D(dto.redeemPoints).times(loyalty.pointValueRp)) : ZERO;
    let nonCash: Dec = ZERO;
    let cashIn: Dec = ZERO;
    for (const p of payments) {
      const amt = money(p.amount);
      if (amt.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');
      if (p.method === 'CASH') cashIn = cashIn.plus(amt);
      else nonCash = nonCash.plus(amt);
    }
    if (nonCash.plus(redeemValue).gt(totals.total)) throw new BadRequestException('Pembayaran non-tunai dan poin melebihi total belanja');
    const tendered = cashIn.plus(nonCash).plus(redeemValue);
    if (tendered.lt(totals.total)) {
      throw new BadRequestException(`Pembayaran kurang ${totals.total.minus(tendered).toFixed(0)}`);
    }
    const change = tendered.minus(totals.total);
    if (change.gt(cashIn)) throw new BadRequestException('Kembalian tidak boleh melebihi uang tunai yang diterima');
    const cashNet = cashIn.minus(change);

    const number = await this.seq.next(tx, user.tenantId, 'POS_ORDER', date);
    const order = await insertOne(tx, posOrders, {
        tenantId: user.tenantId,
        sessionId: session.id,
        number,
        date,
        customerId: dto.customerId,
        subtotal: totals.subtotal.toFixed(2),
        taxAmount: totals.taxAmount.toFixed(2),
        total: totals.total.toFixed(2),
        tendered: tendered.toFixed(2),
        change: change.toFixed(2),
        pricesIncludeVat: inclusive,
        taxKind: local.enabled ? 'LOCAL' : 'VAT',
        tabId: extra.tabId ?? null,
        channel: online?.channel ?? null,
        externalRef: online?.externalRef ?? null,
        platformFee: platformFee.toFixed(2),
        orderType: dto.orderType ?? null,
        tableLabel: dto.tableLabel?.trim() || null,
      });

    let cogs: Dec = ZERO;
    const issued: { productId: string; value: Dec }[] = [];
    const menuRows = await tx.query.products.findMany({
      where: and(eq(products.tenantId, user.tenantId), inArray(products.id, lines.map((l) => l.productId)), eq(products.madeToOrder, true)),
      columns: { id: true, sku: true },
    });
    const recipes = await recipesFor(tx, user.tenantId, menuRows);
    for (const [lineIdx, l] of lines.entries()) {
      const baseQty = D(l.qty).times(l.uomFactor);
      const recipe = recipes.get(l.productId);
      let lineValue: Dec = ZERO;
      let unitCost: Dec;
      if (recipe) {
        // menu: bahan dipotong sesuai resep; HPP baris = nilai bahan yang terpakai
        for (const need of componentNeeds(recipe, baseQty)) {
          const moved = await this.stock.move(tx, {
            tenantId: user.tenantId,
            productId: need.productId,
            warehouseId: session.warehouseId,
            type: 'SALE',
            qty: need.qty.negated(),
            refType: 'POS_ORDER',
            refId: order.id,
            refNumber: number,
            date,
          });
          lineValue = lineValue.plus(moved.value);
          issued.push({ productId: need.productId, value: moved.value });
        }
        unitCost = baseQty.gt(0) ? lineValue.div(baseQty) : ZERO;
      } else {
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.productId,
          warehouseId: session.warehouseId,
          type: 'SALE',
          qty: baseQty.negated(),
          refType: 'POS_ORDER',
          refId: order.id,
          refNumber: number,
          date,
        });
        lineValue = moved.value;
        unitCost = moved.unitCost;
        issued.push({ productId: l.productId, value: moved.value });
      }
      cogs = cogs.plus(lineValue);
      await this.repo.insertPosOrderLines(tx, order.id, l.productId, l.uom, l.uomFactor, l.qty, l.price, l.discountPct, l.lineTotal, unitCost, recipe, lineIdx >= requested);
    }
    cogs = money(cogs);

    // Loyalitas: tukar poin (pembayaran non-kas), lalu poin baru dari jumlah yang dibayar nyata
    let loyaltyLines: { key: typeof SYS.LOYALTY_LIABILITY | typeof SYS.LOYALTY_EXPENSE; debit?: Dec; credit?: Dec }[] = [];
    if (dto.customerId && loyalty.enabled && !online) {
      if (dto.redeemPoints) {
        const r = await this.loyalty.redeemTx(tx, user, { customerId: dto.customerId, orderId: order.id, points: dto.redeemPoints, totalRp: totals.total.toNumber(), settings: loyalty });
        const diff = r.discount.minus(r.liability);
        loyaltyLines.push({ key: SYS.LOYALTY_LIABILITY, debit: r.liability });
        if (diff.gt(0)) loyaltyLines.push({ key: SYS.LOYALTY_EXPENSE, debit: diff });
        else if (diff.lt(0)) loyaltyLines.push({ key: SYS.LOYALTY_EXPENSE, credit: diff.abs() });
      }
      const pts = earnPoints(totals.total.minus(redeemValue).toNumber(), loyalty);
      if (pts > 0) {
        const v = await this.loyalty.earnTx(tx, { tenantId: user.tenantId, customerId: dto.customerId, orderId: order.id, points: pts, settings: loyalty, userId: user.sub });
        loyaltyLines.push({ key: SYS.LOYALTY_EXPENSE, debit: v }, { key: SYS.LOYALTY_LIABILITY, credit: v });
      }
      await patchById(tx, posOrders, order.id, { loyaltyEarnedPoints: pts, loyaltyRedeemedPoints: dto.redeemPoints ?? 0, loyaltyRedeemedValue: redeemValue.toFixed(2) });
    }

    // Gabungkan pembayaran per metode (tunai bersih setelah kembalian)
    const byMethod = new Map<PosPaymentMethod, Dec>();
    for (const p of payments) if (p.method !== 'CASH') byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).plus(money(p.amount)));
    if (cashNet.gt(0)) byMethod.set('CASH', cashNet);
    await this.repo.insertPosPayments(tx, byMethod, order.id);

    const journal = await this.posting.post(tx, {
      tenantId: user.tenantId,
      date,
      description: `Penjualan kasir ${number}`,
      sourceType: 'POS',
      sourceId: order.id,
      createdById: user.sub,
      lines: [
        ...(online
          ? [
              // dibayar platform: piutang platform sebesar penjualan dikurangi komisi, komisi langsung menjadi beban
              { key: SYS.PLATFORM_RECEIVABLE, debit: totals.total.minus(platformFee) },
              { key: SYS.PLATFORM_FEE, debit: platformFee },
            ]
          : [
              { accountId: session.cashAccountId, debit: cashNet },
              { accountId: session.bankAccountId, debit: nonCash },
            ]),
        { key: SYS.SALES, credit: totals.subtotal },
        { key: local.enabled ? SYS.LOCAL_TAX : SYS.VAT_OUT, credit: totals.taxAmount },
        ...loyaltyLines,
        { key: SYS.COGS, debit: cogs },
        ...inventoryLines(issued, await semiSet(tx, user.tenantId, issued.map((i) => i.productId)), 'credit'),
      ],
    });
    await patchById(tx, posOrders, order.id, { cogsAmount: cogs.toFixed(2), journalId: journal.id });
    return order.id;
  }

  async getOrder(tenantId: string, id: string) {
    const o = await this.db.query.posOrders.findFirst({
      where: and(eq(posOrders.id, id), eq(posOrders.tenantId, tenantId)),
      with: {
        lines: { with: { product: { columns: { sku: true, name: true } } } },
        payments: true,
        customer: { columns: { code: true, name: true } },
        session: { columns: { number: true }, with: { user: { columns: { name: true } }, warehouse: { columns: { name: true, address: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Transaksi kasir tidak ditemukan');
    return o;
  }

  listOrders(tenantId: string, sessionId?: string) {
    return this.db.query.posOrders.findMany({
      where: and(eq(posOrders.tenantId, tenantId), sessionId ? eq(posOrders.sessionId, sessionId) : undefined),
      with: { payments: true, customer: { columns: { name: true } } },
      orderBy: desc(posOrders.createdAt),
      limit: 300,
    });
  }

  async listSessions(tenantId: string) {
    const rows = await this.db.query.posSessions.findMany({
      where: eq(posSessions.tenantId, tenantId),
      with: { user: { columns: { name: true } }, warehouse: { columns: { name: true } } },
      orderBy: desc(posSessions.openedAt),
      limit: 200,
    });
    const totals = await this.repo.queryPosOrder(this.db, tenantId);
    const byId = new Map(totals.rows.map((t) => [t.session_id, t]));
    return rows.map((r) => ({ ...r, orderCount: byId.get(r.id)?.n ?? 0, totalSales: D(byId.get(r.id)?.total).toFixed(2) }));
  }

  /**
   * Tutup kasir: bandingkan uang di laci dengan seharusnya.
   * Selisih dijurnal ke "Selisih Kas Kasir" (kurang = beban, lebih = mengurangi beban).
   */
  async close(user: AuthUser, id: string, dto: CloseSessionDto) {
    return this.db.transaction(async (tx) => {
      const s = await this.lockSession(tx, user, id, true);
      const sum = await this.summary(tx, s.id, s.openingCash);
      const counted = money(dto.countedCash);
      if (counted.isNegative()) throw new BadRequestException('Jumlah uang tidak boleh negatif');
      const expected = D(sum.expectedCash);
      const diff = counted.minus(expected);
      const date = todayJakarta();
      let closeJournalId: string | undefined;
      let journalNumber: string | undefined;
      if (!diff.isZero()) {
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description: `Selisih kas tutup kasir ${s.number} (${diff.isNegative() ? 'kurang' : 'lebih'})`,
          sourceType: 'POS_CLOSE',
          sourceId: s.id,
          createdById: user.sub,
          lines: diff.isNegative()
            ? [
                { key: SYS.CASH_DIFF, debit: diff.abs() },
                { accountId: s.cashAccountId, credit: diff.abs() },
              ]
            : [
                { accountId: s.cashAccountId, debit: diff },
                { key: SYS.CASH_DIFF, credit: diff },
              ],
        });
        closeJournalId = j.id;
        journalNumber = j.number;
      }
      const [closed] = await this.repo.updatePosSessionsById(tx, expected, counted, diff, dto.notes, closeJournalId, s.id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CLOSE', entity: 'PosSession', entityId: s.id, data: { diff: diff.toFixed(2) } });
      return { ...closed, summary: sum, journalNumber };
    });
  }

  /** Ringkasan sesi: total per metode & uang tunai yang seharusnya ada di laci */
  private async summary(db: Db | Tx, sessionId: string, openingCash: string) {
    const res = await this.repo.queryPosPayment(db, sessionId);
    const [agg] = (
      await this.repo.queryPosOrderForSummary(db, sessionId)
    ).rows;
    const byMethod = Object.fromEntries(POS_PAYMENT_METHODS.map((m) => [m, '0.00'])) as Record<PosPaymentMethod, string>;
    res.rows.forEach((r) => (byMethod[r.method] = D(r.amount).toFixed(2)));
    // uang tunai yang dikembalikan dari laci sesi ini (retur kasir oleh supervisor)
    const [ref] = (await this.repo.queryPosReturn(db, sessionId)).rows;
    return {
      orderCount: agg.n,
      totalSales: D(agg.total).toFixed(2),
      byMethod,
      cashRefunds: D(ref.total).toFixed(2),
      expectedCash: D(openingCash).plus(byMethod.CASH).minus(ref.total).toFixed(2),
    };
  }

  private async lockSession(tx: Tx, user: AuthUser, id: string, forClose = false) {
    const res = await this.repo.queryPosSession(tx, id, user.tenantId);
    if (!res.rows.length) throw new NotFoundException('Sesi kasir tidak ditemukan');
    const [s] = await this.repo.findPosSessionsById(tx, id);
    if (s.status !== 'OPEN') throw new BadRequestException(`Sesi ${s.number} sudah ditutup`);
    const manager = user.role === 'OWNER' || user.role === 'ADMIN' || user.role === 'FINANCE';
    if (s.userId !== user.sub && !(forClose && manager)) {
      throw new ForbiddenException('Sesi ini milik kasir lain');
    }
    return s;
  }
}
