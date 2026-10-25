import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { INTERNAL_BARCODE_PREFIX, internalBarcode, isKnownUom, isProductionModel, isValidBarcode, PRODUCT_FORM, uomLabel, type BusinessModel } from '@sansu/shared';
import { SettingsService } from '../../../common/settings.service';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { D } from '../../../common/utils/money';
import { Db, DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { products } from '../../../db/schema';
import { canonicalCategory, categorySpellings, cleanCategory, isPlain } from './category';
import { AddCategoryDto, CreateProductDto, MergeCategoriesDto, ProductUomDto, UpdateProductDto } from './products.dto';
import { patchById } from '../../../db/owned';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly repo: ProductsRepository,
  ) {}

  /** Kategori tambahan yang didaftarkan Admin (di luar daftar bawaan jenis usaha) */
  private async customCategories(tenantId: string): Promise<string[]> {
    return (await this.settings.section(this.db, tenantId, 'productCatalog', { list: [] as string[] })).list;
  }

  /**
   * Pilihan form produk untuk perusahaan ini: kategori (bawaan jenis usaha + tambahan Admin + yang sudah dipakai produk),
   * satuan dasar dan satuan bertingkat. Semua isian form produk dipilih dari daftar ini — tidak ada ketik bebas.
   */
  async options(tenantId: string) {
    const model: BusinessModel = await this.settings.businessModel(this.db, tenantId);
    const profile = PRODUCT_FORM[model];
    const used = await this.repo.queryProduct(this.db, tenantId);
    const seen = new Set<string>();
    const categories: { value: string; source: 'PRESET' | 'CUSTOM' | 'USED' }[] = [];
    const add = (v: string | null, source: 'PRESET' | 'CUSTOM' | 'USED') => {
      const c = cleanCategory(v);
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        categories.push({ value: c, source });
      }
    };
    profile.categories.forEach((c) => add(c, 'PRESET'));
    (await this.customCategories(tenantId)).forEach((c) => add(c, 'CUSTOM'));
    used.rows.forEach((r) => add(r.category, 'USED'));
    const legacyUoms = [...new Set(used.rows.map((r) => r.uom).filter((u): u is string => !!u && !isKnownUom(u)))];
    return {
      model,
      form: { barcode: profile.barcode, packs: profile.packs, menu: profile.menu, semi: profile.semi, shelfLife: profile.shelfLife, skuLabel: profile.skuLabel, nameLabel: profile.nameLabel, baseUomLabel: profile.baseUomLabel, priceLabel: profile.priceLabel, note: profile.note },
      categories,
      baseUoms: [...profile.baseUoms, ...legacyUoms].map((u) => ({ value: u, label: u === uomLabel(u) ? u : `${u} — ${uomLabel(u)}` })),
      packUoms: [...profile.packUoms, ...legacyUoms].map((u) => ({ value: u, label: u === uomLabel(u) ? u : `${u} — ${uomLabel(u)}` })),
    };
  }

  /** Tambah kategori baru ke daftar pilihan (Admin) */
  async addCategory(tenantId: string, dto: AddCategoryDto) {
    const name = cleanCategory(dto.name);
    if (!name) throw new BadRequestException('Nama kategori kosong');
    const opts = await this.options(tenantId);
    const same = opts.categories.find((c) => c.value.toLowerCase() === name.toLowerCase());
    if (same) throw new BadRequestException(`Kategori "${same.value}" sudah ada`);
    const list = await this.customCategories(tenantId);
    await this.settings.saveSection(this.db, tenantId, 'productCatalog', { list: [] as string[] }, { list: [...list, name] });
    return { name };
  }

  /** Semua pilihan form harus dari daftar: kategori, satuan dasar, satuan bertingkat, serta bidang yang sesuai jenis usaha */
  private async assertChoices(tenantId: string, dto: Partial<CreateProductDto>, current?: { category: string | null; baseUom: string; uoms: { uom: string }[]; madeToOrder: boolean; shelfLifeDays: number | null }) {
    const opts = await this.options(tenantId);
    const profile = PRODUCT_FORM[opts.model];
    if (dto.category !== undefined) {
      const c = cleanCategory(dto.category);
      if (c && c.toLowerCase() !== (current?.category ?? '').toLowerCase() && !opts.categories.some((o) => o.value.toLowerCase() === c.toLowerCase())) {
        throw new BadRequestException(`Kategori "${c}" tidak ada di daftar. Pilih kategori yang tersedia, atau minta Admin menambahkannya di Kelola kategori.`);
      }
      // ejaan baku dari daftar pilihan
      const listed = c ? opts.categories.find((o) => o.value.toLowerCase() === c.toLowerCase()) : undefined;
      if (listed) dto.category = listed.value;
    }
    const okUom = (u: string, was?: string[]) => isKnownUom(u) || (was ?? []).includes(u) || opts.baseUoms.some((o) => o.value === u);
    if (dto.baseUom !== undefined && dto.baseUom !== current?.baseUom && !okUom(dto.baseUom)) throw new BadRequestException(`Satuan "${dto.baseUom}" tidak ada di daftar satuan. Pilih dari daftar.`);
    for (const u of dto.uoms ?? []) {
      if (!okUom(u.uom, (current?.uoms ?? []).map((x) => x.uom))) throw new BadRequestException(`Satuan "${u.uom}" tidak ada di daftar satuan. Pilih dari daftar.`);
    }
    if (dto.uoms?.length && !profile.packs) throw new BadRequestException('Jenis usaha ini tidak memakai satuan bertingkat');
    if (dto.madeToOrder && !current?.madeToOrder && !profile.menu) throw new BadRequestException('Menu (dibuat saat dipesan) hanya untuk jenis usaha F&B');
    if (dto.shelfLifeDays != null && dto.shelfLifeDays !== current?.shelfLifeDays && !profile.shelfLife) throw new BadRequestException('Umur simpan hanya untuk jenis usaha yang memproduksi (Manufaktur, F&B)');
    if (dto.barcode && !profile.barcode) throw new BadRequestException('Jenis usaha ini tidak memakai barcode');
    if (dto.barcode) {
      const code = dto.barcode.trim();
      if (!isValidBarcode(code)) throw new BadRequestException('Barcode pabrikan tidak valid: harus hasil scan (EAN-13, EAN-8, atau UPC-A dengan angka pemeriksa benar). Kosongkan untuk dibuatkan otomatis.');
      if (code.startsWith(INTERNAL_BARCODE_PREFIX)) throw new BadRequestException('Barcode berawalan 2 dicadangkan untuk barcode otomatis sistem');
    }
  }

  /** Nomor urut barcode internal berikutnya untuk perusahaan ini (aman dari balapan dua pembuatan sekaligus) */
  private async nextInternalBarcode(tx: DbOrTx, tenantId: string) {
    await this.repo.queryNextInternalBarcode(tx, tenantId);
    const r = await this.repo.queryProductForNextInternalBarcode(tx, tenantId);
    return internalBarcode(Number(r.rows[0].n));
  }

  /**
   * Barcode final sebuah produk: dibuat otomatis bila jenis usaha memakai barcode dan belum ada; barcode pabrikan (hasil scan)
   * hanya bila diberikan. Barcode otomatis tidak bisa diubah; menggantinya dengan barcode pabrikan hanya sebelum ada mutasi stok.
   */
  private async resolveBarcode(tx: DbOrTx, tenantId: string, given: string | undefined, current?: { id: string; barcode: string | null; barcodeSource: 'GENERATED' | 'MANUFACTURER' | null }): Promise<{ barcode: string | null; barcodeSource: 'GENERATED' | 'MANUFACTURER' | null }> {
    const model = await this.settings.businessModel(tx, tenantId);
    if (!PRODUCT_FORM[model].barcode) return { barcode: null, barcodeSource: null };
    const code = given?.trim();
    if (current?.barcode && (code === undefined || code === current.barcode)) return { barcode: current.barcode, barcodeSource: current.barcodeSource };
    if (code) {
      if (current?.barcodeSource === 'GENERATED') {
        const moves = await this.repo.queryStockMove(tx, tenantId, current.id);
        if (moves.rows[0].n > 0) throw new BadRequestException('Barcode otomatis tidak bisa diganti karena produk sudah punya mutasi stok');
      }
      return { barcode: code, barcodeSource: 'MANUFACTURER' };
    }
    if (current?.barcodeSource === 'GENERATED') return { barcode: current.barcode, barcodeSource: 'GENERATED' };
    return { barcode: await this.nextInternalBarcode(tx, tenantId), barcodeSource: 'GENERATED' };
  }

  /** Buatkan barcode otomatis untuk semua produk aktif yang belum punya (Admin) */
  async generateMissingBarcodes(tenantId: string) {
    return this.db.transaction(async (tx) => {
      const model = await this.settings.businessModel(tx, tenantId);
      if (!PRODUCT_FORM[model].barcode) throw new BadRequestException('Jenis usaha ini tidak memakai barcode');
      const rows = await this.repo.queryProductForGenerateMissingBarcodes(tx, tenantId);
      for (const r of rows.rows) {
        const barcode = await this.nextInternalBarcode(tx, tenantId);
        await this.repo.queryGenerateMissingBarcodes(tx, barcode, r.id);
      }
      return { generated: rows.rows.length };
    });
  }

  /** Daftar kategori beserta jumlah produknya, dan kelompok ejaan ganda (beda huruf besar/kecil atau spasi) yang bisa disatukan */
  async categories(tenantId: string) {
    const r = await this.repo.queryProductForCategories(this.db, tenantId);
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
      const c = await this.repo.queryProductForMergeCategories(this.db, cond);
      return { updated: c.rows[0].n, to, dryRun: true };
    }
    const u = await this.repo.queryMergeCategories(this.db, to, cond);
    if (to) {
      const opts = await this.options(tenantId);
      if (!opts.categories.some((c) => c.value.toLowerCase() === to!.toLowerCase())) await this.addCategory(tenantId, { name: to });
    }
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
    const mat = await this.repo.queryBomLine(this.db, tenantId);
    const out = await this.repo.queryBom(this.db, tenantId);
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

  async create(tenantId: string, dto: CreateProductDto, strict = false) {
    if (strict) await this.assertChoices(tenantId, dto);
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
          ...(await this.resolveBarcode(tx, tenantId, dto.barcode)),
          inventoryKind: dto.inventoryKind ?? 'GOODS',
          madeToOrder: dto.madeToOrder ?? false,
          shelfLifeDays: dto.shelfLifeDays ?? null,
          weightKg: dto.weightKg ?? null,
        })
        .returning({ id: products.id });
      if (dto.uoms?.length) {
        await this.repo.insertProductUoms(tx, dto.uoms, p.id);
      }
      return p.id;
    });
    return this.get(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto, strict = false) {
    const current = await this.get(tenantId, id);
    if (strict) await this.assertChoices(tenantId, dto, current);
    const baseUom = dto.baseUom ?? current.baseUom;
    if (dto.uoms) this.validateUoms(baseUom, dto.uoms);
    if ((dto.madeToOrder ?? current.madeToOrder) && (dto.inventoryKind ?? current.inventoryKind) === 'SEMI') throw new BadRequestException('Barang setengah jadi tidak bisa menjadi menu yang dijual di kasir');
    if (dto.inventoryKind !== undefined && dto.inventoryKind !== current.inventoryKind) {
      if (dto.inventoryKind === 'SEMI') await this.assertSemiAllowed(tenantId);
      // riwayat jurnal persediaan mengikuti jenis barang saat bergerak; jenisnya tidak boleh berubah setelah ada mutasi stok
      const moves = await this.repo.queryStockMove(this.db, tenantId, id);
      if (moves.rows[0].n > 0) throw new BadRequestException('Jenis barang tidak bisa diubah karena sudah memiliki mutasi stok');
    }

    await this.db.transaction(async (tx) => {
      if (dto.uoms) {
        await this.repo.deleteProductUomsByProductId(tx, id);
        if (dto.uoms.length) {
          await this.repo.insertProductUoms(tx, dto.uoms, id);
        }
      }
      await patchById(tx, products, id, {
          sku: dto.sku?.trim().toUpperCase(),
          name: dto.name?.trim(),
          category: dto.category === undefined ? undefined : await canonicalCategory(tx, tenantId, dto.category),
          baseUom: dto.baseUom,
          sellPrice: dto.sellPrice,
          ...(dto.barcode === undefined ? {} : await this.resolveBarcode(tx, tenantId, dto.barcode.trim() || undefined, { id, barcode: current.barcode, barcodeSource: current.barcodeSource })),
          inventoryKind: dto.inventoryKind,
          madeToOrder: dto.madeToOrder,
          shelfLifeDays: dto.shelfLifeDays,
          weightKg: dto.weightKg,
          isActive: dto.isActive,
        });
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
