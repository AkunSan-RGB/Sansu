import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, NotFoundException } from '@nestjs/common';
import { DEPRECIATION_METHOD_LABELS, type FiscalAssetGroup } from '@sansu/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, assertNotFarFuture, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { assetCategories, assetDepreciations, assetUsage, fixedAssets, users } from '../../db/schema';
import { frameworkOf } from '../accounting/coa-sync';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { AssetRepository } from './asset.repository';
import { accumulatedThrough, depreciationFor, fiscalDepreciation, lastDay, monthIndex, periodOf, type MethodChange } from './depreciation';
import { CategoryDto, UpdateCategoryDto, RegisterFromJournalDto, CreateAssetDto, UpdateAssetDto, VerifyDto, UsageDto, ChangeMethodDto, TransferAssetBranchDto, DisposeDto } from './assets.dto';

/** Pengaturan aset tetap per perusahaan (disimpan di settings.assets) */
export const DEFAULT_ASSET_SETTINGS = { autoDepreciation: true };

/** Pelepasan aset berharga perolehan ≥ ini oleh selain Pemilik diberitahukan ke Pemilik */
export const ASSET_ALERT_VALUE = 5_000_000;

type Asset = typeof fixedAssets.$inferSelect;

type Category = typeof assetCategories.$inferSelect;

@Injectable()
export class AssetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly telegram: TelegramService,
    private readonly repo: AssetRepository,
  ) {}

  /** Tanah & kategori tak disusutkan selalu dikapitalisasi, berapa pun nilainya */
  isThresholdExempt(cat: { method: string; fiscalGroup: string }) {
    return cat.method === 'NONE' || cat.fiscalGroup === 'LAND';
  }

  listCategories(tenantId: string, db: DbOrTx = this.db) {
    return db.query.assetCategories.findMany({
      where: eq(assetCategories.tenantId, tenantId),
      with: {
        assetAccount: { columns: { id: true, code: true, name: true } },
        accumulatedAccount: { columns: { id: true, code: true, name: true } },
        expenseAccount: { columns: { id: true, code: true, name: true } },
      },
      orderBy: asc(assetCategories.name),
    });
  }

  private async assertAccounts(tenantId: string, dto: Partial<CategoryDto>) {
    const ids = [dto.assetAccountId, dto.accumulatedAccountId, dto.expenseAccountId].filter(Boolean) as string[];
    for (const id of ids) {
      const a = await this.repo.accountById(this.db, tenantId, id);
      if (!a || !a.isPostable) throw new BadRequestException('Akun kategori tidak valid');
    }
    if (dto.method && dto.method !== 'NONE' && (!dto.accumulatedAccountId || !dto.expenseAccountId)) {
      throw new BadRequestException('Kategori yang disusutkan wajib punya akun akumulasi & beban penyusutan');
    }
  }

  async createCategory(tenantId: string, dto: CategoryDto) {
    await this.assertAccounts(tenantId, dto);
    const c = await this.repo.insertCategory(this.db, { ...dto, tenantId });
    return c;
  }

  async updateCategory(user: AuthUser, id: string, dto: UpdateCategoryDto) {
    const tenantId = user.tenantId;
    const cur = await this.repo.categoryById(this.db, tenantId, id);
    if (!cur) throw new NotFoundException('Kategori tidak ditemukan');
    await this.assertAccounts(tenantId, { ...cur, ...dto } as CategoryDto);
    const c = await this.repo.updateCategory(this.db, id, dto);
    const diff = Object.entries(dto).filter(([k, v]) => v !== undefined && (cur as Record<string, unknown>)[k] !== v);
    if (diff.length) await this.audit.log(this.db, { tenantId, userId: user.sub, action: 'UPDATE', entity: 'AssetCategory', entityId: id, data: Object.fromEntries(diff.map(([k, v]) => [k, { from: (cur as Record<string, unknown>)[k], to: v }])) });
    return c;
  }

  /** Pemakaian per bulan semua aset (metode unit produksi): assetId → { 'YYYY-MM': unit } */
  private async loadUsage(db: Db | Tx, tenantId: string, assetId?: string) {
    const rows = await this.repo.usageRows(db, tenantId, assetId);
    const map = new Map<string, Record<string, number>>();
    for (const r of rows) map.set(r.assetId, { ...(map.get(r.assetId) ?? {}), [r.period]: Number(r.units) });
    return map;
  }

  /** Sisipkan kapasitas dan pemakaian agar perhitungan unit produksi bisa berjalan */
  private withUnits<T extends { id: string; method: string; totalUnits: string | null }>(a: T, usage: Map<string, Record<string, number>>) {
    return a.method === 'UNITS_OF_PRODUCTION' ? { ...a, units: { total: Number(a.totalUnits ?? 0), byPeriod: usage.get(a.id) ?? {} } } : a;
  }

  /** Daftar aset dengan nilai buku per tanggal */
  async list(tenantId: string, asOf?: string) {
    const date = toDocDate(asOf);
    const rows = await this.db.query.fixedAssets.findMany({
      where: eq(fixedAssets.tenantId, tenantId),
      with: { category: { columns: { id: true, name: true, fiscalGroup: true } } },
      orderBy: asc(fixedAssets.code),
    });
    const posted = await this.postedTotals(this.db, tenantId, date.slice(0, 7));
    const usage = await this.loadUsage(this.db, tenantId);
    return rows.map((a) => this.withValues(this.withUnits(a, usage), posted.get(a.id), date));
  }

  /**
   * Cocokkan daftar aset dengan buku besar per tanggal: total harga perolehan vs saldo akun aset, dan total akumulasi vs
   * saldo akun akumulasi penyusutan. Selisih biasanya berarti aset lama belum dirinci (saldo awal sudah diisi tetapi daftar asetnya belum),
   * atau ada jurnal manual langsung ke akun aset.
   */
  /**
   * Pembelian aset yang sudah ada di buku besar tetapi belum menjadi kartu aset (mis. kas keluar sebelum fitur otomatisasi):
   * debit ke akun aset tetap pada jurnal yang bukan saldo awal, belum dibalik, dikurangi nilai kartu aset yang sudah terhubung.
   */
  async unregistered(tenantId: string, db: DbOrTx = this.db) {
    const res = await db.execute<{
      journal_id: string; number: string; date: string; description: string; source_type: string; account_id: string; code: string; name: string; amount: string; registered: string;
    }>(sql`
      SELECT j.id AS journal_id, j.number, j.date::text AS date, j.description, j.source_type, a.id AS account_id, a.code, a.name,
             SUM(l.debit) AS amount,
             COALESCE((SELECT SUM(fa.cost) FROM fixed_assets fa JOIN asset_categories c ON c.id = fa.category_id
                       WHERE fa.acquisition_journal_id = j.id AND c.asset_account_id = a.id), 0) AS registered
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND l.debit > 0
        AND a.id IN (SELECT asset_account_id FROM asset_categories WHERE tenant_id = ${tenantId})
        AND j.source_type NOT IN ('OPENING', 'REVERSAL', 'ASSET_DISPOSAL', 'CLOSING')
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      GROUP BY j.id, j.number, j.date, j.description, j.source_type, a.id, a.code, a.name
      ORDER BY j.date, j.number`);
    const cats = await this.listCategories(tenantId, db);
    return res.rows
      .map((r) => ({ ...r, remaining: D(r.amount).minus(r.registered) }))
      .filter((r) => r.remaining.gte(1))
      .map((r) => ({
        journalId: r.journal_id,
        journalNumber: r.number,
        date: r.date.slice(0, 10),
        description: r.description,
        sourceType: r.source_type,
        accountId: r.account_id,
        accountCode: r.code,
        accountName: r.name,
        amount: D(r.amount).toFixed(2),
        remaining: r.remaining.toFixed(2),
        categories: cats.filter((c) => c.assetAccount?.id === r.account_id).map((c) => ({ id: c.id, name: c.name, method: c.method })),
      }));
  }

  /** Jadikan pembelian yang sudah dijurnal sebagai kartu aset, tanpa jurnal baru (jurnal asalnya tetap satu-satunya pencatatan) */
  async registerFromJournal(user: AuthUser, dto: RegisterFromJournalDto) {
    const asset = await this.registerFromJournalTx(user, dto);
    this.notifyAcquisition(user, `${asset.code} ${asset.name}`, D(asset.cost), 'didaftarkan dari jurnal yang sudah ada');
    return asset;
  }

  private async registerFromJournalTx(user: AuthUser, dto: RegisterFromJournalDto) {
    return this.db.transaction(async (tx) => {
      const rows = (await this.unregistered(user.tenantId, tx)).filter((r) => r.journalId === dto.journalId && r.accountId === dto.accountId);
      const row = rows[0];
      if (!row) throw new BadRequestException('Pembelian ini tidak ditemukan atau sudah seluruhnya menjadi kartu aset');
      const cats = await this.repo.categoriesByAssetAccount(tx, user.tenantId, dto.accountId);
      const cat = dto.categoryId ? cats.find((c) => c.id === dto.categoryId) : cats.length === 1 ? cats[0] : undefined;
      if (!cat) throw new BadRequestException(dto.categoryId ? 'Kategori tidak sesuai dengan akun aset jurnal ini' : 'Akun ini dipakai beberapa kategori; pilih kategori asetnya');
      const amount = money(dto.amount ?? row.remaining);
      if (amount.lte(0) || amount.gt(row.remaining)) throw new BadRequestException(`Nilai harus lebih dari 0 dan paling banyak sisa yang belum terdaftar (${D(row.remaining).toFixed(2)})`);
      const [jl] = (await tx.execute<{ b: string | null }>(sql`SELECT branch_id::text AS b FROM journal_lines WHERE journal_id = ${dto.journalId} AND account_id = ${dto.accountId} LIMIT 1`)).rows;
      const asset = await this.insertAsset(tx, user.tenantId, cat, {
        name: dto.name.trim(),
        acquisitionDate: row.date,
        depreciationStart: `${row.date.slice(0, 7)}-01`,
        cost: amount,
        residual: ZERO,
        usefulLifeMonths: dto.usefulLifeMonths,
        location: dto.location,
        notes: `Didaftarkan dari jurnal ${row.journalNumber}`,
        acquisitionJournalId: dto.journalId,
        branchId: jl?.b ?? null,
        totalUnits: dto.totalUnits,
        unitLabel: dto.unitLabel,
      });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FixedAsset', entityId: asset.id, data: { via: 'JOURNAL', journal: row.journalNumber, amount: amount.toFixed(2) } });
      return asset;
    });
  }

  private withValues(a: Asset & { category: { id: string; name: string; fiscalGroup: string }; units?: { total: number; byPeriod: Record<string, number> } }, p: { total: Dec; last: string | null } | undefined, date: string) {
    const disposed = a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= date;
    const accumulated = disposed ? ZERO : D(a.openingAccumulated).plus(p?.total ?? ZERO);
    const cost = disposed ? ZERO : D(a.cost);
    const next = depreciationFor(a, D(a.openingAccumulated).plus(p?.total ?? ZERO), date.slice(0, 7));
    return {
      ...a,
      accumulated: accumulated.toFixed(2),
      bookValue: cost.minus(accumulated).toFixed(2),
      lastDepreciation: p?.last ?? null,
      monthlyEstimate: next.toFixed(2),
    };
  }

  async postedTotals(db: DbOrTx, tenantId: string, upTo: string) {
    const res = await db.execute<{ asset_id: string; total: string; last: string }>(sql`
      SELECT asset_id, SUM(amount) AS total, MAX(period) AS last FROM asset_depreciations
      WHERE tenant_id = ${tenantId} AND period <= ${upTo} GROUP BY asset_id`);
    return new Map(res.rows.map((r) => [r.asset_id, { total: D(r.total), last: r.last }]));
  }

  async get(tenantId: string, id: string) {
    const a = await this.db.query.fixedAssets.findFirst({
      where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)),
      with: {
        category: true,
        depreciations: { orderBy: asc(assetDepreciations.period) },
      },
    });
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
    // Proyeksi jadwal penyusutan sisa masa manfaat
    const schedule: { period: string; amount: string; accumulated: string; bookValue: string; posted: boolean }[] = [];
    let acc = D(a.openingAccumulated);
    const postedMap = new Map(a.depreciations.map((d) => [d.period, D(d.amount)]));
    const start = monthIndex(a.depreciationStart.slice(0, 7));
    const usageMap = (await this.loadUsage(this.db, tenantId, a.id)).get(a.id) ?? {};
    const dep = this.withUnits(a, new Map([[a.id, usageMap]]));
    const lastUsage = Math.max(-1, ...Object.keys(usageMap).map((k) => monthIndex(k)));
    let end = a.status === 'DISPOSED' && a.disposalDate ? monthIndex(a.disposalDate.slice(0, 7)) - 1 : start + Math.max(0, a.usefulLifeMonths - 1);
    if (a.method === 'UNITS_OF_PRODUCTION') end = Math.max(lastUsage, ...[...postedMap.keys()].map((k) => monthIndex(k)), start);
    for (let i = start; i <= end && a.method !== 'NONE'; i++) {
      const p = periodOf(i);
      const amt = postedMap.get(p) ?? depreciationFor(dep, acc, p);
      if (amt.isZero() && !postedMap.has(p)) continue;
      acc = acc.plus(amt);
      schedule.push({ period: p, amount: amt.toFixed(2), accumulated: acc.toFixed(2), bookValue: D(a.cost).minus(acc).toFixed(2), posted: postedMap.has(p) });
    }
    const accumulated = a.depreciations.reduce((t, d) => t.plus(d.amount), D(a.openingAccumulated));
    return { ...a, schedule, accumulated: accumulated.toFixed(2), bookValue: a.status === 'DISPOSED' ? '0.00' : D(a.cost).minus(accumulated).toFixed(2) };
  }

  async create(user: AuthUser, dto: CreateAssetDto) {
    const id = await this.db.transaction(async (tx) => {
      const cat = await this.repo.categoryById(tx, user.tenantId, dto.categoryId);
      if (!cat) throw new BadRequestException('Kategori tidak ditemukan');
      if (dto.branchId) {
        const [b] = (await tx.execute<{ id: string }>(sql`SELECT id FROM branches WHERE id = ${dto.branchId} AND tenant_id = ${user.tenantId} AND is_active`)).rows;
        if (!b) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
      }
      assertNotFarFuture(toDocDate(dto.acquisitionDate), 'perolehan aset');
      const cost = money(dto.cost);
      const residual = money(dto.residualValue ?? '0');
      if (cost.lte(0)) throw new BadRequestException('Harga perolehan harus > 0');
      // ED SAK EMKM 11.12: penyusutan dihitung dari harga perolehan tanpa nilai residu
      if (residual.gt(0) && (await frameworkOf(tx, user.tenantId)) === 'SAK_EMKM') throw new BadRequestException('SAK EMKM tidak mengenal nilai residu: penyusutan dihitung dari seluruh harga perolehan');
      if (residual.gte(cost)) throw new BadRequestException('Nilai residu harus lebih kecil dari harga perolehan');
      const opening = money(dto.openingAccumulated ?? '0');
      if (dto.funding !== 'EXISTING' && opening.gt(0)) throw new BadRequestException('Akumulasi awal hanya untuk aset lama');
      if (opening.gt(cost.minus(residual))) throw new BadRequestException('Akumulasi awal melebihi nilai yang dapat disusutkan');
      if (dto.funding !== 'EXISTING' && !dto.ignoreCapitalizationThreshold && !this.isThresholdExempt(cat)) {
        const { capitalizationThreshold: threshold } = await this.settings.reporting(tx, user.tenantId);
        if (threshold > 0 && cost.lt(threshold)) {
          throw new BadRequestException(
            `Harga perolehan Rp${cost.toNumber().toLocaleString('id-ID')} di bawah batas kapitalisasi Rp${threshold.toLocaleString('id-ID')}. ` +
              'Catat sebagai beban (Tagihan Pembelian → baris Aset otomatis dibebankan), atau pilih "tetap kapitalisasi".',
          );
        }
      }
      const acquisitionDate = toDocDate(dto.acquisitionDate);
      const depStart = `${toDocDate(dto.depreciationStart ?? dto.acquisitionDate).slice(0, 7)}-01`;
      const asset = await this.insertAsset(tx, user.tenantId, cat, {
        code: dto.code,
        name: dto.name,
        acquisitionDate,
        depreciationStart: depStart,
        cost,
        residual,
        usefulLifeMonths: dto.usefulLifeMonths,
        method: dto.method,
        opening,
        location: dto.location,
        notes: dto.notes,
        branchId: dto.branchId ?? null,
        totalUnits: dto.totalUnits,
        unitLabel: dto.unitLabel,
      });
      if (dto.funding !== 'EXISTING') {
        const cashAcc = dto.funding === 'CASH' ? await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK') : undefined;
        if (cashAcc) await this.posting.assertCashCovers(tx, user.tenantId, cashAcc, cost);
        const credit = cashAcc
          ? { accountId: cashAcc.id, credit: cost, branchId: cashAcc.branchId ?? dto.branchId ?? null }
          : { key: SYS.OTHER_PAYABLE, credit: cost, branchId: dto.branchId ?? null };
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date: acquisitionDate,
          description: `Perolehan aset tetap ${asset.code} ${dto.name}`,
          sourceType: 'ASSET_ACQUISITION',
          sourceId: asset.id,
          createdById: user.sub,
          lines: [{ accountId: cat.assetAccountId, debit: cost, branchId: dto.branchId ?? null }, credit],
        });
        await tx.update(fixedAssets).set({ acquisitionJournalId: j.id }).where(eq(fixedAssets.id, asset.id));
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FixedAsset', entityId: asset.id });
      return asset.id;
    });
    const created = await this.get(user.tenantId, id);
    this.notifyAcquisition(user, `${created.code} ${created.name}`, D(created.cost), dto.funding === 'CASH' ? 'dibayar dari kas/bank' : dto.funding === 'PAYABLE' ? 'diutangkan' : 'aset lama (tanpa jurnal)');
    return created;
  }

  /** Pemilik diberi tahu bila aset berharga perolehan ≥ batas didaftarkan/dibeli oleh orang lain */
  notifyAcquisition(user: AuthUser, name: string, cost: Dec | number, how: string) {
    const v = typeof cost === 'number' ? cost : cost.toNumber();
    if (user.role === 'OWNER' || v < ASSET_ALERT_VALUE) return;
    void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Aset baru: ${name}`, lines: [`Harga perolehan Rp${Math.round(v).toLocaleString('id-ID')} · ${how}`, 'Pastikan ada dokumen pembelian dan aset benar-benar diterima.'], path: '/fixed-assets' });
  }

  async update(user: AuthUser, id: string, dto: UpdateAssetDto) {
    const before = await this.repo.assetById(this.db, user.tenantId, id);
    if (!before) throw new NotFoundException('Aset tidak ditemukan');
    const [a] = await this.db.update(fixedAssets).set(dto).where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId))).returning();
    // Penanggung jawab/lokasi yang berubah sering dipakai menutupi aset yang hilang: tercatat siapa, dari apa ke apa
    const changed = (['name', 'custodian', 'location', 'notes'] as const).filter((k) => dto[k] !== undefined && dto[k] !== before[k]);
    if (changed.length) {
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'FixedAsset', entityId: id, data: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: dto[k] }])) });
    }
    return a;
  }

  private async insertAsset(
    tx: Tx,
    tenantId: string,
    cat: Category,
    a: {
      code?: string;
      name: string;
      acquisitionDate: string;
      depreciationStart: string;
      cost: Dec;
      residual: Dec;
      usefulLifeMonths?: number;
      method?: string;
      opening?: Dec;
      location?: string;
      notes?: string;
      acquisitionJournalId?: string;
      purchaseInvoiceId?: string;
      branchId?: string | null;
      totalUnits?: string;
      unitLabel?: string;
    },
  ) {
    const effMethod = a.method ?? cat.method;
    if (effMethod === 'UNITS_OF_PRODUCTION' && !(Number(a.totalUnits) > 0)) {
      throw new BadRequestException('Metode unit produksi butuh total unit (kapasitas) aset. Isi total unit pada baris/form pendaftaran aset ini.');
    }
    const code = a.code?.trim().toUpperCase() || (await this.nextCode(tx, tenantId));
    const [asset] = await tx
      .insert(fixedAssets)
      .values({
        tenantId,
        code,
        name: a.name,
        categoryId: cat.id,
        acquisitionDate: a.acquisitionDate,
        depreciationStart: a.depreciationStart,
        cost: a.cost.toFixed(2),
        residualValue: a.residual.toFixed(2),
        usefulLifeMonths: a.usefulLifeMonths ?? cat.usefulLifeMonths,
        method: effMethod,
        totalUnits: effMethod === 'UNITS_OF_PRODUCTION' ? a.totalUnits : null,
        unitLabel: effMethod === 'UNITS_OF_PRODUCTION' ? a.unitLabel?.trim() || 'unit' : null,
        openingAccumulated: (a.opening ?? ZERO).toFixed(2),
        location: a.location,
        notes: a.notes,
        acquisitionJournalId: a.acquisitionJournalId,
        purchaseInvoiceId: a.purchaseInvoiceId,
        branchId: a.branchId ?? null,
      })
      .returning();
    return asset;
  }

  /**
   * Daftarkan aset dari faktur supplier (jurnalnya sudah dibuat oleh faktur: Dr Aset | Cr Utang Usaha).
   * Dipanggil di dalam transaksi faktur pembelian.
   */
  async registerFromPurchase(
    tx: Tx,
    tenantId: string,
    a: { categoryId: string; name: string; date: string; cost: Dec; usefulLifeMonths?: number; location?: string; journalId: string; purchaseInvoiceId: string; notes?: string; branchId?: string | null; totalUnits?: string; unitLabel?: string },
  ) {
    const cat = await this.repo.categoryById(tx, tenantId, a.categoryId);
    if (!cat) throw new BadRequestException('Kategori aset tidak ditemukan');
    return this.insertAsset(tx, tenantId, cat, {
      name: a.name,
      acquisitionDate: a.date,
      depreciationStart: `${a.date.slice(0, 7)}-01`,
      cost: a.cost,
      residual: ZERO,
      usefulLifeMonths: a.usefulLifeMonths,
      location: a.location,
      notes: a.notes,
      acquisitionJournalId: a.journalId,
      purchaseInvoiceId: a.purchaseInvoiceId,
      branchId: a.branchId ?? null,
      totalUnits: a.totalUnits,
      unitLabel: a.unitLabel,
    });
  }

  /** Aset lama dari impor data awal: tanpa jurnal (saldonya masuk lewat Saldo awal akun). Dipanggil di dalam transaksi impor. */
  async registerExisting(
    tx: Tx,
    tenantId: string,
    cat: Category,
    a: { code: string; name: string; acquisitionDate: string; depreciationStart: string; cost: Dec; residual: Dec; opening: Dec; usefulLifeMonths?: number; location?: string; notes?: string; totalUnits?: string; unitLabel?: string },
  ) {
    return this.insertAsset(tx, tenantId, cat, a);
  }

  /**
   * Aset yang dibeli tunai lewat Kas Keluar: kartu aset dibuat dari baris kas yang memakai akun aset tetap (jurnalnya sudah
   * dibuat oleh kas: Dr Aset | Cr Kas). Memeriksa batas kapitalisasi. Dipanggil di dalam transaksi kas.
   */
  async registerFromCash(
    tx: Tx,
    user: AuthUser,
    a: { categoryId: string; name: string; date: string; cost: Dec; usefulLifeMonths?: number; location?: string; journalId: string; notes?: string; branchId?: string | null; totalUnits?: string; unitLabel?: string },
  ) {
    const cat = await this.repo.categoryById(tx, user.tenantId, a.categoryId);
    if (!cat) throw new BadRequestException('Kategori aset tidak ditemukan');
    if (!this.isThresholdExempt(cat)) {
      const { capitalizationThreshold: threshold } = await this.settings.reporting(tx, user.tenantId);
      if (threshold > 0 && a.cost.lt(threshold)) {
        throw new BadRequestException(
          `"${a.name}" Rp${a.cost.toNumber().toLocaleString('id-ID')} di bawah batas kapitalisasi Rp${threshold.toLocaleString('id-ID')}. Catat sebagai beban, bukan aset tetap.`,
        );
      }
    }
    const asset = await this.insertAsset(tx, user.tenantId, cat, {
      name: a.name,
      acquisitionDate: a.date,
      depreciationStart: `${a.date.slice(0, 7)}-01`,
      cost: a.cost,
      residual: ZERO,
      usefulLifeMonths: a.usefulLifeMonths,
      location: a.location,
      notes: a.notes,
      acquisitionJournalId: a.journalId,
      branchId: a.branchId ?? null,
      totalUnits: a.totalUnits,
      unitLabel: a.unitLabel,
    });
    await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FixedAsset', entityId: asset.id, data: { via: 'CASH' } });
    return asset;
  }

  /** Kategori aset per akun aset (untuk mendeteksi baris kas yang membeli aset tetap) */
  async categoriesByAssetAccount(tx: Tx | Db, tenantId: string, accountIds: string[]) {
    if (!accountIds.length) return new Map<string, Category[]>();
    const cats = await this.repo.categoriesByAssetAccounts(tx, tenantId, accountIds);
    const m = new Map<string, Category[]>();
    for (const c of cats) m.set(c.assetAccountId, [...(m.get(c.assetAccountId) ?? []), c]);
    return m;
  }

  /** Kode aset otomatis berikutnya yang belum terpakai, mulai dari urutan `from` */
  async existingCodes(tenantId: string) {
    const codes = await this.repo.codes(this.db, tenantId);
    return new Set(codes.map((c) => c.toUpperCase()));
  }

  async category(tenantId: string, id: string, db: DbOrTx = this.db) {
    return this.repo.categoryById(db, tenantId, id);
  }

  private async nextCode(tx: Tx, tenantId: string) {
    // Nomor berurutan dari hitungan baris: serialkan per perusahaan agar dua pendaftaran serentak tidak mendapat kode yang sama
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`asset-code:${tenantId}`}))`);
    const [r] = (await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM fixed_assets WHERE tenant_id = ${tenantId}`)).rows;
    return `AT-${String(r.n + 1).padStart(4, '0')}`;
  }

  /**
   * Penyusutan s/d periode tertentu untuk semua aset aktif (termasuk bulan yang tertinggal).
   * Satu jurnal per bulan: Dr Beban penyusutan | Cr Akumulasi penyusutan, per kategori.
   */
  async run(user: AuthUser, period: string, onlyAssetId?: string, txArg?: Tx) {
    const work = async (tx: Tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dep:${user.tenantId}`}))`);
      const assets = await tx.query.fixedAssets.findMany({
        where: and(eq(fixedAssets.tenantId, user.tenantId), eq(fixedAssets.status, 'ACTIVE'), onlyAssetId ? eq(fixedAssets.id, onlyAssetId) : undefined),
        with: { category: true },
      });
      const posted = await this.postedTotals(tx, user.tenantId, '9999-12');
      const usage = await this.loadUsage(tx, user.tenantId);
      // per bulan → per kategori → nilai
      const plan = new Map<string, { cat: Category; asset: Asset; amount: Dec }[]>();
      for (const base of assets) {
        const a = Object.assign(base, this.withUnits(base, usage));
        if (a.method === 'NONE' || (a.usefulLifeMonths <= 0 && a.method !== 'UNITS_OF_PRODUCTION')) continue;
        let acc = D(a.openingAccumulated).plus(posted.get(a.id)?.total ?? ZERO);
        const last = posted.get(a.id)?.last;
        const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), last ? monthIndex(last) + 1 : 0);
        for (let i = from; i <= monthIndex(period); i++) {
          const p = periodOf(i);
          const amt = depreciationFor(a, acc, p);
          if (amt.isZero()) continue;
          acc = acc.plus(amt);
          plan.set(p, [...(plan.get(p) ?? []), { cat: a.category, asset: a, amount: amt }]);
        }
      }
      const journals: { period: string; number: string; amount: string; assets: number }[] = [];
      for (const p of [...plan.keys()].sort()) {
        const items = plan.get(p)!;
        // per kategori per cabang aset: biaya penyusutan masuk laporan cabang pemilik aset
        const byCat = new Map<string, { cat: Category; amount: Dec; branchId: string | null }>();
        for (const it of items) {
          const key = `${it.cat.id}|${it.asset.branchId ?? ''}`;
          const cur = byCat.get(key) ?? { cat: it.cat, amount: ZERO, branchId: it.asset.branchId ?? null };
          byCat.set(key, { ...cur, amount: cur.amount.plus(it.amount) });
        }
        const lines = [...byCat.values()].flatMap(({ cat, amount, branchId }) => {
          if (!cat.accumulatedAccountId || !cat.expenseAccountId) throw new BadRequestException(`Kategori ${cat.name} belum punya akun penyusutan`);
          return [
            { accountId: cat.expenseAccountId, debit: amount, memo: cat.name, branchId },
            { accountId: cat.accumulatedAccountId, credit: amount, memo: cat.name, branchId },
          ];
        });
        const total = items.reduce<Dec>((s, it) => s.plus(it.amount), ZERO);
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date: lastDay(p),
          description: `Penyusutan aset tetap ${p} (${items.length} aset)`,
          sourceType: 'DEPRECIATION',
          sourceId: p,
          createdById: user.sub,
          lines,
        });
        await tx.insert(assetDepreciations).values(
          items.map((it) => ({ tenantId: user.tenantId, assetId: it.asset.id, period: p, amount: it.amount.toFixed(2), journalId: j.id })),
        );
        journals.push({ period: p, number: j.number, amount: total.toFixed(2), assets: items.length });
      }
      return { journals };
    };
    return txArg ? work(txArg) : this.db.transaction(work);
  }

  /** Riwayat penyusutan per bulan */
  async runs(tenantId: string) {
    const res = await this.db.execute<{ period: string; total: string; n: number; journal_id: string; number: string }>(sql`
      SELECT d.period, SUM(d.amount) AS total, COUNT(*)::int AS n, MIN(j.id::text) AS journal_id, MIN(j.number) AS number
      FROM asset_depreciations d LEFT JOIN journal_entries j ON j.id = d.journal_id
      WHERE d.tenant_id = ${tenantId} GROUP BY d.period ORDER BY d.period DESC`);
    return res.rows.map((r) => ({ ...r, total: D(r.total).toFixed(2) }));
  }

  /**
   * Pelepasan / penjualan aset: susutkan s/d bulan sebelum pelepasan, lalu
   * Dr Kas (harga jual) + Dr Akumulasi | Cr Aset (harga perolehan) ± Laba/Rugi pelepasan.
   */
  assetSettings(tenantId: string) {
    return this.settings.section(this.db, tenantId, 'assets', DEFAULT_ASSET_SETTINGS);
  }
  saveAssetSettings(tenantId: string, patch: Partial<typeof DEFAULT_ASSET_SETTINGS>) {
    return this.settings.saveSection(this.db, tenantId, 'assets', DEFAULT_ASSET_SETTINGS, patch);
  }

  /** Catat hasil pemeriksaan fisik satu aset (tercatat di jejak audit) */
  async verify(user: AuthUser, id: string, dto: VerifyDto) {
    const [a] = await this.db
      .update(fixedAssets)
      .set({ lastVerifiedAt: new Date(), verificationStatus: dto.status, verificationNote: dto.note?.trim() || null, ...(dto.location?.trim() ? { location: dto.location.trim() } : {}) })
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId), eq(fixedAssets.status, 'ACTIVE')))
      .returning();
    if (!a) throw new NotFoundException('Aset aktif tidak ditemukan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'VERIFY', entity: 'FixedAsset', entityId: id, data: { status: dto.status, note: dto.note } });
    return a;
  }

  /** Penyusutan otomatis: dipanggil penjadwal untuk semua perusahaan yang punya aset berpenyusutan */
  async autoDepreciateAll(logger: Logger) {
    const res = await this.db.execute<{ tenant_id: string }>(sql`
      SELECT DISTINCT tenant_id FROM fixed_assets WHERE status = 'ACTIVE' AND method <> 'NONE' AND useful_life_months > 0`);
    const prev = periodOf(monthIndex(todayJakarta().slice(0, 7)) - 1);
    for (const { tenant_id: tenantId } of res.rows) {
      try {
        if (!(await this.assetSettings(tenantId)).autoDepreciation) continue;
        const [owner] = await this.db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)))
          .limit(1);
        if (!owner) continue;
        const user: AuthUser = { sub: owner.id, tenantId, role: 'OWNER', email: owner.email };
        const r = await this.run(user, prev);
        if (r.journals.length) {
          await this.audit.log(this.db, { tenantId, userId: owner.id, action: 'AUTO_DEPRECIATION', entity: 'FixedAsset', entityId: tenantId, data: { upTo: prev, months: r.journals.length } });
          logger.log(`Penyusutan otomatis ${tenantId}: ${r.journals.length} bulan sampai ${prev}`);
        }
      } catch (e) {
        logger.warn(`Penyusutan otomatis gagal untuk ${tenantId}: ${(e as Error).message}`);
        void this.notifyAutoFailure(tenantId, prev, (e as Error).message);
      }
    }
  }

  private async notifyAutoFailure(tenantId: string, period: string, reason: string) {
    try {
      const owners = await this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)));
      await this.telegram.notifyUsers(owners.map((o) => o.id), `⚠️ Penyusutan otomatis ${period} gagal: ${reason}\nBuka Aset Tetap › Penyusutan untuk menjalankannya manual.`);
    } catch {
      /* pemberitahuan opsional */
    }
  }

  static accumulatedThrough = accumulatedThrough;
  static today = todayJakarta;
}

@Injectable()
export class AssetScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Aset');
  constructor(private readonly svc: AssetsService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.svc.autoDepreciateAll(this.logger).catch((e) => this.logger.error(e));
    setTimeout(run, 90_000).unref();
    this.timer = setInterval(run, 6 * 60 * 60_000); // tiap 6 jam; idempoten (hanya bulan yang belum diposting)
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
