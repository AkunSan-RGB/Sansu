import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isProductionModel } from '@sansu/shared';
import { SettingsService } from '../../../common/settings.service';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { products, productUoms } from '../../../db/schema';
import { canonicalCategory, categorySpellings, cleanCategory, isPlain } from './category';
import { CreateProductDto, MergeCategoriesDto, ProductUomDto, UpdateProductDto } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Daftar kategori beserta jumlah produknya, dan kelompok ejaan ganda (beda huruf besar/kecil atau spasi) yang bisa disatukan */
  async categories(tenantId: string) {
    const r = await this.db.execute<{ name: string; count: number }>(sql`
      SELECT category AS name, COUNT(*)::int AS count FROM products
      WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND btrim(category) <> '' GROUP BY category ORDER BY category`);
    const items = r.rows;
    const groups = new Map<string, { name: string; count: number }[]>();
    for (const it of items) {
      const k = cleanCategory(it.name)!.toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    const duplicates = [...groups.values()]
      .filter((g) => g.length > 1 || cleanCategory(g[0].name) !== g[0].name)
      .map((variants) => {
        const best = [...variants].sort((a, b) => b.count - a.count || Number(isPlain(a.name)) - Number(isPlain(b.name)) || a.name.localeCompare(b.name))[0];
        return { suggested: cleanCategory(best.name)!, variants };
      });
    return { items, duplicates };
  }

  /** Gabungkan/ganti nama kategori: semua produk dengan kategori di `from` dipindah ke `to` (kosong = tanpa kategori) */
  async mergeCategories(tenantId: string, dto: MergeCategoriesDto) {
    const from = [...new Set(dto.from)];
    let to = cleanCategory(dto.to);
    if (to) {
      // sama (tanpa membedakan huruf) dengan kategori lain yang tetap ada: pakai ejaan yang ada
      const spell = await categorySpellings(this.db, tenantId);
      for (const f of from) if (cleanCategory(f)?.toLowerCase() === to.toLowerCase()) spell.delete(to.toLowerCase());
      const existing = [...spell.entries()].find(([k]) => k === to!.toLowerCase());
      if (existing && !from.includes(existing[1])) to = existing[1];
    }
    const list = sql.join(from.map((f) => sql`${f}`), sql`, `);
    const cond = sql`tenant_id = ${tenantId} AND category IN (${list}) AND category IS DISTINCT FROM ${to}::text`;
    if (dto.dryRun) {
      const c = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM products WHERE ${cond}`);
      return { updated: c.rows[0].n, to, dryRun: true };
    }
    const u = await this.db.execute<{ id: string }>(sql`UPDATE products SET category = ${to}::text WHERE ${cond} RETURNING id`);
    return { updated: u.rows.length, to, dryRun: false };
  }

  private async assertSemiAllowed(tenantId: string) {
    if (!isProductionModel(await this.settings.businessModel(this.db, tenantId))) {
      throw new BadRequestException('Barang setengah jadi hanya untuk jenis usaha Produksi atau Manufaktur');
    }
  }

  /**
   * Peran produk dalam produksi (otomatis dari resep, tanpa input tambahan):
   * RAW = dipakai sebagai bahan di resep; SEMI = barang setengah jadi; FINISHED = hasil sebuah resep (produk jadi);
   * TRADING = belum terkait resep (barang dagang / belum dipakai produksi).
   */
  private async roles(tenantId: string): Promise<{ material: Set<string>; output: Set<string> }> {
    const mat = await this.db.execute<{ id: string }>(sql`SELECT DISTINCT l.product_id AS id FROM bom_lines l JOIN boms b ON b.id = l.bom_id WHERE b.tenant_id = ${tenantId}`);
    const out = await this.db.execute<{ id: string }>(sql`SELECT DISTINCT product_id AS id FROM boms WHERE tenant_id = ${tenantId}`);
    return { material: new Set(mat.rows.map((r) => r.id)), output: new Set(out.rows.map((r) => r.id)) };
  }

  private withRole<T extends { id: string; inventoryKind?: string | null }>(p: T, r: { material: Set<string>; output: Set<string> }) {
    const role = p.inventoryKind === 'SEMI' ? 'SEMI' : r.output.has(p.id) ? 'FINISHED' : r.material.has(p.id) ? 'RAW' : 'TRADING';
    return { ...p, role } as T & { role: 'RAW' | 'SEMI' | 'FINISHED' | 'TRADING' };
  }

  async list(tenantId: string, q?: string) {
    const rows = await this.db.query.products.findMany({
      where: and(
        eq(products.tenantId, tenantId),
        q ? or(ilike(products.sku, `%${q}%`), ilike(products.name, `%${q}%`)) : undefined,
      ),
      with: { uoms: true },
      orderBy: [asc(products.sku)],
      limit: 500,
    });
    const r = await this.roles(tenantId);
    return rows.map((p) => this.withRole(p, r));
  }

  async get(tenantId: string, id: string) {
    const p = await this.db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
      with: { uoms: true },
    });
    if (!p) throw new NotFoundException('Produk tidak ditemukan');
    return p;
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const baseUom = dto.baseUom ?? 'PCS';
    this.validateUoms(baseUom, dto.uoms);
    if (dto.madeToOrder && dto.inventoryKind === 'SEMI') throw new BadRequestException('Barang setengah jadi tidak bisa menjadi menu yang dijual di kasir');
    if (dto.inventoryKind === 'SEMI') await this.assertSemiAllowed(tenantId);
    const id = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({
          tenantId,
          sku: dto.sku.trim().toUpperCase(),
          name: dto.name.trim(),
          category: await canonicalCategory(tx, tenantId, dto.category),
          baseUom,
          sellPrice: dto.sellPrice,
          barcode: dto.barcode?.trim() || null,
          inventoryKind: dto.inventoryKind ?? 'GOODS',
          madeToOrder: dto.madeToOrder ?? false,
          shelfLifeDays: dto.shelfLifeDays ?? null,
        })
        .returning({ id: products.id });
      if (dto.uoms?.length) {
        await tx.insert(productUoms).values(dto.uoms.map((u) => ({ productId: p.id, uom: u.uom, factor: u.factor })));
      }
      return p.id;
    });
    return this.get(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const current = await this.get(tenantId, id);
    const baseUom = dto.baseUom ?? current.baseUom;
    if (dto.uoms) this.validateUoms(baseUom, dto.uoms);
    if ((dto.madeToOrder ?? current.madeToOrder) && (dto.inventoryKind ?? current.inventoryKind) === 'SEMI') throw new BadRequestException('Barang setengah jadi tidak bisa menjadi menu yang dijual di kasir');
    if (dto.inventoryKind !== undefined && dto.inventoryKind !== current.inventoryKind) {
      if (dto.inventoryKind === 'SEMI') await this.assertSemiAllowed(tenantId);
      // riwayat jurnal persediaan mengikuti jenis barang saat bergerak; jenisnya tidak boleh berubah setelah ada mutasi stok
      const moves = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM stock_moves WHERE tenant_id = ${tenantId} AND product_id = ${id}`);
      if (moves.rows[0].n > 0) throw new BadRequestException('Jenis barang tidak bisa diubah karena sudah memiliki mutasi stok');
    }

    await this.db.transaction(async (tx) => {
      if (dto.uoms) {
        await tx.delete(productUoms).where(eq(productUoms.productId, id));
        if (dto.uoms.length) {
          await tx.insert(productUoms).values(dto.uoms.map((u) => ({ productId: id, uom: u.uom, factor: u.factor })));
        }
      }
      await tx
        .update(products)
        .set({
          sku: dto.sku?.trim().toUpperCase(),
          name: dto.name?.trim(),
          category: dto.category === undefined ? undefined : await canonicalCategory(tx, tenantId, dto.category),
          baseUom: dto.baseUom,
          sellPrice: dto.sellPrice,
          barcode: dto.barcode === undefined ? undefined : dto.barcode.trim() || null,
          inventoryKind: dto.inventoryKind,
          madeToOrder: dto.madeToOrder,
          shelfLifeDays: dto.shelfLifeDays,
          isActive: dto.isActive,
        })
        .where(eq(products.id, id));
    });
    return this.get(tenantId, id);
  }

  private validateUoms(baseUom: string, uoms?: ProductUomDto[]) {
    if (!uoms) return;
    const seen = new Set<string>();
    for (const u of uoms) {
      if (u.uom === baseUom) throw new BadRequestException(`Satuan ${u.uom} sama dengan satuan dasar`);
      if (seen.has(u.uom)) throw new BadRequestException(`Satuan ${u.uom} duplikat`);
      if (D(u.factor).lte(0)) throw new BadRequestException(`Faktor satuan ${u.uom} harus > 0`);
      seen.add(u.uom);
    }
  }
}
