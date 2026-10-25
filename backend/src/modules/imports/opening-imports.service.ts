import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, toDocDate } from '../../common/utils/dates';
import { Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { frameworkOf } from '../accounting/coa-sync';
import { AssetsService } from '../assets/assets.service';
import { AccountingService } from '../accounting/accounting.service';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { date, text } from './parse';
import { ImportDto } from './imports.dto';
import { ImportsRepository } from './imports.repository';
import { chunks, MAX, type Plan, type RowResult, rowChecker, rp, upper } from './imports.shared';

@Injectable()
export class OpeningImportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly inventory: InventoryService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingService,
    private readonly assetsSvc: AssetsService,
    private readonly repo: ImportsRepository,
  ) {}

  async stock(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const prods = await this.repo.listProductsForStock(this.db, user.tenantId);
    const bySku = new Map(prods.map((p) => [p.sku.toUpperCase(), p.id]));
    const whs = await this.repo.listWarehouses(this.db, user.tenantId);
    const byWh = new Map<string, string>();
    for (const w of whs) {
      byWh.set(w.code.toUpperCase(), w.id);
      byWh.set(w.name.toUpperCase(), w.id);
    }
    const defaultWh = dto.warehouseId ?? whs[0]?.id;
    if (dto.warehouseId && !whs.some((w) => w.id === dto.warehouseId))
      throw new BadRequestException('Gudang tidak ditemukan');
    const stocked = new Set(
      (await this.repo.listStockBalancesByQty(this.db, user.tenantId)).map((x) => `${x.p}|${x.w}`),
    );
    const seen = new Set<string>();
    const results: RowResult[] = [];
    const groups = new Map<string, { productId: string; qty: string; unitCost: string }[]>();

    dto.rows.forEach((row, i) => {
      const sku = upper(text(row.sku));
      const { r, req, amount } = rowChecker(results, i, sku ?? '');
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
          await this.inventory.adjust(
            user,
            { warehouseId, reason: 'OPENING', date: dto.date!, notes: 'Impor saldo awal', lines },
            tx,
          );
        }
      },
    };
  }

  async openItems(user: AuthUser, dto: ImportDto, kind: 'receivables' | 'payables'): Promise<Plan> {
    const isAR = kind === 'receivables';
    const openingDate = toDocDate(dto.date);
    const parties = await this.repo.listPartyTerms(this.db, user.tenantId, isAR ? 'customers' : 'suppliers');
    const byCode = new Map(parties.map((p) => [p.code.toUpperCase(), p]));
    const used = new Set(
      isAR
        ? (await this.repo.listInvoices(this.db, user.tenantId)).map((x) => x.n.toUpperCase())
        : (await this.repo.listPurchaseInvoices(this.db, user.tenantId)).map((x) => `${x.s}|${x.n.toUpperCase()}`),
    );
    // nomor dokumen internal utang awal = SA/<kode supplier>/<no faktur>; wajib unik per perusahaan (indeks unik di database)
    const usedDocNo = new Set(
      isAR
        ? []
        : (await this.repo.listPurchaseInvoicesForOpenItems(this.db, user.tenantId)).map((x) => x.n.toUpperCase()),
    );
    const docNo = (supplierCode: string, no: string) => `SA/${supplierCode.toUpperCase()}/${no}`;
    const results: RowResult[] = [];
    const items: { partyId: string; code: string; no: string; date: string; due: string; amount: Dec }[] = [];

    dto.rows.forEach((row, i) => {
      const code = text(isAR ? row.kode_pelanggan : row.kode_supplier);
      const no = text(row.no_faktur);
      const { r, req, max, amount, day } = rowChecker(results, i, `${code ?? ''} · ${no ?? ''}`);
      req(code, isAR ? 'Kode pelanggan' : 'Kode supplier');
      req(no, 'No. faktur');
      max(no, 60, 'No. faktur');
      const party = code ? byCode.get(code.toUpperCase()) : undefined;
      if (code && !party)
        r.errors.push(
          `${isAR ? 'Pelanggan' : 'Supplier'} ${code} belum ada — impor daftar ${isAR ? 'pelanggan' : 'supplier'} dulu`,
        );
      const d = day(row.tanggal, 'Tanggal faktur', true);
      if (d && d > openingDate) r.errors.push('Tanggal faktur tidak boleh setelah tanggal saldo awal');
      const due = day(row.jatuh_tempo, 'Jatuh tempo');
      if (due && d && due < d) r.errors.push('Jatuh tempo sebelum tanggal faktur');
      const amt = amount(isAR ? row.sisa_piutang : row.sisa_utang, isAR ? 'Sisa piutang' : 'Sisa utang', {
        required: true,
        positive: true,
      });
      if (no && party) {
        const k = isAR ? no.toUpperCase() : `${party.id}|${no.toUpperCase()}`;
        if (used.has(k))
          r.errors.push(isAR ? `No. faktur ${no} sudah dipakai` : `Faktur ${no} dari supplier ini sudah ada`);
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
            await this.repo.insertInvoices(tx, chunk, user.tenantId, journal.id);
          } else {
            await this.repo.insertPurchaseInvoices(tx, chunk, user.tenantId, docNo, journal.id);
          }
        }
      },
    };
  }

  async accountBalances(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const accs = await this.repo.listAccounts(this.db, user.tenantId);
    const byCode = new Map(accs.map((a) => [a.code, a]));
    // akun yang sudah punya jurnal saldo awal: impor lagi akan MENAMBAH, bukan mengganti
    const alreadyOpened = new Set(
      (await this.repo.queryJournalLine(this.db, user.tenantId)).rows.map((x) => x.account_id),
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
      const { r, req, amount } = rowChecker(results, i, code ?? '');
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
        r.warnings.push(
          'Akun ini sudah punya saldo awal — nilai di file akan DITAMBAHKAN ke saldo yang ada, bukan menggantinya. Impor ulang hanya untuk akun yang belum terisi.',
        );
      if (a && !r.errors.length) {
        const natural = ['ASSET', 'EXPENSE'].includes(a.type) ? 'D' : 'C';
        if ((natural === 'D' && c.gt(0)) || (natural === 'C' && d.gt(0)))
          r.warnings.push('Saldo di sisi yang tidak biasa untuk jenis akun ini — periksa lagi');
        if (a.type === 'REVENUE' || a.type === 'EXPENSE')
          r.warnings.push(
            'Akun laba rugi: saldo awal biasanya hanya untuk neraca (laba tahun berjalan masuk ke Laba ditahan)',
          );
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
        warnings: [
          `Debit ${rp(td)} ≠ kredit ${rp(tc)}. Selisih ${rp(diff.abs())} dicatat ke Ekuitas Saldo Awal — pastikan memang disengaja.`,
        ],
      });
    }
    return {
      results,
      write: async (tx) => {
        if (lines.length) await this.accounting.openingBalance(user, { date: dto.date!, lines }, tx);
      },
    };
  }

  /**
   * Aset yang sudah dimiliki sebelum memakai SANSU. Tidak membuat jurnal: nilai perolehan & akumulasi penyusutannya
   * masuk ke neraca lewat impor "Saldo awal akun". Penyusutan baru dimulai bulan setelah tanggal saldo awal.
   */
  async existingAssets(user: AuthUser, dto: ImportDto): Promise<Plan> {
    const cutoff = toDocDate(dto.date);
    const startMonth = `${addDays(cutoff, 1).slice(0, 7)}-01`;
    const cats = await this.repo.listAssetCategories(this.db, user.tenantId);
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
    const usedCodes = await this.assetsSvc.existingCodes(user.tenantId);
    const emkm = (await frameworkOf(this.db, user.tenantId)) === 'SAK_EMKM';
    const seen = new Set<string>();
    const results: RowResult[] = [];
    type W = {
      cat: (typeof cats)[number];
      code?: string;
      name: string;
      acquisitionDate: string;
      cost: Dec;
      residual: Dec;
      opening: Dec;
      life?: number;
      location?: string;
      notes?: string;
      totalUnits?: string;
      unitLabel?: string;
    };
    const writes: W[] = [];

    rows_: for (const [i, row] of dto.rows.entries()) {
      const code = upper(text(row.kode));
      const { r, req, max, amount, day } = rowChecker(results, i, code ?? text(row.nama) ?? '');
      const name = max(req(row.nama, 'Nama aset'), MAX.name, 'Nama aset');
      max(code, MAX.code, 'Kode');
      const catName = req(row.kategori, 'Kategori');
      const cat = catName ? catByName.get(catName.toLowerCase()) : undefined;
      if (catName && !cat)
        r.errors.push(
          `Kategori "${catName}" tidak ada. Buat dulu di Aset Tetap › Kategori, atau pakai: ${cats.map((c) => c.name).join(', ') || '(belum ada kategori)'}`,
        );
      const acquired = day(row.tanggal_perolehan, 'Tanggal perolehan', true);
      if (acquired && acquired > cutoff)
        r.errors.push(
          'Tanggal perolehan tidak boleh setelah tanggal saldo awal; aset yang dibeli sesudahnya dicatat lewat faktur pembelian',
        );
      const cost = amount(row.harga_perolehan, 'Harga perolehan', { required: true, positive: true });
      const residual = amount(row.nilai_residu, 'Nilai residu', { min: 0 }) ?? ZERO;
      const opening = amount(row.akumulasi_penyusutan, 'Akumulasi penyusutan', { min: 0 }) ?? ZERO;
      const lifeN = amount(row.masa_manfaat_bulan, 'Masa manfaat (bulan)', { min: 0 });
      if (lifeN && (!lifeN.isInteger() || lifeN.gt(600)))
        r.errors.push('Masa manfaat harus bilangan bulat 0–600 bulan');
      if (cost) {
        if (residual.gte(cost)) r.errors.push('Nilai residu harus lebih kecil dari harga perolehan');
        else if (emkm && residual.gt(0)) r.errors.push('SAK EMKM tidak mengenal nilai residu: kosongkan kolom ini');
        else if (opening.gt(cost.minus(residual)))
          r.errors.push('Akumulasi penyusutan melebihi nilai yang dapat disusutkan (harga perolehan dikurangi residu)');
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
      if (cat!.method === 'NONE' && opening.gt(0))
        r.warnings.push('Kategori ini tidak disusutkan, tetapi akumulasi diisi');
      const units = amount(row.total_unit, 'Total unit', { min: 0 });
      if (cat!.method === 'UNITS_OF_PRODUCTION' && !(units && units.gt(0))) {
        r.errors.push('Kategori bermetode unit produksi: isi kolom Total unit (kapasitas penuh aset)');
        r.action = 'ERROR';
        continue rows_;
      }
      writes.push({
        cat: cat!,
        code,
        name: name!,
        acquisitionDate: acquired!,
        cost: cost!,
        residual,
        opening,
        life: lifeN?.toNumber(),
        location: text(row.lokasi),
        notes: text(row.catatan),
        totalUnits: cat!.method === 'UNITS_OF_PRODUCTION' ? units!.toFixed(4) : undefined,
        unitLabel: text(row.satuan_unit) ?? undefined,
      });
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
            totalUnits: w.totalUnits,
            unitLabel: w.unitLabel,
            notes: w.notes ?? `Diimpor sebagai aset lama (saldo awal ${cutoff})`,
          });
        }
      },
    };
  }
}
