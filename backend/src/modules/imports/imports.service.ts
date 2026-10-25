import { INTERNAL_BARCODE_PREFIX, isValidBarcode } from '@sansu/shared';
import { categorySpellings, cleanCategory } from '../master-data/products/category';
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { products } from '../../db/schema';
import { AssetsService } from '../assets/assets.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { blank, date, text } from './parse';
import { ImportDto } from './imports.dto';
import { chunks, MAX, type Plan, type Row, type RowResult, rowChecker, upper } from './imports.shared';
import { ImportsRepository } from './imports.repository';
import { OpeningImportsService } from './opening-imports.service';

@Injectable()
export class ImportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly assetsSvc: AssetsService,
    private readonly repo: ImportsRepository,
    private readonly opening: OpeningImportsService,
  ) {}

  async run(user: AuthUser, dto: ImportDto) {
    const needsDate = ['stock', 'receivables', 'payables', 'accounts', 'assets'].includes(dto.kind);
    if (needsDate && !dto.date) throw new BadRequestException('Isi tanggal saldo awal');
    const plan = await this.plan(user, dto);
    const errors = plan.results.filter((r) => r.action === 'ERROR').length;
    const summary = {
      total: plan.results.length,
      create: plan.results.filter((r) => r.action === 'CREATE').length,
      update: plan.results.filter((r) => r.action === 'UPDATE').length,
      errors,
      warnings: plan.results.filter((r) => r.warnings.length).length,
    };
    if (dto.dryRun !== false) return { dryRun: true, summary, results: plan.results };
    if (errors)
      throw new BadRequestException({
        message: `${errors} baris masih bermasalah — perbaiki dulu, tidak ada data yang disimpan`,
        summary,
        results: plan.results,
      });

    await this.db.transaction(async (tx) => {
      await plan.write(tx);
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'IMPORT',
        entity: 'Import',
        entityId: randomUUID(),
        data: { kind: dto.kind, date: dto.date, ...summary },
      });
    });
    return { dryRun: false, summary, results: plan.results };
  }

  private plan(user: AuthUser, dto: ImportDto): Promise<Plan> {
    switch (dto.kind) {
      case 'products':
        return this.products(user, dto.rows);
      case 'customers':
        return this.parties(user, dto.rows, 'customers');
      case 'suppliers':
        return this.parties(user, dto.rows, 'suppliers');
      case 'stock':
        return this.opening.stock(user, dto);
      case 'receivables':
        return this.opening.openItems(user, dto, 'receivables');
      case 'payables':
        return this.opening.openItems(user, dto, 'payables');
      case 'accounts':
        return this.opening.accountBalances(user, dto);
      case 'assets':
        return this.opening.existingAssets(user, dto);
    }
  }

  private async products(user: AuthUser, rows: Row[]): Promise<Plan> {
    const existing = await this.repo.listProducts(this.db, user.tenantId);
    const bySku = new Map(existing.map((p) => [p.sku.toUpperCase(), p]));
    // produk yang pernah punya catatan stok: satuan dasarnya tidak boleh berubah (qty & HPP lama jadi salah arti)
    const withStock = new Set((await this.repo.listStockBalances(this.db, user.tenantId)).map((x) => x.id));
    const barcodeOwner = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p.sku.toUpperCase()]));
    const seenSku = new Set<string>();
    const seenBarcode = new Map<string, string>();
    const results: RowResult[] = [];
    type W = {
      id?: string;
      sku: string;
      name?: string;
      category?: string | null;
      baseUom?: string;
      sellPrice?: string;
      barcode?: string | null;
      uoms?: { uom: string; factor: string }[];
    };
    const writes: W[] = [];

    rows.forEach((row, i) => {
      const sku = upper(text(row.sku));
      const { r, req, max, amount } = rowChecker(results, i, sku ?? '');
      req(row.sku, 'SKU');
      max(sku, MAX.sku, 'SKU');
      const name = max(text(row.nama), MAX.name, 'Nama');
      const cur = sku ? bySku.get(sku) : undefined;
      if (!cur) req(row.nama, 'Nama');
      if (sku) {
        if (seenSku.has(sku)) r.errors.push('SKU muncul lebih dari sekali di file');
        seenSku.add(sku);
      }
      const baseUom = upper(text(row.satuan));
      if (baseUom && !/^[A-Z0-9]{1,10}$/.test(baseUom))
        r.errors.push('Satuan hanya huruf/angka tanpa spasi, maks. 10 (mis. PCS)');
      else if (cur && baseUom && baseUom !== cur.baseUom.toUpperCase() && withStock.has(cur.id))
        r.errors.push(
          `Satuan dasar produk yang sudah punya stok tidak boleh diubah lewat impor (sekarang ${cur.baseUom.toUpperCase()}). Kosongkan kolom satuan atau samakan.`,
        );
      const price = amount(row.harga_jual, 'Harga jual', { required: !cur, min: 0 });
      const barcode = text(row.barcode);
      if (barcode) {
        max(barcode, 40, 'Barcode');
        if (!isValidBarcode(barcode))
          r.errors.push(
            'Barcode pabrikan tidak valid (harus EAN-13/EAN-8/UPC-A dengan angka pemeriksa benar). Kosongkan kolom untuk dibuatkan otomatis di menu Produk',
          );
        else if (barcode.startsWith(INTERNAL_BARCODE_PREFIX))
          r.errors.push('Barcode berawalan 2 dicadangkan untuk barcode otomatis sistem');
        const owner = barcodeOwner.get(barcode);
        if (owner && owner !== sku) r.errors.push(`Barcode sudah dipakai produk ${owner}`);
        const inFile = seenBarcode.get(barcode);
        if (inFile && inFile !== sku) r.errors.push(`Barcode sama dengan produk ${inFile} di file`);
        seenBarcode.set(barcode, sku ?? '');
      }
      // satuan bertingkat (opsional)
      let uoms: W['uoms'];
      const pairs = [
        [row.satuan2, row.isi2],
        [row.satuan3, row.isi3],
      ];
      if (pairs.some(([u, f]) => !blank(u) || !blank(f))) {
        uoms = [];
        for (const [u, f] of pairs) {
          if (blank(u) && blank(f)) continue;
          const uom = upper(text(u));
          const factor = amount(f, `Isi ${uom ?? 'satuan'}`, { positive: true });
          if (!uom || !/^[A-Z0-9]{1,10}$/.test(uom)) r.errors.push('Nama satuan besar tidak valid (mis. DUS)');
          else if (uom === (baseUom ?? 'PCS')) r.errors.push(`Satuan ${uom} sama dengan satuan dasar`);
          else if (uoms.some((x) => x.uom === uom)) r.errors.push(`Satuan ${uom} dobel`);
          if (factor && factor.lte(1)) r.errors.push(`Isi ${uom} harus lebih dari 1 satuan dasar`);
          if (uom && factor) uoms.push({ uom, factor: factor.toString() });
        }
      }
      if (cur) r.action = 'UPDATE';
      if (r.errors.length) {
        r.action = 'ERROR';
        return;
      }
      writes.push({
        id: cur?.id,
        sku: sku!,
        name,
        category: text(row.kategori),
        baseUom,
        sellPrice: price?.toFixed(2),
        barcode: barcode ?? undefined,
        uoms,
      });
    });

    return {
      results,
      write: async (tx) => {
        // kategori disamakan dengan ejaan baku yang sudah ada (dan antar baris file ini)
        const spell = await categorySpellings(tx, user.tenantId);
        for (const w of writes) {
          const c = cleanCategory(w.category);
          if (!c) w.category = null;
          else w.category = spell.get(c.toLowerCase()) ?? (spell.set(c.toLowerCase(), c), c);
        }
        // produk baru: sisipkan bertumpuk (500 per kueri) — cepat untuk ribuan baris
        const creates = writes.filter((w) => !w.id);
        const idBySku = new Map<string, string>();
        for (const chunk of chunks(creates, 500)) {
          const ins = await this.repo.insertProducts(
            tx,
            chunk.map((w) => ({
              tenantId: user.tenantId,
              sku: w.sku,
              name: w.name!,
              category: w.category,
              baseUom: w.baseUom ?? 'PCS',
              sellPrice: w.sellPrice ?? '0',
              barcode: w.barcode ?? null,
              barcodeSource: w.barcode ? ('MANUFACTURER' as const) : null,
            })),
          );
          for (const r of ins) idBySku.set(r.sku, r.id);
        }
        for (const w of writes.filter((x) => x.id)) {
          await this.repo.updateProduct(tx, user.tenantId, w.id!, {
            name: w.name,
            category: w.category,
            baseUom: w.baseUom,
            sellPrice: w.sellPrice,
            barcode: w.barcode,
            ...(w.barcode ? { barcodeSource: 'MANUFACTURER' as const } : {}),
          });
        }
        // satuan bertingkat
        const withUoms = writes.filter((w) => w.uoms);
        const ids = withUoms.map((w) => w.id ?? idBySku.get(w.sku)!);
        for (const chunk of chunks(
          ids.filter((_, i) => withUoms[i].id),
          500,
        ))
          await this.repo.deleteProductUomsByProductId(tx, chunk);
        const uomRows = withUoms.flatMap((w, i) => w.uoms!.map((u) => ({ productId: ids[i], ...u })));
        for (const chunk of chunks(uomRows, 1000)) await this.repo.insertProductUoms(tx, chunk);
      },
    };
  }

  private async parties(user: AuthUser, rows: Row[], kind: 'customers' | 'suppliers'): Promise<Plan> {
    const existing = await this.repo.listPartyCodes(this.db, user.tenantId, kind);
    const byCode = new Map(existing.map((x) => [x.code.toUpperCase(), x]));
    const seen = new Set<string>();
    const results: RowResult[] = [];
    type W = {
      id?: string;
      code: string;
      name?: string;
      phone?: string;
      address?: string;
      npwp?: string;
      creditLimit?: string;
      paymentTermDays?: number;
    };
    const writes: W[] = [];

    rows.forEach((row, i) => {
      const code = text(row.kode);
      const { r, req, max, amount } = rowChecker(results, i, code ?? '');
      req(row.kode, 'Kode');
      max(code, MAX.code, 'Kode');
      const cur = code ? byCode.get(code.toUpperCase()) : undefined;
      if (!cur) req(row.nama, 'Nama');
      const name = max(text(row.nama), MAX.name, 'Nama');
      if (code) {
        if (seen.has(code.toUpperCase())) r.errors.push('Kode muncul lebih dari sekali di file');
        seen.add(code.toUpperCase());
      }
      const term = amount(row.termin_hari, 'Termin (hari)', { min: 0 });
      if (term && (!term.isInteger() || term.gt(365))) r.errors.push('Termin harus bilangan bulat 0–365 hari');
      const limit = kind === 'customers' ? amount(row.limit_kredit, 'Limit kredit', { min: 0 }) : undefined;
      const npwp = text(row.npwp);
      if (npwp) {
        const digits = npwp.replace(/\D/g, '');
        if (![15, 16].includes(digits.length))
          r.warnings.push('NPWP/NIK sebaiknya 15 atau 16 digit (dipakai untuk e-Faktur)');
      }
      if (cur) r.action = 'UPDATE';
      if (r.errors.length) {
        r.action = 'ERROR';
        return;
      }
      writes.push({
        id: cur?.id,
        code: code!,
        name,
        phone: text(row.telepon),
        address: text(row.alamat),
        npwp,
        creditLimit: limit?.toFixed(2),
        paymentTermDays: term ? term.toNumber() : undefined,
      });
    });

    return {
      results,
      write: async (tx) => {
        const strip = (w: W) => {
          const { id: _id, ...v } = w;
          return kind === 'customers' ? v : { ...v, creditLimit: undefined };
        };
        for (const w of writes.filter((x) => x.id)) {
          await this.repo.updateParty(tx, kind, user.tenantId, w.id!, { ...strip(w), code: undefined });
        }
        // baru: sisipkan bertumpuk
        for (const chunk of chunks(
          writes.filter((x) => !x.id),
          500,
        )) {
          await this.repo.insertParties(
            tx,
            kind,
            chunk.map((w) => ({ ...strip(w), name: w.name!, tenantId: user.tenantId })),
          );
        }
      },
    };
  }
}
