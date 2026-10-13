/**
 * Impor data awal dari Excel / CSV — untuk perusahaan yang pindah dari sistem lain.
 *
 * Alur: frontend membaca file & memetakan kolom → POST /imports dengan dryRun=true (pratinjau: setiap baris
 * diperiksa, tanpa menulis apa pun) → POST /imports dengan dryRun=false (semua baris ditulis dalam SATU
 * transaksi: berhasil semua atau tidak sama sekali).
 *
 * Jenis: produk, pelanggan, supplier (tambah / perbarui berdasarkan kode), stok awal, piutang awal per faktur,
 * utang awal per faktur, saldo awal akun, aset tetap lama (tanpa jurnal). Semua saldo awal berlawanan dengan akun Ekuitas Saldo Awal.
 */
import { BadRequestException, Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, toDocDate } from '../../common/utils/dates';
import { Dec, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  accounts,
  customers,
  invoices,
  productUoms,
  products,
  purchaseInvoices,
  stockBalances,
  assetCategories,
  suppliers,
  warehouses,
} from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { frameworkOf } from '../accounting/coa-sync';
import { AssetsModule, AssetsService } from '../assets/assets.module';
import { AccountingService } from '../accounting/accounting.service';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { blank, date, num, text } from './parse';

export const IMPORT_KINDS = ['products', 'customers', 'suppliers', 'stock', 'receivables', 'payables', 'accounts', 'assets'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
type Row = Record<string, unknown>;

export class ImportDto {
  @ApiProperty({ enum: IMPORT_KINDS }) @IsIn(IMPORT_KINDS) kind: ImportKind;
  @ApiProperty({ description: 'Baris data; kunci = nama kolom templat (mis. sku, nama, harga_jual)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  rows: Row[];
  @ApiPropertyOptional({ description: 'Tanggal saldo awal (stok, piutang, utang, akun)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Gudang default untuk stok awal' }) @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

export interface RowResult {
  row: number; // nomor baris di Excel (baris 2 = data pertama)
  key: string;
  action: 'CREATE' | 'UPDATE' | 'ERROR';
  errors: string[];
  warnings: string[];
}

type Plan = { results: RowResult[]; write: (tx: Tx) => Promise<void> };

const MAX = { code: 30, sku: 40, name: 160, uom: 10 };
const upper = (s?: string) => s?.toUpperCase();
const rp = (d: Dec) => 'Rp ' + Number(d.toFixed(0)).toLocaleString('id-ID');

@Injectable()
export class ImportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly assetsSvc: AssetsService,
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
    if (errors) throw new BadRequestException({ message: `${errors} baris masih bermasalah — perbaiki dulu, tidak ada data yang disimpan`, summary, results: plan.results });

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
        return this.stock(user, dto);
      case 'receivables':
        return this.openItems(user, dto, 'receivables');
      case 'payables':
        return this.openItems(user, dto, 'payables');
      case 'accounts':
        return this.accountBalances(user, dto);
      case 'assets':
        return this.existingAssets(user, dto);
    }
  }

  /** Pemeriksa satu baris: kumpulkan error/peringatan, kembalikan hasil */
  private checker(results: RowResult[], i: number, key: string) {
    const r: RowResult = { row: i + 2, key, action: 'CREATE', errors: [], warnings: [] };
    results.push(r);
    const req = (v: unknown, label: string) => {
      const t = text(v);
      if (!t) r.errors.push(`${label} wajib diisi`);
      return t;
    };
    const max = (v: string | undefined, n: number, label: string) => {
      if (v && v.length > n) r.errors.push(`${label} maksimal ${n} karakter`);
      return v;
    };
    const amount = (v: unknown, label: string, opt: { required?: boolean; min?: number; positive?: boolean } = {}) => {
      const n = num(v);
      if (n === 'invalid') {
        r.errors.push(`${label} bukan angka: "${String(v)}"`);
        return undefined;
      }
      if (n === null) {
        if (opt.required) r.errors.push(`${label} wajib diisi`);
        return undefined;
      }
      if (opt.positive && !n.gt(0)) r.errors.push(`${label} harus lebih dari 0`);
      else if (opt.min !== undefined && n.lt(opt.min)) r.errors.push(`${label} tidak boleh negatif`);
      if (n.decimalPlaces() > 4) r.errors.push(`${label} terlalu banyak desimal`);
      return n;
    };
    const day = (v: unknown, label: string, required = false) => {
      const d = date(v);
      if (d === 'invalid') {
        r.errors.push(`${label} tidak dikenali: "${String(v)}" (pakai format 31/12/2025)`);
        return undefined;
      }
      if (d === null && required) r.errors.push(`${label} wajib diisi`);
      return d ?? undefined;
    };
    return { r, req, max, amount, day };
  }

  // ---------------------------------------------------------------- produk
  private async products(user: AuthUser, rows: Row[]): Promise<Plan> {
    const existing = await this.db
      .select({ id: products.id, sku: products.sku, barcode: products.barcode, baseUom: products.baseUom })
      .from(products)
      .where(eq(products.tenantId, user.tenantId));
    const bySku = new Map(existing.map((p) => [p.sku.toUpperCase(), p]));
    // produk yang pernah punya catatan stok: satuan dasarnya tidak boleh berubah (qty & HPP lama jadi salah arti)
    const withStock = new Set((await this.db.selectDistinct({ id: stockBalances.productId }).from(stockBalances).where(eq(stockBalances.tenantId, user.tenantId))).map((x) => x.id));
    const barcodeOwner = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p.sku.toUpperCase()]));
    const seenSku = new Set<string>();
    const seenBarcode = new Map<string, string>();
    const results: RowResult[] = [];
    type W = { id?: string; sku: string; name?: string; category?: string; baseUom?: string; sellPrice?: string; barcode?: string | null; uoms?: { uom: string; factor: string }[] };
    const writes: W[] = [];

    rows.forEach((row, i) => {
      const sku = upper(text(row.sku));
      const { r, req, max, amount } = this.checker(results, i, sku ?? '');
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
      if (baseUom && !/^[A-Z0-9]{1,10}$/.test(baseUom)) r.errors.push('Satuan hanya huruf/angka tanpa spasi, maks. 10 (mis. PCS)');
      else if (cur && baseUom && baseUom !== cur.baseUom.toUpperCase() && withStock.has(cur.id))
        r.errors.push(`Satuan dasar produk yang sudah punya stok tidak boleh diubah lewat impor (sekarang ${cur.baseUom.toUpperCase()}). Kosongkan kolom satuan atau samakan.`);
      const price = amount(row.harga_jual, 'Harga jual', { required: !cur, min: 0 });
      const barcode = text(row.barcode);
      if (barcode) {
        max(barcode, 40, 'Barcode');
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
      writes.push({ id: cur?.id, sku: sku!, name, category: text(row.kategori), baseUom, sellPrice: price?.toFixed(2), barcode: barcode ?? undefined, uoms });
    });

    return {
      results,
      write: async (tx) => {
        // produk baru: sisipkan bertumpuk (500 per kueri) — cepat untuk ribuan baris
        const creates = writes.filter((w) => !w.id);
        const idBySku = new Map<string, string>();
        for (const chunk of chunks(creates, 500)) {
          const ins = await tx
            .insert(products)
            .values(chunk.map((w) => ({ tenantId: user.tenantId, sku: w.sku, name: w.name!, category: w.category, baseUom: w.baseUom ?? 'PCS', sellPrice: w.sellPrice ?? '0', barcode: w.barcode ?? null })))
            .returning({ id: products.id, sku: products.sku });
          for (const r of ins) idBySku.set(r.sku, r.id);
        }
        for (const w of writes.filter((x) => x.id)) {
          await tx
            .update(products)
            .set({ name: w.name, category: w.category, baseUom: w.baseUom, sellPrice: w.sellPrice, barcode: w.barcode })
            .where(and(eq(products.id, w.id!), eq(products.tenantId, user.tenantId)));
        }
        // satuan bertingkat
        const withUoms = writes.filter((w) => w.uoms);
        const ids = withUoms.map((w) => w.id ?? idBySku.get(w.sku)!);
        for (const chunk of chunks(ids.filter((_, i) => withUoms[i].id), 500)) await tx.delete(productUoms).where(inArray(productUoms.productId, chunk));
        const uomRows = withUoms.flatMap((w, i) => w.uoms!.map((u) => ({ productId: ids[i], ...u })));
        for (const chunk of chunks(uomRows, 1000)) await tx.insert(productUoms).values(chunk);
      },
    };
  }

  // ---------------------------------------------------------------- pelanggan & supplier
  private async parties(user: AuthUser, rows: Row[], kind: 'customers' | 'suppliers'): Promise<Plan> {
    const table = kind === 'customers' ? customers : suppliers;
    const existing = await this.db.select({ id: table.id, code: table.code }).from(table).where(eq(table.tenantId, user.tenantId));
    const byCode = new Map(existing.map((x) => [x.code.toUpperCase(), x]));
    const seen = new Set<string>();
    const results: RowResult[] = [];
    type W = { id?: string; code: string; name?: string; phone?: string; address?: string; npwp?: string; creditLimit?: string; paymentTermDays?: number };
    const writes: W[] = [];

    rows.forEach((row, i) => {
      const code = text(row.kode);
      const { r, req, max, amount } = this.checker(results, i, code ?? '');
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
        if (![15, 16].includes(digits.length)) r.warnings.push('NPWP/NIK sebaiknya 15 atau 16 digit (dipakai untuk e-Faktur)');
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
          await tx.update(table).set({ ...strip(w), code: undefined }).where(and(eq(table.id, w.id!), eq(table.tenantId, user.tenantId)));
        }
        // baru: sisipkan bertumpuk
        for (const chunk of chunks(writes.filter((x) => !x.id), 500)) {
          await tx.insert(table).values(chunk.map((w) => ({ ...strip(w), name: w.name!, tenantId: user.tenantId })) as never);
        }
      },
    };
  }

  // ---------------------------------------------------------------- stok awal
  private async stock(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const prods = await this.db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.tenantId, user.tenantId));
    const bySku = new Map(prods.map((p) => [p.sku.toUpperCase(), p.id]));
    const whs = await this.db.select().from(warehouses).where(eq(warehouses.tenantId, user.tenantId));
    const byWh = new Map<string, string>();
    for (const w of whs) {
      byWh.set(w.code.toUpperCase(), w.id);
      byWh.set(w.name.toUpperCase(), w.id);
    }
    const defaultWh = dto.warehouseId ?? whs[0]?.id;
    if (dto.warehouseId && !whs.some((w) => w.id === dto.warehouseId)) throw new BadRequestException('Gudang tidak ditemukan');
    const stocked = new Set(
      (
        await this.db
          .select({ p: stockBalances.productId, w: stockBalances.warehouseId })
          .from(stockBalances)
          .where(and(eq(stockBalances.tenantId, user.tenantId), sql`${stockBalances.qty} <> 0`))
      ).map((x) => `${x.p}|${x.w}`),
    );
    const seen = new Set<string>();
    const results: RowResult[] = [];
    const groups = new Map<string, { productId: string; qty: string; unitCost: string }[]>();

    dto.rows.forEach((row, i) => {
      const sku = upper(text(row.sku));
      const { r, req, amount } = this.checker(results, i, sku ?? '');
      req(row.sku, 'SKU');
      const productId = sku ? bySku.get(sku) : undefined;
      if (sku && !productId) r.errors.push(`Produk ${sku} belum ada — impor daftar produk dulu`);
      const whText = text(row.gudang);
      const warehouseId = whText ? byWh.get(whText.toUpperCase()) : defaultWh;
      if (!warehouseId) r.errors.push(whText ? `Gudang "${whText}" tidak ditemukan` : 'Gudang belum ada');
      const qty = amount(row.qty, 'Qty', { required: true, positive: true });
      const cost = amount(row.harga_pokok, 'Harga pokok', { required: true, min: 0 });
      if (cost?.isZero()) r.warnings.push('Harga pokok 0 — nilai persediaan & HPP akan nol');
      const k = `${productId}|${warehouseId}`;
      if (productId && warehouseId) {
        if (seen.has(k)) r.errors.push('Produk & gudang yang sama muncul lebih dari sekali');
        seen.add(k);
        if (stocked.has(k)) r.warnings.push('Produk ini sudah punya stok di gudang tsb — qty akan DITAMBAHKAN');
      }
      if (r.errors.length) {
        r.action = 'ERROR';
        return;
      }
      const list = groups.get(warehouseId!) ?? [];
      list.push({ productId: productId!, qty: qty!.toString(), unitCost: cost!.toString() });
      groups.set(warehouseId!, list);
    });

    return {
      results,
      write: async (tx) => {
        for (const [warehouseId, lines] of groups) {
          await this.inventory.adjust(user, { warehouseId, reason: 'OPENING', date: dto.date!, notes: 'Impor saldo awal', lines }, tx);
        }
      },
    };
  }

  // ---------------------------------------------------------------- piutang / utang awal per faktur
  private async openItems(user: AuthUser, dto: ImportDto, kind: 'receivables' | 'payables'): Promise<Plan> {
    const isAR = kind === 'receivables';
    const openingDate = toDocDate(dto.date);
    const partyTable = isAR ? customers : suppliers;
    const parties = await this.db
      .select({ id: partyTable.id, code: partyTable.code, name: partyTable.name, term: partyTable.paymentTermDays })
      .from(partyTable)
      .where(eq(partyTable.tenantId, user.tenantId));
    const byCode = new Map(parties.map((p) => [p.code.toUpperCase(), p]));
    const used = new Set(
      isAR
        ? (await this.db.select({ n: invoices.number }).from(invoices).where(eq(invoices.tenantId, user.tenantId))).map((x) => x.n.toUpperCase())
        : (
            await this.db
              .select({ s: purchaseInvoices.supplierId, n: purchaseInvoices.supplierInvoiceNo })
              .from(purchaseInvoices)
              .where(eq(purchaseInvoices.tenantId, user.tenantId))
          ).map((x) => `${x.s}|${x.n.toUpperCase()}`),
    );
    // nomor dokumen internal utang awal = SA/<kode supplier>/<no faktur>; wajib unik per perusahaan (indeks unik di database)
    const usedDocNo = new Set(
      isAR ? [] : (await this.db.select({ n: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.tenantId, user.tenantId))).map((x) => x.n.toUpperCase()),
    );
    const docNo = (supplierCode: string, no: string) => `SA/${supplierCode.toUpperCase()}/${no}`;
    const results: RowResult[] = [];
    const items: { partyId: string; code: string; no: string; date: string; due: string; amount: Dec }[] = [];

    dto.rows.forEach((row, i) => {
      const code = text(isAR ? row.kode_pelanggan : row.kode_supplier);
      const no = text(row.no_faktur);
      const { r, req, max, amount, day } = this.checker(results, i, `${code ?? ''} · ${no ?? ''}`);
      req(code, isAR ? 'Kode pelanggan' : 'Kode supplier');
      req(no, 'No. faktur');
      max(no, 60, 'No. faktur');
      const party = code ? byCode.get(code.toUpperCase()) : undefined;
      if (code && !party) r.errors.push(`${isAR ? 'Pelanggan' : 'Supplier'} ${code} belum ada — impor daftar ${isAR ? 'pelanggan' : 'supplier'} dulu`);
      const d = day(row.tanggal, 'Tanggal faktur', true);
      if (d && d > openingDate) r.errors.push('Tanggal faktur tidak boleh setelah tanggal saldo awal');
      const due = day(row.jatuh_tempo, 'Jatuh tempo');
      if (due && d && due < d) r.errors.push('Jatuh tempo sebelum tanggal faktur');
      const amt = amount(isAR ? row.sisa_piutang : row.sisa_utang, isAR ? 'Sisa piutang' : 'Sisa utang', { required: true, positive: true });
      if (no && party) {
        const k = isAR ? no.toUpperCase() : `${party.id}|${no.toUpperCase()}`;
        if (used.has(k)) r.errors.push(isAR ? `No. faktur ${no} sudah dipakai` : `Faktur ${no} dari supplier ini sudah ada`);
        used.add(k);
        if (!isAR) {
          const dn = docNo(party.code, no).toUpperCase();
          if (dn.length > 80) r.errors.push('Kode supplier + no. faktur terlalu panjang (gabungan maks. 76 karakter)');
          else if (usedDocNo.has(dn)) r.errors.push(`Nomor dokumen ${dn} sudah ada`);
          usedDocNo.add(dn);
        }
      }
      if (r.errors.length) {
        r.action = 'ERROR';
        return;
      }
      const dueDate = due ?? addDays(d!, party!.term);
      if (dueDate < openingDate) r.warnings.push('Sudah lewat jatuh tempo');
      items.push({ partyId: party!.id, code: party!.code, no: no!, date: d!, due: dueDate, amount: amt! });
    });

    return {
      results,
      write: async (tx) => {
        if (!items.length) return;
        const total = items.reduce<Dec>((s, x) => s.plus(x.amount), ZERO);
        const label = isAR ? 'piutang' : 'utang';
        const journal = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date: openingDate,
          description: `Saldo awal ${label} usaha (${items.length} faktur, impor)`,
          sourceType: 'OPENING',
          createdById: user.sub,
          lines: isAR
            ? [
                { key: SYS.AR, debit: total, memo: `Saldo awal ${label}` },
                { key: SYS.OPENING_EQUITY, credit: total },
              ]
            : [
                { key: SYS.OPENING_EQUITY, debit: total },
                { key: SYS.AP, credit: total, memo: `Saldo awal ${label}` },
              ],
        });
        for (const chunk of chunks(items, 500)) {
          if (isAR) {
            await tx.insert(invoices).values(
              chunk.map((x) => ({
                tenantId: user.tenantId,
                number: x.no,
                date: x.date,
                dueDate: x.due,
                customerId: x.partyId,
                isOpening: true,
                subtotal: x.amount.toFixed(2),
                taxAmount: '0',
                total: x.amount.toFixed(2),
                journalId: journal.id,
              })),
            );
          } else {
            await tx.insert(purchaseInvoices).values(
              chunk.map((x) => ({
                tenantId: user.tenantId,
                number: docNo(x.code, x.no),
                supplierInvoiceNo: x.no,
                date: x.date,
                dueDate: x.due,
                supplierId: x.partyId,
                kind: 'OPENING',
                description: 'Saldo awal utang (impor)',
                subtotal: x.amount.toFixed(2),
                taxAmount: '0',
                total: x.amount.toFixed(2),
                journalId: journal.id,
              })),
            );
          }
        }
      },
    };
  }

  // ---------------------------------------------------------------- saldo awal akun
  private async accountBalances(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const accs = await this.db.select().from(accounts).where(eq(accounts.tenantId, user.tenantId));
    const byCode = new Map(accs.map((a) => [a.code, a]));
    // akun yang sudah punya jurnal saldo awal: impor lagi akan MENAMBAH, bukan mengganti
    const alreadyOpened = new Set(
      (
        await this.db.execute<{ account_id: string }>(sql`
          SELECT DISTINCT l.account_id::text AS account_id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
          WHERE j.tenant_id = ${user.tenantId} AND j.source_type = 'OPENING'`)
      ).rows.map((x) => x.account_id),
    );
    const viaOther: Record<string, string> = {
      [SYS.AR]: 'Piutang usaha diisi lewat impor "Piutang awal per faktur" agar umur piutang tercatat',
      [SYS.AP]: 'Utang usaha diisi lewat impor "Utang awal per faktur" agar jatuh tempo tercatat',
      [SYS.INVENTORY]: 'Persediaan diisi lewat impor "Stok awal" agar kartu stok tercatat',
      [SYS.INVENTORY_SEMI]: 'Persediaan barang setengah jadi diisi lewat impor "Stok awal" agar kartu stok tercatat',
      [SYS.OPENING_EQUITY]: 'Akun ini diisi otomatis sebagai penyeimbang',
    };
    const seen = new Set<string>();
    const results: RowResult[] = [];
    const lines: { accountId: string; debit: string; credit: string }[] = [];
    let td: Dec = ZERO;
    let tc: Dec = ZERO;

    dto.rows.forEach((row, i) => {
      const code = text(row.kode_akun);
      const { r, req, amount } = this.checker(results, i, code ?? '');
      req(row.kode_akun, 'Kode akun');
      const a = code ? byCode.get(code) : undefined;
      if (code && !a) r.errors.push(`Akun ${code} tidak ada di bagan akun`);
      if (a && !a.isPostable) r.errors.push(`${a.code} ${a.name} adalah akun induk — pakai sub-akunnya`);
      if (a?.systemKey && viaOther[a.systemKey]) r.errors.push(viaOther[a.systemKey]);
      if (code) {
        if (seen.has(code)) r.errors.push('Kode akun muncul lebih dari sekali');
        seen.add(code);
      }
      const d = amount(row.debit, 'Debit', { min: 0 }) ?? ZERO;
      const c = amount(row.kredit, 'Kredit', { min: 0 }) ?? ZERO;
      if (d.gt(0) && c.gt(0)) r.errors.push('Isi debit ATAU kredit, bukan keduanya');
      if (d.isZero() && c.isZero() && !r.errors.length) r.warnings.push('Saldo nol — dilewati');
      if (a && alreadyOpened.has(a.id) && (d.gt(0) || c.gt(0)))
        r.warnings.push('Akun ini sudah punya saldo awal — nilai di file akan DITAMBAHKAN ke saldo yang ada, bukan menggantinya. Impor ulang hanya untuk akun yang belum terisi.');
      if (a && !r.errors.length) {
        const natural = ['ASSET', 'EXPENSE'].includes(a.type) ? 'D' : 'C';
        if ((natural === 'D' && c.gt(0)) || (natural === 'C' && d.gt(0))) r.warnings.push('Saldo di sisi yang tidak biasa untuk jenis akun ini — periksa lagi');
        if (a.type === 'REVENUE' || a.type === 'EXPENSE')
          r.warnings.push('Akun laba rugi: saldo awal biasanya hanya untuk neraca (laba tahun berjalan masuk ke Laba ditahan)');
      }
      if (r.errors.length) {
        r.action = 'ERROR';
        return;
      }
      if (d.gt(0) || c.gt(0)) {
        lines.push({ accountId: a!.id, debit: d.toFixed(2), credit: c.toFixed(2) });
        td = td.plus(d);
        tc = tc.plus(c);
      }
    });
    if (lines.length && !td.minus(tc).isZero()) {
      const diff = td.minus(tc);
      results.push({
        row: 0,
        key: 'Total',
        action: 'CREATE',
        errors: [],
        warnings: [`Debit ${rp(td)} ≠ kredit ${rp(tc)}. Selisih ${rp(diff.abs())} dicatat ke Ekuitas Saldo Awal — pastikan memang disengaja.`],
      });
    }
    return {
      results,
      write: async (tx) => {
        if (lines.length) await this.accounting.openingBalance(user, { date: dto.date!, lines }, tx);
      },
    };
  }

  // ---------------------------------------------------------------- aset tetap lama
  /**
   * Aset yang sudah dimiliki sebelum memakai SANSU. Tidak membuat jurnal: nilai perolehan & akumulasi penyusutannya
   * masuk ke neraca lewat impor "Saldo awal akun". Penyusutan baru dimulai bulan setelah tanggal saldo awal.
   */
  private async existingAssets(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const cutoff = toDocDate(dto.date);
    const startMonth = `${addDays(cutoff, 1).slice(0, 7)}-01`;
    const cats = await this.db.select().from(assetCategories).where(eq(assetCategories.tenantId, user.tenantId));
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
    const usedCodes = await this.assetsSvc.existingCodes(user.tenantId);
    const emkm = (await frameworkOf(this.db, user.tenantId)) === 'SAK_EMKM';
    const seen = new Set<string>();
    const results: RowResult[] = [];
    type W = { cat: (typeof cats)[number]; code?: string; name: string; acquisitionDate: string; cost: Dec; residual: Dec; opening: Dec; life?: number; location?: string; notes?: string };
    const writes: W[] = [];

    rows_: for (const [i, row] of dto.rows.entries()) {
      const code = upper(text(row.kode));
      const { r, req, max, amount, day } = this.checker(results, i, code ?? text(row.nama) ?? '');
      const name = max(req(row.nama, 'Nama aset'), MAX.name, 'Nama aset');
      max(code, MAX.code, 'Kode');
      const catName = req(row.kategori, 'Kategori');
      const cat = catName ? catByName.get(catName.toLowerCase()) : undefined;
      if (catName && !cat) r.errors.push(`Kategori "${catName}" tidak ada. Buat dulu di Aset Tetap › Kategori, atau pakai: ${cats.map((c) => c.name).join(', ') || '(belum ada kategori)'}`);
      const acquired = day(row.tanggal_perolehan, 'Tanggal perolehan', true);
      if (acquired && acquired > cutoff) r.errors.push('Tanggal perolehan tidak boleh setelah tanggal saldo awal; aset yang dibeli sesudahnya dicatat lewat faktur pembelian');
      const cost = amount(row.harga_perolehan, 'Harga perolehan', { required: true, positive: true });
      const residual = amount(row.nilai_residu, 'Nilai residu', { min: 0 }) ?? ZERO;
      const opening = amount(row.akumulasi_penyusutan, 'Akumulasi penyusutan', { min: 0 }) ?? ZERO;
      const lifeN = amount(row.masa_manfaat_bulan, 'Masa manfaat (bulan)', { min: 0 });
      if (lifeN && (!lifeN.isInteger() || lifeN.gt(600))) r.errors.push('Masa manfaat harus bilangan bulat 0–600 bulan');
      if (cost) {
        if (residual.gte(cost)) r.errors.push('Nilai residu harus lebih kecil dari harga perolehan');
        else if (emkm && residual.gt(0)) r.errors.push('SAK EMKM tidak mengenal nilai residu: kosongkan kolom ini');
        else if (opening.gt(cost.minus(residual))) r.errors.push('Akumulasi penyusutan melebihi nilai yang dapat disusutkan (harga perolehan dikurangi residu)');
      }
      if (code) {
        if (usedCodes.has(code)) r.errors.push('Kode aset sudah dipakai aset lain');
        if (seen.has(code)) r.errors.push('Kode muncul lebih dari sekali di file');
        seen.add(code);
      } else {
        r.warnings.push('Kode kosong: dibuat otomatis (AT-xxxx)');
      }
      if (r.errors.length) {
        r.action = 'ERROR';
        continue rows_;
      }
      if (cat!.method === 'NONE' && opening.gt(0)) r.warnings.push('Kategori ini tidak disusutkan, tetapi akumulasi diisi');
      writes.push({ cat: cat!, code, name: name!, acquisitionDate: acquired!, cost: cost!, residual, opening, life: lifeN?.toNumber(), location: text(row.lokasi), notes: text(row.catatan) });
    }

    return {
      results,
      write: async (tx) => {
        let n = usedCodes.size;
        for (const w of writes) {
          let code = w.code;
          while (!code) {
            n += 1;
            const c = `AT-${String(n).padStart(4, '0')}`;
            if (!usedCodes.has(c)) code = c;
          }
          usedCodes.add(code);
          await this.assetsSvc.registerExisting(tx, user.tenantId, w.cat, {
            code,
            name: w.name,
            acquisitionDate: w.acquisitionDate,
            depreciationStart: startMonth,
            cost: w.cost,
            residual: w.residual,
            opening: w.opening,
            usefulLifeMonths: w.life,
            location: w.location,
            notes: w.notes ?? `Diimpor sebagai aset lama (saldo awal ${cutoff})`,
          });
        }
      },
    };
  }
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

@ApiTags('Impor data')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  /** dryRun (default) = pratinjau tanpa menyimpan; dryRun=false = simpan semua dalam satu transaksi */
  @Roles('ADMIN', 'FINANCE')
  @HttpCode(200)
  @Post()
  run(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) {
    return this.svc.run(u, dto);
  }
}

@Module({
  imports: [InventoryModule, AccountingModule, AssetsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}

