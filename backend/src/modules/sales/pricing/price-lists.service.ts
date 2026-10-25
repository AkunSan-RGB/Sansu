import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { toDocDate } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db, DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, priceListItems, priceLists, products, promos, suppliers } from '../../../db/schema';
import { BonusLine, PriceTier, PromoRule, quote } from './pricing-engine';
import { PriceListDto, UpdatePriceListDto, PriceItemDto, PromoDto, QuoteDto } from './price-lists.dto';

type ProductWithUoms = { id: string; sku: string; name: string; baseUom: string; sellPrice: string; uoms: { uom: string; factor: string }[] };

export interface RawLine {
  productId: string;
  uom?: string;
  qty: string;
  price?: string;
  discountPct?: string;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Terapkan daftar harga pelanggan dan promo pada baris pesanan. `byId` berisi produk baris (dengan satuan);
   * produk bonus yang belum ada ikut dimuat ke dalamnya. Baris bonus dikembalikan terpisah (harga 0).
   */
  async apply(
    db: DbOrTx,
    tenantId: string,
    customer: { priceListId: string | null },
    dateStr: string,
    lines: RawLine[],
    byId: Map<string, ProductWithUoms>,
    applyPromos = true,
  ) {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const tiers: PriceTier[] = customer.priceListId
      ? (
          await db
            .select({ productId: priceListItems.productId, minQty: priceListItems.minQty, price: priceListItems.price })
            .from(priceListItems)
            .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
            .where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.priceListId, customer.priceListId), eq(priceLists.isActive, true), inArray(priceListItems.productId, productIds)))
        ).map((r) => ({ productId: r.productId, minQty: r.minQty, price: r.price }))
      : [];
    const rules = applyPromos ? await this.activeRules(db, tenantId) : [];
    if (!tiers.length && !rules.length) return { lines: lines.map((l) => ({ ...l, priceSource: 'MASTER' as const })), bonus: [] as (BonusLine & { uom: string })[], promoLines: [] as { productId: string; promoName?: string }[] };

    const input = lines.map((l) => {
      const p = byId.get(l.productId);
      const uom = l.uom ?? p?.baseUom ?? '';
      const factor = !p || uom === p.baseUom ? '1' : (p.uoms.find((u) => u.uom === uom)?.factor ?? '1');
      return { productId: l.productId, uom, factor, qty: l.qty, price: l.price, discountPct: l.discountPct };
    });
    const q = quote(input, { tiers, promos: rules, date: dateStr, customerListId: customer.priceListId, applyPromos });
    const missing = q.bonus.map((b) => b.productId).filter((id) => !byId.has(id));
    if (missing.length) {
      const extra = await db.query.products.findMany({ where: and(eq(products.tenantId, tenantId), inArray(products.id, missing)), with: { uoms: true } });
      for (const p of extra) byId.set(p.id, p as ProductWithUoms);
    }
    return {
      lines: lines.map((l, i) => ({ ...l, price: q.lines[i].price ?? l.price, discountPct: q.lines[i].discountPct, priceSource: q.lines[i].priceSource, promoId: q.lines[i].promoId, promoName: q.lines[i].promoName })),
      bonus: q.bonus.map((b) => ({ ...b, uom: byId.get(b.productId)?.baseUom ?? '' })),
      promoLines: [],
    };
  }

  private async activeRules(db: DbOrTx, tenantId: string): Promise<PromoRule[]> {
    const rows = await db.select().from(promos).where(and(eq(promos.tenantId, tenantId), eq(promos.isActive, true)));
    return rows.map((r) => ({ ...r, kind: r.kind as 'DISCOUNT' | 'BONUS' }));
  }

  async listPriceLists(tenantId: string) {
    const rows = await this.db.execute<{ id: string; name: string; description: string | null; is_active: boolean; items: string; customers: string }>(sql`
      SELECT l.id, l.name, l.description, l.is_active,
             (SELECT COUNT(*) FROM price_list_items i WHERE i.price_list_id = l.id)::text AS items,
             (SELECT COUNT(*) FROM customers c WHERE c.price_list_id = l.id)::text AS customers
      FROM price_lists l WHERE l.tenant_id = ${tenantId} ORDER BY lower(l.name)`);
    return rows.rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isActive: r.is_active, itemCount: Number(r.items), customerCount: Number(r.customers) }));
  }

  async getPriceList(tenantId: string, id: string) {
    const [l] = await this.db.select().from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.tenantId, tenantId)));
    if (!l) throw new NotFoundException('Daftar harga tidak ditemukan');
    const items = await this.db
      .select({ productId: priceListItems.productId, sku: products.sku, name: products.name, baseUom: products.baseUom, sellPrice: products.sellPrice, minQty: priceListItems.minQty, price: priceListItems.price })
      .from(priceListItems)
      .innerJoin(products, eq(products.id, priceListItems.productId))
      .where(eq(priceListItems.priceListId, id))
      .orderBy(asc(products.sku), asc(priceListItems.minQty));
    return { ...l, items };
  }

  async createPriceList(user: AuthUser, dto: PriceListDto) {
    const name = dto.name.trim();
    try {
      const [row] = await this.db.insert(priceLists).values({ tenantId: user.tenantId, name, description: dto.description?.trim() || null }).returning();
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PriceList', entityId: row.id, data: { name } });
      return row;
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') throw new BadRequestException(`Daftar harga "${name}" sudah ada`);
      throw e;
    }
  }

  async updatePriceList(user: AuthUser, id: string, dto: UpdatePriceListDto) {
    const cur = await this.getPriceList(user.tenantId, id);
    const patch = { name: dto.name?.trim() ?? cur.name, description: dto.description !== undefined ? dto.description.trim() || null : cur.description, isActive: dto.isActive ?? cur.isActive };
    await this.db.update(priceLists).set(patch).where(and(eq(priceLists.id, id), eq(priceLists.tenantId, user.tenantId)));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'PriceList', entityId: id, data: { before: { name: cur.name, isActive: cur.isActive }, after: patch } });
    return this.getPriceList(user.tenantId, id);
  }

  /** Ganti seluruh isi daftar harga (satu langkah, atomik) */
  async replaceItems(user: AuthUser, id: string, items: PriceItemDto[]) {
    const cur = await this.getPriceList(user.tenantId, id);
    const seen = new Set<string>();
    for (const it of items) {
      if (D(it.minQty).lte(0)) throw new BadRequestException('Jumlah minimum harus lebih dari 0');
      if (D(it.price).lt(0)) throw new BadRequestException('Harga tidak boleh negatif');
      const k = `${it.productId}|${D(it.minQty).toFixed(4)}`;
      if (seen.has(k)) throw new BadRequestException('Satu produk tidak boleh punya dua harga untuk jumlah minimum yang sama');
      seen.add(k);
    }
    const ids = [...new Set(items.map((i) => i.productId))];
    if (ids.length) {
      const found = await this.db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, user.tenantId), inArray(products.id, ids)));
      if (found.length !== ids.length) throw new BadRequestException('Ada produk yang tidak ditemukan');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(priceListItems).where(eq(priceListItems.priceListId, id));
      if (items.length) await tx.insert(priceListItems).values(items.map((i) => ({ tenantId: user.tenantId, priceListId: id, productId: i.productId, minQty: D(i.minQty).toFixed(4), price: D(i.price).toFixed(4) })));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'PriceListItems', entityId: id, data: { name: cur.name, before: cur.items.length, after: items.length } });
    });
    return this.getPriceList(user.tenantId, id);
  }

  async listPromos(tenantId: string) {
    const rows = await this.db.execute<Record<string, string | boolean | null>>(sql`
      SELECT p.id, p.name, p.kind, p.product_id AS "productId", pr.sku AS "productSku", pr.name AS "productName", p.min_qty AS "minQty", p.discount_pct AS "discountPct",
             p.bonus_product_id AS "bonusProductId", b.sku AS "bonusSku", b.name AS "bonusName", p.bonus_qty AS "bonusQty",
             p.valid_from AS "validFrom", p.valid_to AS "validTo", p.price_list_id AS "priceListId", l.name AS "priceListName", p.funded_supplier_id AS "fundedSupplierId", p.funded_pct AS "fundedPct", p.is_active AS "isActive"
      FROM promos p LEFT JOIN products pr ON pr.id = p.product_id LEFT JOIN products b ON b.id = p.bonus_product_id LEFT JOIN price_lists l ON l.id = p.price_list_id
      WHERE p.tenant_id = ${tenantId} ORDER BY p.is_active DESC, p.created_at DESC`);
    return rows.rows;
  }

  private async validatePromo(tenantId: string, d: PromoDto) {
    if (D(d.minQty).lte(0)) throw new BadRequestException('Jumlah minimum harus lebih dari 0');
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw new BadRequestException('Tanggal akhir tidak boleh sebelum tanggal mulai');
    if (d.kind === 'DISCOUNT') {
      const pct = D(d.discountPct);
      if (pct.lte(0) || pct.gt(100)) throw new BadRequestException('Potongan harus lebih dari 0 dan paling banyak 100%');
    } else {
      if (!d.productId || !d.bonusProductId) throw new BadRequestException('Promo bonus perlu produk pemicu dan produk bonus');
      if (D(d.bonusQty).lte(0)) throw new BadRequestException('Jumlah bonus harus lebih dari 0');
    }
    const ids = [d.productId, d.bonusProductId].filter(Boolean) as string[];
    if (ids.length) {
      const found = await this.db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(ids)])));
      if (found.length !== new Set(ids).size) throw new BadRequestException('Produk tidak ditemukan');
    }
    if (d.fundedSupplierId) {
      const pct = D(d.fundedPct ?? 0);
      if (pct.lte(0) || pct.gt(100)) throw new BadRequestException('Persen tanggungan prinsipal harus lebih dari 0 dan paling banyak 100');
      const [s] = await this.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, d.fundedSupplierId), eq(suppliers.tenantId, tenantId)));
      if (!s) throw new BadRequestException('Prinsipal tidak ditemukan');
    } else if (D(d.fundedPct ?? 0).gt(0)) throw new BadRequestException('Pilih prinsipal yang menanggung biaya promo');
    if (d.priceListId) {
      const [l] = await this.db.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, d.priceListId), eq(priceLists.tenantId, tenantId)));
      if (!l) throw new BadRequestException('Daftar harga tidak ditemukan');
    }
  }

  private promoValues(d: PromoDto) {
    return {
      name: d.name.trim(),
      kind: d.kind,
      productId: d.productId ?? null,
      minQty: D(d.minQty).toFixed(4),
      discountPct: d.kind === 'DISCOUNT' ? D(d.discountPct).toFixed(2) : '0',
      bonusProductId: d.kind === 'BONUS' ? (d.bonusProductId ?? null) : null,
      bonusQty: d.kind === 'BONUS' ? D(d.bonusQty).toFixed(4) : '0',
      validFrom: d.validFrom ? toDocDate(d.validFrom) : null,
      validTo: d.validTo ? toDocDate(d.validTo) : null,
      priceListId: d.priceListId ?? null,
      fundedSupplierId: d.fundedSupplierId ?? null,
      fundedPct: d.fundedSupplierId ? D(d.fundedPct ?? 0).toFixed(2) : '0',
      isActive: d.isActive ?? true,
    };
  }

  async createPromo(user: AuthUser, dto: PromoDto) {
    await this.validatePromo(user.tenantId, dto);
    const [row] = await this.db.insert(promos).values({ tenantId: user.tenantId, ...this.promoValues(dto) }).returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Promo', entityId: row.id, data: { name: row.name, kind: row.kind } });
    return row;
  }

  async updatePromo(user: AuthUser, id: string, dto: PromoDto) {
    const [cur] = await this.db.select().from(promos).where(and(eq(promos.id, id), eq(promos.tenantId, user.tenantId)));
    if (!cur) throw new NotFoundException('Promo tidak ditemukan');
    await this.validatePromo(user.tenantId, dto);
    const values = this.promoValues(dto);
    await this.db.update(promos).set(values).where(eq(promos.id, id));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'Promo', entityId: id, data: { before: { name: cur.name, discountPct: cur.discountPct, isActive: cur.isActive }, after: values } });
    return { id, ...values };
  }

  async preview(user: AuthUser, dto: QuoteDto) {
    const [customer] = await this.db.select({ id: customers.id, priceListId: customers.priceListId }).from(customers).where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
    if (!customer) throw new BadRequestException('Pelanggan tidak ditemukan');
    const prods = await this.db.query.products.findMany({ where: and(eq(products.tenantId, user.tenantId), inArray(products.id, dto.lines.map((l) => l.productId))), with: { uoms: true } });
    const byId = new Map(prods.map((p) => [p.id, p as ProductWithUoms]));
    const date = toDocDate(dto.date);
    const r = await this.apply(this.db, user.tenantId, customer, date, dto.lines, byId, dto.applyPromos ?? true);
    const priced = r.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new BadRequestException(`Produk ${l.productId} tidak ditemukan`);
      const uom = l.uom ?? p.baseUom;
      const factor = uom === p.baseUom ? '1' : (p.uoms.find((u) => u.uom === uom)?.factor ?? '1');
      return { productId: l.productId, uom, qty: l.qty, price: l.price ?? D(p.sellPrice).times(factor).toFixed(2), discountPct: l.discountPct ?? '0', source: l.priceSource, promoName: (l as { promoName?: string }).promoName ?? null };
    });
    return { lines: priced, bonus: r.bonus.map((b) => ({ productId: b.productId, sku: byId.get(b.productId)?.sku, name: byId.get(b.productId)?.name, uom: b.uom, qty: b.qty, promoName: b.promoName })) };
  }
}
