import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Put,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { DEPRECIATION_METHOD_LABELS, DEPRECIATION_METHODS, FISCAL_ASSET_GROUPS, type FiscalAssetGroup } from '@sansu/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SettingsService } from '../../common/settings.service';
import { addDays, assertNotFarFuture, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, assetCategories, assetDepreciations, assetUsage, fixedAssets, users } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { frameworkOf } from '../accounting/coa-sync';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { accumulatedThrough, depreciationFor, fiscalDepreciation, lastDay, monthIndex, periodOf, type MethodChange } from './depreciation';

// ---------- DTO ----------
export class CategoryDto {
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty() @IsUUID() assetAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumulatedAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() expenseAccountId?: string;
  @ApiProperty({ enum: DEPRECIATION_METHODS }) @IsIn(DEPRECIATION_METHODS) method: string;
  @ApiProperty({ example: 96 }) @IsInt() @Min(0) @Max(600) usefulLifeMonths: number;
  @ApiProperty({ enum: FISCAL_ASSET_GROUPS }) @IsIn(FISCAL_ASSET_GROUPS) fiscalGroup: FiscalAssetGroup;
  @ApiPropertyOptional({ enum: ['STRAIGHT_LINE', 'DECLINING_BALANCE'] }) @IsOptional() @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE']) fiscalMethod?: string;
}
export class UpdateCategoryDto extends PartialType(CategoryDto) {}

export class TransferAssetBranchDto {
  @ApiPropertyOptional({ description: 'Cabang tujuan; kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional({ example: '2026-10-15' }) @IsOptional() @IsDateString() date?: string;
}

export class CreateAssetDto {
  @ApiPropertyOptional({ description: 'Cabang pemilik aset (penyusutan masuk laporan cabang itu); kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Kosong = otomatis AT-0001' }) @IsOptional() @IsString() @MaxLength(30) code?: string;
  @ApiProperty({ example: 'Truk Colt Diesel B 9123 XY' }) @IsString() @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: '2026-07-15' }) @IsDateString() acquisitionDate: string;
  @ApiProperty({ example: '240000000' }) @IsNumberString() cost: string;
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() residualValue?: string;
  @ApiPropertyOptional({ description: 'Kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional({ enum: DEPRECIATION_METHODS }) @IsOptional() @IsIn(DEPRECIATION_METHODS) method?: string;
  @ApiPropertyOptional({ example: '200000', description: 'Metode unit produksi: kapasitas total aset (wajib untuk metode itu)' }) @IsOptional() @IsNumberString() totalUnits?: string;
  @ApiPropertyOptional({ example: 'km', description: 'Satuan unit produksi (km, jam, unit, ...)' }) @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
  @ApiPropertyOptional({ description: 'Bulan mulai disusutkan; kosong = bulan perolehan' }) @IsOptional() @IsDateString() depreciationStart?: string;
  @ApiProperty({ enum: ['CASH', 'PAYABLE', 'EXISTING'], description: 'CASH = dibayar dari kas/bank, PAYABLE = utang lain-lain, EXISTING = aset lama (tanpa jurnal)' })
  @IsIn(['CASH', 'PAYABLE', 'EXISTING'])
  funding: 'CASH' | 'PAYABLE' | 'EXISTING';
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Aset lama: akumulasi penyusutan s/d sebelum mulai disusutkan di SANSU' }) @IsOptional() @IsNumberString() openingAccumulated?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Tetap kapitalisasi walau di bawah batas kapitalisasi perusahaan' })
  @IsOptional()
  @IsBoolean()
  ignoreCapitalizationThreshold?: boolean;
}

export class UpdateAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional({ description: 'Penanggung jawab aset' }) @IsOptional() @IsString() @MaxLength(120) custodian?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ChangeMethodDto {
  @ApiProperty({ enum: DEPRECIATION_METHODS.filter((m) => m !== 'NONE') }) @IsIn(DEPRECIATION_METHODS.filter((m) => m !== 'NONE')) method: string;
  @ApiPropertyOptional({ example: '2026-11', description: 'Bulan mulai berlaku (bawaan: bulan ini). Tidak boleh pada/ sebelum bulan yang sudah disusutkan.' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveMonth?: string;
  @ApiProperty({ description: 'Alasan perubahan (minimal 5 huruf)' }) @IsString() @MaxLength(300) reason: string;
}

export class MethodPreviewQuery {
  @ApiProperty() @IsIn(DEPRECIATION_METHODS.filter((m) => m !== 'NONE')) method: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveMonth?: string;
}

export class UsageDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiProperty({ example: '3500', description: 'Pemakaian bulan itu dalam satuan aset (km, jam, ...)' }) @IsNumberString() units: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RunDepreciationDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
}

export class DisposeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ example: '150000000', description: 'Harga jual (0 bila dihapus/rusak)' }) @IsNumberString() price: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
}

export class VerifyDto {
  @ApiProperty({ enum: ['FOUND', 'DAMAGED', 'MISSING'], description: 'Hasil pemeriksaan fisik' }) @IsIn(['FOUND', 'DAMAGED', 'MISSING']) status: 'FOUND' | 'DAMAGED' | 'MISSING';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'Lokasi terbaru bila berpindah' }) @IsOptional() @IsString() @MaxLength(120) location?: string;
}

export class RegisterFromJournalDto {
  @ApiProperty({ description: 'Jurnal yang mencatat pembelian aset (mis. kas keluar lama)' }) @IsUUID() journalId: string;
  @ApiProperty({ description: 'Akun aset tetap yang didebit di jurnal itu' }) @IsUUID() accountId: string;
  @ApiPropertyOptional({ description: 'Kategori aset (wajib bila akun dipakai >1 kategori)' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ example: 'Mobil operasional' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional({ description: 'Nilai yang didaftarkan; kosong = seluruh sisa yang belum jadi kartu aset' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ description: 'Masa manfaat (bulan); kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) location?: string;
  @ApiPropertyOptional({ example: '200000', description: 'Kategori bermetode unit produksi: kapasitas total aset (wajib untuk metode itu)' }) @IsOptional() @IsNumberString() totalUnits?: string;
  @ApiPropertyOptional({ example: 'km' }) @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
}

export class AssetSettingsDto {
  @ApiPropertyOptional({ description: 'Jalankan penyusutan bulan lalu otomatis' }) @IsOptional() @IsBoolean() autoDepreciation?: boolean;
}

/** Pengaturan aset tetap per perusahaan (disimpan di settings.assets) */
export const DEFAULT_ASSET_SETTINGS = { autoDepreciation: true };
/** Pelepasan aset berharga perolehan ≥ ini oleh selain Pemilik diberitahukan ke Pemilik */
const ASSET_ALERT_VALUE = 5_000_000;

type Asset = typeof fixedAssets.$inferSelect;
type Category = typeof assetCategories.$inferSelect;

// ---------- Service ----------
@Injectable()
export class AssetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly telegram: TelegramService,
  ) {}

  /** Tanah & kategori tak disusutkan selalu dikapitalisasi, berapa pun nilainya */
  isThresholdExempt(cat: { method: string; fiscalGroup: string }) {
    return cat.method === 'NONE' || cat.fiscalGroup === 'LAND';
  }

  listCategories(tenantId: string) {
    return this.db.query.assetCategories.findMany({
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
      const [a] = await this.db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
      if (!a || !a.isPostable) throw new BadRequestException('Akun kategori tidak valid');
    }
    if (dto.method && dto.method !== 'NONE' && (!dto.accumulatedAccountId || !dto.expenseAccountId)) {
      throw new BadRequestException('Kategori yang disusutkan wajib punya akun akumulasi & beban penyusutan');
    }
  }

  async createCategory(tenantId: string, dto: CategoryDto) {
    await this.assertAccounts(tenantId, dto);
    const [c] = await this.db.insert(assetCategories).values({ ...dto, tenantId }).returning();
    return c;
  }

  async updateCategory(user: AuthUser, id: string, dto: UpdateCategoryDto) {
    const tenantId = user.tenantId;
    const [cur] = await this.db.select().from(assetCategories).where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    if (!cur) throw new NotFoundException('Kategori tidak ditemukan');
    await this.assertAccounts(tenantId, { ...cur, ...dto } as CategoryDto);
    const [c] = await this.db.update(assetCategories).set(dto).where(eq(assetCategories.id, id)).returning();
    const diff = Object.entries(dto).filter(([k, v]) => v !== undefined && (cur as Record<string, unknown>)[k] !== v);
    if (diff.length) await this.audit.log(this.db, { tenantId, userId: user.sub, action: 'UPDATE', entity: 'AssetCategory', entityId: id, data: Object.fromEntries(diff.map(([k, v]) => [k, { from: (cur as Record<string, unknown>)[k], to: v }])) });
    return c;
  }

  /** Pemakaian per bulan semua aset (metode unit produksi): assetId → { 'YYYY-MM': unit } */
  private async loadUsage(db: Db | Tx, tenantId: string, assetId?: string) {
    const rows = await db.select().from(assetUsage).where(and(eq(assetUsage.tenantId, tenantId), assetId ? eq(assetUsage.assetId, assetId) : undefined));
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
    const cats = await this.listCategories(tenantId);
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
      const cats = await tx.select().from(assetCategories).where(and(eq(assetCategories.tenantId, user.tenantId), eq(assetCategories.assetAccountId, dto.accountId)));
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

  async reconciliation(tenantId: string, asOf?: string) {
    const date = toDocDate(asOf);
    const assets = (await this.list(tenantId, date)).filter((a) => a.acquisitionDate <= date);
    const cats = await this.listCategories(tenantId);
    type Acc = { id: string; code: string; name: string };
    const accs = new Map<string, { acc: Acc; kind: 'COST' | 'ACCUMULATED'; register: Dec }>();
    const bump = (acc: Acc | null | undefined, kind: 'COST' | 'ACCUMULATED', v: Dec) => {
      if (!acc) return;
      const k = `${kind}:${acc.id}`;
      const cur = accs.get(k) ?? { acc, kind, register: ZERO };
      cur.register = cur.register.plus(v);
      accs.set(k, cur);
    };
    for (const c of cats) {
      bump(c.assetAccount, 'COST', ZERO);
      bump(c.accumulatedAccount, 'ACCUMULATED', ZERO);
    }
    const catById = new Map(cats.map((c) => [c.id, c]));
    for (const a of assets) {
      const c = catById.get(a.categoryId);
      if (!c) continue;
      bump(c.assetAccount, 'COST', D(a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= date ? 0 : a.cost));
      bump(c.accumulatedAccount, 'ACCUMULATED', D(a.accumulated));
    }
    const ids = [...new Set([...accs.values()].map((x) => x.acc.id))];
    const gl = new Map<string, { debit: Dec; credit: Dec }>();
    if (ids.length) {
      const res = await this.db.execute<{ account_id: string; debit: string; credit: string }>(sql`
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND j.date <= ${date} AND l.account_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        GROUP BY l.account_id`);
      for (const r of res.rows) gl.set(r.account_id, { debit: D(r.debit), credit: D(r.credit) });
    }
    const rows = [...accs.values()].map((x) => {
      const g = gl.get(x.acc.id) ?? { debit: ZERO, credit: ZERO };
      const ledger = x.kind === 'COST' ? g.debit.minus(g.credit) : g.credit.minus(g.debit);
      const diff = ledger.minus(x.register);
      return { accountId: x.acc.id, code: x.acc.code, name: x.acc.name, kind: x.kind, register: x.register.toFixed(2), ledger: ledger.toFixed(2), diff: diff.toFixed(2) };
    });
    return { asOf: date, rows, mismatched: rows.filter((r) => D(r.diff).abs().gte(1)).length };
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

  private async postedTotals(db: DbOrTx, tenantId: string, upTo: string) {
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
      const [cat] = await tx.select().from(assetCategories).where(and(eq(assetCategories.id, dto.categoryId), eq(assetCategories.tenantId, user.tenantId)));
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
    const [before] = await this.db.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)));
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
    const [cat] = await tx.select().from(assetCategories).where(and(eq(assetCategories.id, a.categoryId), eq(assetCategories.tenantId, tenantId)));
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
    const [cat] = await tx.select().from(assetCategories).where(and(eq(assetCategories.id, a.categoryId), eq(assetCategories.tenantId, user.tenantId)));
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
    const cats = await tx.select().from(assetCategories).where(and(eq(assetCategories.tenantId, tenantId), inArray(assetCategories.assetAccountId, accountIds)));
    const m = new Map<string, Category[]>();
    for (const c of cats) m.set(c.assetAccountId, [...(m.get(c.assetAccountId) ?? []), c]);
    return m;
  }

  /** Kode aset otomatis berikutnya yang belum terpakai, mulai dari urutan `from` */
  async existingCodes(tenantId: string) {
    const rows = await this.db.select({ code: fixedAssets.code }).from(fixedAssets).where(eq(fixedAssets.tenantId, tenantId));
    return new Set(rows.map((r) => r.code.toUpperCase()));
  }

  async category(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [cat] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    return cat;
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
  // ---------------------------------------------------------------- kontrol & pemeriksaan fisik
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

  /**
   * Temuan kontrol aset tetap: penyusutan tertinggal, aset habis disusutkan tetapi masih aktif, aset tanpa penanggung jawab/lokasi,
   * aset yang belum diperiksa fisik >12 bulan, serta aset yang dilaporkan hilang/rusak.
   */
  async controls(tenantId: string) {
    const today = todayJakarta();
    const prev = periodOf(monthIndex(today.slice(0, 7)) - 1);
    const active = (await this.list(tenantId, today)).filter((a) => a.status === 'ACTIVE');
    const posted = await this.postedTotals(this.db, tenantId, '9999-12');
    type Finding = { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; assetIds: string[] };
    const out: Finding[] = [];
    const add = (key: string, level: Finding['level'], title: string, ids: string[], detail: string) => {
      if (ids.length) out.push({ key, level, title: `${title} (${ids.length})`, detail, assetIds: ids });
    };
    const names = (list: { code: string; name: string }[]) => list.slice(0, 5).map((a) => `${a.code} ${a.name}`).join(', ') + (list.length > 5 ? `, dan ${list.length - 5} lainnya` : '');

    const behind = active.filter((a) => {
      if (a.method === 'NONE' || a.usefulLifeMonths <= 0) return false;
      const acc = D(a.openingAccumulated).plus(posted.get(a.id)?.total ?? ZERO);
      const last = posted.get(a.id)?.last;
      const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), last ? monthIndex(last) + 1 : 0);
      return from <= monthIndex(prev) && !depreciationFor(a, acc, periodOf(from)).isZero();
    });
    add('DEP_BEHIND', 'warning', 'Penyusutan belum dijalankan sampai bulan lalu', behind.map((a) => a.id), `Jalankan penyusutan sampai ${prev}. ${names(behind)}`);

    const full = active.filter((a) => a.method !== 'NONE' && D(a.accumulated).gte(D(a.cost).minus(D(a.residualValue))) && D(a.cost).gt(0));
    add('FULLY_DEPRECIATED', 'info', 'Aset sudah habis disusutkan tetapi masih aktif', full.map((a) => a.id), `Jika sudah tidak dipakai, lepaskan agar daftar aset bersih. ${names(full)}`);

    const missing = active.filter((a) => a.verificationStatus === 'MISSING');
    add('MISSING', 'error', 'Aset dilaporkan tidak ditemukan', missing.map((a) => a.id), `Telusuri, lalu lepaskan sebagai rugi bila memang hilang. ${names(missing)}`);
    const damaged = active.filter((a) => a.verificationStatus === 'DAMAGED');
    add('DAMAGED', 'warning', 'Aset dilaporkan rusak', damaged.map((a) => a.id), `Pertimbangkan perbaikan atau pelepasan. ${names(damaged)}`);

    const noCustodian = active.filter((a) => !a.custodian?.trim());
    add('NO_CUSTODIAN', 'warning', 'Aset belum punya penanggung jawab', noCustodian.map((a) => a.id), names(noCustodian));
    const noLocation = active.filter((a) => !a.location?.trim());
    add('NO_LOCATION', 'info', 'Aset belum punya lokasi', noLocation.map((a) => a.id), names(noLocation));

    const cutoff = Date.now() - 365 * 86_400_000;
    const stale = active.filter((a) => a.category.fiscalGroup !== 'LAND' && (!a.lastVerifiedAt || new Date(a.lastVerifiedAt).getTime() < cutoff));
    add('NOT_VERIFIED', 'info', 'Aset belum diperiksa fisik dalam 12 bulan', stale.map((a) => a.id), `Lakukan pemeriksaan fisik berkala. ${names(stale)}`);

    const noUsage = active.filter((a) => a.method === 'UNITS_OF_PRODUCTION' && (a as { units?: { byPeriod: Record<string, number> } }).units?.byPeriod[prev] === undefined && a.depreciationStart.slice(0, 7) <= prev);
    add('USAGE_MISSING', 'warning', 'Pemakaian bulan lalu belum diisi (metode unit produksi)', noUsage.map((a) => a.id), `Tanpa catatan pemakaian, penyusutan bulan ${prev} tidak terhitung. ${names(noUsage)}`);

    // Pembelian peralatan kecil yang dibebankan karena di bawah batas kapitalisasi tetapi berulang tepat di bawah batas pada pemasok yang sama
    const { capitalizationThreshold: threshold } = await this.settings.reporting(this.db, tenantId);
    if (threshold > 0) {
      const small = await this.db.execute<{ supplier: string; n: number; total: string; first: string; last: string }>(sql`
        WITH lines AS (
          SELECT s.name AS supplier, j.date, l.debit
          FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
          JOIN purchase_invoices i ON i.id::text = j.source_id AND j.source_type = 'PURCHASE_INVOICE' JOIN suppliers s ON s.id = i.supplier_id
          WHERE j.tenant_id = ${tenantId} AND a.system_key = 'SMALL_ASSET_EXPENSE' AND l.debit >= ${threshold * 0.7} AND l.debit < ${threshold}
            AND j.date >= ${addDays(today, -60)}
        )
        SELECT a.supplier, COUNT(*)::int AS n, SUM(a.debit)::text AS total, MIN(a.date)::text AS first, MAX(a.date)::text AS last
        FROM lines a JOIN lines b ON b.supplier = a.supplier AND b.date BETWEEN a.date - 14 AND a.date + 14
        GROUP BY a.supplier HAVING COUNT(DISTINCT (a.date, a.debit)) >= 2 AND SUM(a.debit) >= ${threshold}`);
      out.push(...(small.rows.length ? [{ key: 'ASSET_SPLIT', level: 'warning' as const, title: `Pembelian di bawah batas kapitalisasi berulang pada pemasok yang sama (${small.rows.length})`, detail: `Beberapa barang masing-masing ≥ 70% dari batas Rp${threshold.toLocaleString('id-ID')} tetapi di bawahnya, dibeli dari pemasok yang sama dalam 14 hari dan dibebankan, bukan dicatat sebagai aset. Bisa wajar (banyak barang kecil) atau pembelian aset yang dipecah agar langsung menjadi beban.`, assetIds: small.rows.map((r) => `${r.supplier}: ${r.n} baris, total Rp${Math.round(Number(r.total)).toLocaleString('id-ID')} (${r.first} s/d ${r.last})`) }] : []));
    }

    // Pelepasan 180 hari terakhir: segera setelah dibeli, atau harga lepas jauh di bawah nilai buku
    const disposed = await this.db.execute<{ code: string; name: string; acq: string; disp: string; cost: string; opening: string; dep: string; price: string }>(sql`
      SELECT f.code, f.name, f.acquisition_date::text AS acq, f.disposal_date::text AS disp, f.cost::text AS cost, f.opening_accumulated::text AS opening, f.disposal_price::text AS price,
        COALESCE((SELECT SUM(d.amount) FROM asset_depreciations d WHERE d.asset_id = f.id), 0)::text AS dep
      FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.status = 'DISPOSED' AND f.disposal_date >= ${addDays(today, -180)}
      ORDER BY f.disposal_date DESC`);
    const quick = disposed.rows.filter((r) => diffDays(r.acq, r.disp) <= 90);
    out.push(...(quick.length ? [{ key: 'DISPOSE_QUICK', level: 'warning' as const, title: `Aset dilepas ≤ 90 hari setelah dibeli (${quick.length})`, detail: 'Aset baru dibeli lalu cepat dilepas bisa berarti pembelian fiktif atau barang dialihkan. Periksa dokumen pembelian dan pembelinya.', assetIds: quick.map((r) => `${r.code} ${r.name} (beli ${r.acq}, lepas ${r.disp})`) }] : []));
    const low = disposed.rows.filter((r) => {
      const book = D(r.cost).minus(r.opening).minus(r.dep).toNumber();
      return book >= 1_000_000 && Number(r.price) < book * 0.5;
    });
    out.push(...(low.length ? [{ key: 'DISPOSE_LOW_PRICE', level: 'warning' as const, title: `Aset dilepas jauh di bawah nilai buku (${low.length})`, detail: 'Harga lepas kurang dari separuh nilai buku (atau nol). Pastikan ada alasan (rusak/hilang), bukti, dan pembelinya bukan pihak terkait.', assetIds: low.map((r) => `${r.code} ${r.name} harga Rp${Math.round(Number(r.price)).toLocaleString('id-ID')}`) }] : []));

    const pol = await this.approvals.policy(this.db, tenantId);
    const setup = {
      active: pol.assetDisposal > 0,
      message: 'Batas persetujuan pelepasan aset masih 0 (mati): aset berapa pun nilainya bisa dilepas oleh staf tanpa persetujuan Pemilik/Admin.',
      recommended: { assetDisposal: 5_000_000 },
      recommendedText: 'pelepasan aset ≥ Rp5 juta butuh persetujuan',
    };
    return { generatedAt: new Date().toISOString(), count: out.length, items: out, setup };
  }

  /** Catatan pemakaian bulanan (metode unit produksi) */
  async usageList(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [a] = await db.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
    const rows = await db.select().from(assetUsage).where(and(eq(assetUsage.tenantId, tenantId), eq(assetUsage.assetId, id))).orderBy(asc(assetUsage.period));
    const total = rows.reduce((t, r) => t.plus(r.units), ZERO);
    return { method: a.method, totalUnits: a.totalUnits, unitLabel: a.unitLabel, usedUnits: total.toFixed(4), remainingUnits: D(a.totalUnits ?? 0).minus(total).toFixed(4), rows };
  }

  /**
   * Catat (atau koreksi) pemakaian satu bulan. Hanya untuk bulan yang belum disusutkan; total pemakaian tidak boleh melebihi kapasitas.
   * Staf Gudang/Produksi tidak punya akses: pemakaian menentukan beban penyusutan, jadi dicatat Admin/Akuntan dan terekam di jejak audit.
   */
  async setUsage(user: AuthUser, id: string, dto: UsageDto) {
    const units = D(dto.units);
    if (units.lt(0)) throw new BadRequestException('Pemakaian tidak boleh negatif');
    return this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)) });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.method !== 'UNITS_OF_PRODUCTION') throw new BadRequestException('Aset ini tidak memakai metode unit produksi');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (dto.period < a.depreciationStart.slice(0, 7)) throw new BadRequestException('Bulan sebelum penyusutan dimulai');
      if (dto.period > todayJakarta().slice(0, 7)) throw new BadRequestException('Pemakaian bulan depan belum bisa dicatat');
      const last = (await this.postedTotals(tx, user.tenantId, '9999-12')).get(a.id)?.last;
      if (last && dto.period <= last) throw new BadRequestException(`Penyusutan sudah diposting sampai ${last}; pemakaian bulan itu tidak bisa diubah.`);
      const [existing] = await tx.select().from(assetUsage).where(and(eq(assetUsage.assetId, id), eq(assetUsage.period, dto.period)));
      const others = (await tx.select().from(assetUsage).where(eq(assetUsage.assetId, id))).filter((r) => r.period !== dto.period).reduce((t, r) => t.plus(r.units), ZERO);
      if (others.plus(units).gt(D(a.totalUnits ?? 0))) throw new BadRequestException(`Total pemakaian melebihi kapasitas ${D(a.totalUnits ?? 0).toFixed(0)} ${a.unitLabel ?? 'unit'}`);
      if (existing) await tx.update(assetUsage).set({ units: units.toFixed(4), note: dto.note ?? null, createdById: user.sub }).where(eq(assetUsage.id, existing.id));
      else await tx.insert(assetUsage).values({ tenantId: user.tenantId, assetId: id, period: dto.period, units: units.toFixed(4), note: dto.note ?? null, createdById: user.sub });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: existing ? 'UPDATE' : 'CREATE', entity: 'AssetUsage', entityId: id, data: { period: dto.period, units: units.toFixed(4), previous: existing?.units ?? null } });
      return this.usageList(user.tenantId, id, tx);
    });
  }

  /**
   * Ubah metode penyusutan satu aset: berlaku ke depan saja (tidak pernah mundur). Penyusutan sampai bulan sebelum bulan berlaku
   * diposting dulu dengan metode lama; sisa nilai buku (dikurangi residu) lalu disusutkan dengan metode baru selama sisa masa manfaat.
   * Staf selain Pemilik/Admin: menunggu persetujuan. Pemilik diberi tahu bila diubah orang lain.
   */
  async changeMethod(user: AuthUser, id: string, dto: ChangeMethodDto, opts: { approved?: boolean; silent?: boolean } = {}) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Isi alasan perubahan metode (minimal 5 huruf)');
    if (dto.method === 'NONE') throw new BadRequestException('Aset yang disusutkan tidak bisa diubah menjadi "tidak disusutkan"; lepaskan asetnya bila sudah tidak dipakai.');
    if (dto.method === 'UNITS_OF_PRODUCTION') throw new BadRequestException('Metode unit produksi butuh total unit dan catatan pemakaian sejak awal; tidak bisa dipilih untuk aset yang sudah berjalan. Daftarkan aset baru dengan metode itu.');
    const pre = await this.db.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)) });
    if (!pre) throw new NotFoundException('Aset tidak ditemukan');
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, { kind: 'ASSET_METHOD', refId: id, title: `Ubah metode penyusutan ${pre.code} ${pre.name}`, amount: D(pre.cost).toNumber(), payload: JSON.parse(JSON.stringify({ id, ...dto })) });
      throw this.approvals.required(req.id, 'Perubahan metode penyusutan menunggu persetujuan pemilik atau admin; permintaan dikirim dan metode diubah setelah disetujui.');
    }
    const effective = dto.effectiveMonth ?? todayJakarta().slice(0, 7);
    const res = await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)) });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (a.method === 'NONE') throw new BadRequestException('Aset ini tidak disusutkan (mis. tanah)');
      if (a.method === dto.method) throw new BadRequestException('Metode baru sama dengan metode sekarang');
      if (a.method === 'UNITS_OF_PRODUCTION') throw new BadRequestException('Aset dengan metode unit produksi tidak bisa dipindah ke metode lain; riwayat pemakaiannya menjadi dasar penyusutan.');
      if (effective < a.depreciationStart.slice(0, 7)) throw new BadRequestException('Bulan berlaku sebelum penyusutan dimulai');
      if (effective > todayJakarta().slice(0, 7)) throw new BadRequestException('Bulan berlaku tidak boleh di masa depan');
      const lastChange = [...(a.methodChanges ?? [])].sort((x, y) => y.from.localeCompare(x.from))[0];
      if (lastChange && effective <= lastChange.from) throw new BadRequestException(`Metode sudah pernah diubah berlaku ${lastChange.from}; bulan berlaku harus sesudahnya`);
      const last = (await this.postedTotals(tx, user.tenantId, '9999-12')).get(a.id)?.last;
      if (last && effective <= last) throw new BadRequestException(`Penyusutan sudah diposting sampai ${last}; perubahan metode hanya berlaku ke depan, mulai ${periodOf(monthIndex(last) + 1)} atau sesudahnya.`);
      // Susutkan dulu sampai bulan sebelum bulan berlaku dengan metode lama
      await this.run(user, periodOf(monthIndex(effective) - 1), a.id, tx);
      const [p] = (await tx.execute<{ total: string }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${a.id}`)).rows;
      const acc = D(a.openingAccumulated).plus(p.total);
      if (D(a.cost).minus(acc).minus(a.residualValue).lte(0)) throw new BadRequestException('Aset sudah habis disusutkan; tidak ada lagi yang perlu diubah metodenya');
      if (a.usefulLifeMonths - (monthIndex(effective) - monthIndex(a.depreciationStart.slice(0, 7))) <= 0) throw new BadRequestException('Masa manfaat aset sudah lewat');
      const change: MethodChange = { from: effective, method: dto.method, prevMethod: a.method, accumulatedAt: acc.toFixed(2) };
      await tx.update(fixedAssets).set({ method: dto.method, methodChanges: [...(a.methodChanges ?? []), change] }).where(eq(fixedAssets.id, a.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CHANGE_METHOD', entity: 'FixedAsset', entityId: a.id, data: { from: a.method, to: dto.method, effective, reason, accumulated: acc.toFixed(2), bookValue: D(a.cost).minus(acc).toFixed(2) } });
      return { name: `${a.code} ${a.name}`, from: a.method, to: dto.method };
    });
    if (!opts.silent && user.role !== 'OWNER') {
      void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Metode penyusutan diubah: ${res.name}`, lines: [`${DEPRECIATION_METHOD_LABELS[res.from as keyof typeof DEPRECIATION_METHOD_LABELS] ?? res.from} → ${DEPRECIATION_METHOD_LABELS[res.to as keyof typeof DEPRECIATION_METHOD_LABELS] ?? res.to}, berlaku ${effective}`, `Alasan: ${reason}`], path: '/fixed-assets' });
    }
    return this.get(user.tenantId, id);
  }

  /** Pratinjau 12 bulan: penyusutan per bulan dengan metode sekarang vs metode baru (tanpa menyimpan apa pun) */
  async methodPreview(tenantId: string, id: string, method: string, effectiveMonth?: string) {
    const a = await this.db.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)) });
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
    if (a.status !== 'ACTIVE' || a.method === 'NONE') throw new BadRequestException('Aset ini tidak disusutkan atau sudah dilepas');
    if (a.method === 'UNITS_OF_PRODUCTION' || method === 'UNITS_OF_PRODUCTION') throw new BadRequestException('Pratinjau tidak tersedia untuk metode unit produksi: penyusutannya mengikuti pemakaian.');
    const effective = effectiveMonth ?? todayJakarta().slice(0, 7);
    const posted = (await this.postedTotals(this.db, tenantId, '9999-12')).get(a.id);
    let acc = D(a.openingAccumulated).plus(posted?.total ?? ZERO);
    const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), posted?.last ? monthIndex(posted.last) + 1 : 0);
    if (posted?.last && monthIndex(effective) <= monthIndex(posted.last)) throw new BadRequestException(`Penyusutan sudah diposting sampai ${posted.last}; bulan berlaku harus sesudahnya`);
    for (let i = from; i < monthIndex(effective); i++) acc = acc.plus(depreciationFor(a, acc, periodOf(i)));
    const proposed = { ...a, methodChanges: [...(a.methodChanges ?? []), { from: effective, method, prevMethod: a.method, accumulatedAt: acc.toFixed(2) }] };
    let accCur = acc;
    let accNew = acc;
    const rows: { period: string; current: string; proposed: string }[] = [];
    for (let i = monthIndex(effective); i < monthIndex(effective) + 12; i++) {
      const cur = depreciationFor(a, accCur, periodOf(i));
      const nw = depreciationFor(proposed, accNew, periodOf(i));
      accCur = accCur.plus(cur);
      accNew = accNew.plus(nw);
      rows.push({ period: periodOf(i), current: cur.toFixed(2), proposed: nw.toFixed(2) });
    }
    const sum = (k: 'current' | 'proposed') => rows.reduce((t, r) => t.plus(r[k]), ZERO).toFixed(2);
    return { effectiveMonth: effective, bookValueAtEffective: D(a.cost).minus(acc).toFixed(2), rows, total12: { current: sum('current'), proposed: sum('proposed') } };
  }

  /** Ubah metode untuk semua aset aktif satu kategori (ke depan saja) dan jadikan metode bawaan aset baru di kategori itu */
  async changeCategoryMethod(user: AuthUser, categoryId: string, dto: ChangeMethodDto, opts: { approved?: boolean } = {}) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Isi alasan perubahan metode (minimal 5 huruf)');
    const [cat] = await this.db.select().from(assetCategories).where(and(eq(assetCategories.id, categoryId), eq(assetCategories.tenantId, user.tenantId)));
    if (!cat) throw new NotFoundException('Kategori tidak ditemukan');
    if (cat.method === 'NONE') throw new BadRequestException('Kategori ini tidak disusutkan (mis. tanah)');
    if (dto.method === 'UNITS_OF_PRODUCTION') throw new BadRequestException('Metode unit produksi tidak bisa diterapkan ke aset yang sudah ada (butuh total unit per aset).');
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, { kind: 'ASSET_METHOD', refId: categoryId, title: `Ubah metode penyusutan kategori ${cat.name}`, amount: 0, payload: JSON.parse(JSON.stringify({ categoryId, ...dto })) });
      throw this.approvals.required(req.id, 'Perubahan metode penyusutan menunggu persetujuan pemilik atau admin; permintaan dikirim dan metode diubah setelah disetujui.');
    }
    const list = await this.db.query.fixedAssets.findMany({ where: and(eq(fixedAssets.tenantId, user.tenantId), eq(fixedAssets.categoryId, categoryId), eq(fixedAssets.status, 'ACTIVE')) });
    const changed: string[] = [];
    const skipped: { asset: string; why: string }[] = [];
    for (const a of list) {
      if (a.method === 'NONE' || a.method === dto.method || a.method === 'UNITS_OF_PRODUCTION') continue;
      try {
        await this.changeMethod(user, a.id, dto, { approved: true, silent: true });
        changed.push(`${a.code} ${a.name}`);
      } catch (e) {
        skipped.push({ asset: `${a.code} ${a.name}`, why: (e as Error).message });
      }
    }
    await this.db.update(assetCategories).set({ method: dto.method }).where(eq(assetCategories.id, categoryId));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CHANGE_METHOD', entity: 'AssetCategory', entityId: categoryId, data: { from: cat.method, to: dto.method, effective: dto.effectiveMonth ?? todayJakarta().slice(0, 7), reason, changed: changed.length, skipped: skipped.length } });
    if (user.role !== 'OWNER') {
      void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Metode penyusutan kategori ${cat.name} diubah`, lines: [`${changed.length} aset diubah, ${skipped.length} dilewati`, `Alasan: ${reason}`], path: '/fixed-assets' });
    }
    return { changed, skipped };
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

  /**
   * Pindahkan aset ke cabang lain: harga perolehan dan akumulasi penyusutan berpindah cabang; selisihnya (nilai buku) ditutup
   * Rekening Antar Cabang otomatis, nol saat digabung. Penyusutan berikutnya masuk cabang baru.
   */
  async transferBranch(user: AuthUser, id: string, dto: TransferAssetBranchDto) {
    const target = dto.branchId ?? null;
    const date = toDocDate(dto.date);
    let notice: { name: string; cost: Dec; bookValue: Dec; price: Dec } | null = null;
    await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)), with: { category: true } });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if ((a.branchId ?? null) === target) throw new BadRequestException('Aset sudah berada di cabang itu');
      if (target) {
        const [b] = (await tx.execute<{ id: string }>(sql`SELECT id FROM branches WHERE id = ${target} AND tenant_id = ${user.tenantId} AND is_active`)).rows;
        if (!b) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
      }
      if (date < a.acquisitionDate) throw new BadRequestException('Tanggal pindah sebelum tanggal perolehan');
      // penyusutan sampai bulan sebelumnya dibukukan di cabang lama dulu
      await this.run(user, periodOf(monthIndex(date.slice(0, 7)) - 1), a.id, tx);
      const [p] = (await tx.execute<{ total: string }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${a.id}`)).rows;
      const accumulated = D(a.openingAccumulated).plus(p.total);
      const cost = D(a.cost);
      const from = a.branchId ?? null;
      const lines: Parameters<PostingService['post']>[1]['lines'] = [
        { accountId: a.category.assetAccountId, credit: cost, branchId: from },
        { accountId: a.category.assetAccountId, debit: cost, branchId: target },
      ];
      if (accumulated.gt(0)) {
        if (!a.category.accumulatedAccountId) throw new BadRequestException('Kategori tanpa akun akumulasi');
        lines.push({ accountId: a.category.accumulatedAccountId, debit: accumulated, branchId: from }, { accountId: a.category.accumulatedAccountId, credit: accumulated, branchId: target });
      }
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pindah cabang aset ${a.code} ${a.name}`,
        sourceType: 'ASSET_TRANSFER',
        sourceId: `${a.id}:${date}`,
        createdById: user.sub,
        lines,
      });
      await tx.update(fixedAssets).set({ branchId: target }).where(eq(fixedAssets.id, a.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'TRANSFER_BRANCH', entity: 'FixedAsset', entityId: a.id, data: { from, to: target, journal: j.number } });
    });
    return this.get(user.tenantId, id);
  }

  async dispose(user: AuthUser, id: string, dto: DisposeDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    if (!opts.approved) {
      // Pelepasan aset di atas batas nilai buku/harga perolehan perlu persetujuan (peran selain pemilik/admin)
      const asset = await this.db.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)) });
      if (asset?.status === 'ACTIVE') {
        const amount = D(asset.cost).toNumber();
        const limit = await this.approvals.needs(this.db, user, 'ASSET_DISPOSAL', amount);
        if (limit !== null) {
          const req = await this.approvals.create(this.db, user, {
            kind: 'ASSET_DISPOSAL',
            refId: id,
            title: `Pelepasan aset ${asset.code} ${asset.name}`,
            amount,
            payload: JSON.parse(JSON.stringify({ id, ...dto })),
          });
          throw this.approvals.required(req.id, 'Pelepasan aset ini mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan dijalankan setelah disetujui.');
        }
      }
    }
    let notice: { name: string; cost: Dec; bookValue: Dec; price: Dec } | null = null;
    await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)), with: { category: true } });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (date < a.acquisitionDate) throw new BadRequestException('Tanggal pelepasan sebelum tanggal perolehan');
      const prevPeriod = periodOf(monthIndex(date.slice(0, 7)) - 1);
      await this.run(user, prevPeriod, a.id, tx);
      const [p] = (
        await tx.execute<{ total: string }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${a.id}`)
      ).rows;
      const accumulated = D(a.openingAccumulated).plus(p.total);
      const cost = D(a.cost);
      const price = money(dto.price);
      const bookValue = cost.minus(accumulated);
      const gain = price.minus(bookValue);
      const ab = a.branchId ?? null;
      const lines: Parameters<PostingService['post']>[1]['lines'] = [{ accountId: a.category.assetAccountId, credit: cost, branchId: ab }];
      if (accumulated.gt(0)) {
        if (!a.category.accumulatedAccountId) throw new BadRequestException('Kategori tanpa akun akumulasi');
        lines.push({ accountId: a.category.accumulatedAccountId, debit: accumulated, branchId: ab });
      }
      if (price.gt(0)) {
        const cashAcc = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
        lines.push({ accountId: cashAcc.id, debit: price, branchId: cashAcc.branchId ?? ab });
      }
      if (gain.gt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_GAIN, credit: gain, branchId: ab });
      if (gain.lt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_LOSS, debit: gain.abs(), branchId: ab });
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pelepasan aset ${a.code} ${a.name} (nilai buku ${bookValue.toFixed(0)}, ${gain.gte(0) ? 'laba' : 'rugi'} ${gain.abs().toFixed(0)})`,
        sourceType: 'ASSET_DISPOSAL',
        sourceId: a.id,
        createdById: user.sub,
        lines,
      });
      await tx
        .update(fixedAssets)
        .set({ status: 'DISPOSED', disposalDate: date, disposalPrice: price.toFixed(2), disposalJournalId: j.id })
        .where(eq(fixedAssets.id, a.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'DISPOSE', entity: 'FixedAsset', entityId: a.id, data: { gain: gain.toFixed(2), price: price.toFixed(2), cost: cost.toFixed(2), bookValue: bookValue.toFixed(2) } });
      notice = { name: `${a.code} ${a.name}`, cost, bookValue, price };
    });
    // Pemilik diberi tahu bila aset bernilai besar dilepas oleh orang lain (pelepasan adalah jalan umum memindahkan aset keluar)
    const n = notice as { name: string; cost: Dec; bookValue: Dec; price: Dec } | null;
    if (n && user.role !== 'OWNER' && n.cost.toNumber() >= ASSET_ALERT_VALUE) {
      const rp = (d: Dec) => `Rp${Math.round(d.toNumber()).toLocaleString('id-ID')}`;
      void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Aset dilepas: ${n.name}`, lines: [`Harga perolehan ${rp(n.cost)} · nilai buku ${rp(n.bookValue)} · harga lepas ${rp(n.price)}`], path: '/fixed-assets' });
    }
    return this.get(user.tenantId, id);
  }

  /**
   * Mutasi aset tetap per kategori dalam satu tahun (tabel CALK):
   * saldo awal, penambahan, pengurangan, saldo akhir — untuk harga perolehan & akumulasi penyusutan.
   */
  async rollForward(tenantId: string, year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const assets = await this.db.query.fixedAssets.findMany({ where: eq(fixedAssets.tenantId, tenantId), with: { category: true } });
    const dep = await this.db.execute<{ asset_id: string; before: string; during: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period < ${`${year}-01`}), 0) AS before,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
    const depBy = new Map(dep.rows.map((r) => [r.asset_id, r]));
    type Row = { category: string; costOpen: Dec; costAdd: Dec; costDisp: Dec; accOpen: Dec; accAdd: Dec; accDisp: Dec };
    const rows = new Map<string, Row>();
    for (const a of assets) {
      const r = rows.get(a.categoryId) ?? { category: a.category.name, costOpen: ZERO, costAdd: ZERO, costDisp: ZERO, accOpen: ZERO, accAdd: ZERO, accDisp: ZERO };
      const cost = D(a.cost);
      const d = depBy.get(a.id);
      const accBefore = D(a.openingAccumulated).plus(d?.before ?? 0);
      const accDuring = D(d?.during ?? 0);
      if (a.acquisitionDate < from) {
        if (!(a.disposalDate && a.disposalDate < from)) {
          r.costOpen = r.costOpen.plus(cost);
          r.accOpen = r.accOpen.plus(accBefore);
        }
      } else if (a.acquisitionDate <= to) {
        r.costAdd = r.costAdd.plus(cost);
        // akumulasi awal aset lama yang baru didaftarkan dianggap penambahan akumulasi
        r.accAdd = r.accAdd.plus(D(a.openingAccumulated));
      }
      r.accAdd = r.accAdd.plus(accDuring);
      if (a.disposalDate && a.disposalDate >= from && a.disposalDate <= to) {
        r.costDisp = r.costDisp.plus(cost);
        r.accDisp = r.accDisp.plus(accBefore.plus(accDuring));
      }
      rows.set(a.categoryId, r);
    }
    const f = (d: Dec) => d.toFixed(2);
    return [...rows.values()].map((r) => {
      const costClose = r.costOpen.plus(r.costAdd).minus(r.costDisp);
      const accClose = r.accOpen.plus(r.accAdd).minus(r.accDisp);
      return {
        category: r.category,
        cost: { opening: f(r.costOpen), additions: f(r.costAdd), disposals: f(r.costDisp), closing: f(costClose) },
        accumulated: { opening: f(r.accOpen), additions: f(r.accAdd), disposals: f(r.accDisp), closing: f(accClose) },
        bookValue: { opening: f(r.costOpen.minus(r.accOpen)), closing: f(costClose.minus(accClose)) },
      };
    });
  }

  /** Penyusutan komersial vs fiskal per aset untuk satu tahun (bahan koreksi fiskal & pajak tangguhan) */
  async fiscalComparison(tenantId: string, year: number) {
    const assets = await this.db.query.fixedAssets.findMany({ where: eq(fixedAssets.tenantId, tenantId), with: { category: true } });
    const dep = await this.db.execute<{ asset_id: string; during: string; upto: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during,
             COALESCE(SUM(amount) FILTER (WHERE period <= ${`${year}-12`}), 0) AS upto
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
    const depBy = new Map(dep.rows.map((r) => [r.asset_id, r]));
    return assets
      .filter((a) => a.acquisitionDate <= `${year}-12-31` && !(a.disposalDate && a.disposalDate < `${year}-01-01`))
      .map((a) => {
        const fiscal = fiscalDepreciation(a.cost, a.acquisitionDate, a.category.fiscalGroup as FiscalAssetGroup, a.category.fiscalMethod, year, a.disposalDate);
        const commercial = D(depBy.get(a.id)?.during ?? 0);
        const disposed = !!(a.disposalDate && a.disposalDate <= `${year}-12-31`);
        const commercialAcc = D(a.openingAccumulated).plus(depBy.get(a.id)?.upto ?? 0);
        // Aset dilepas tahun ini: beda nilai buku komersial vs fiskal saat pelepasan = beda laba/rugi pelepasan
        const disposedThisYear = !!(a.disposalDate && a.disposalDate.startsWith(String(year)));
        const disposalDifference = disposedThisYear ? D(a.cost).minus(commercialAcc).minus(D(a.cost).minus(fiscal.accumulatedEnd)) : ZERO;
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          category: a.category.name,
          fiscalGroup: a.category.fiscalGroup,
          cost: a.cost,
          commercial: commercial.toFixed(2),
          fiscal: fiscal.amount.toFixed(2),
          difference: commercial.minus(fiscal.amount).toFixed(2),
          // Nilai buku akhir tahun (untuk pajak tangguhan); aset yang sudah dilepas = 0
          commercialBookValue: disposed ? '0.00' : D(a.cost).minus(commercialAcc).toFixed(2),
          fiscalBookValue: disposed ? '0.00' : D(a.cost).minus(fiscal.accumulatedEnd).toFixed(2),
          /** + = laba fiskal pelepasan lebih besar (koreksi positif) */
          disposalDifference: disposalDifference.toFixed(2),
        };
      });
  }

  /** Total register (untuk cek kesehatan: buku besar vs daftar aset) */
  async registerTotals(tenantId: string, asOf: string) {
    const list = await this.list(tenantId, asOf);
    const active = list.filter((a) => a.acquisitionDate <= asOf && !(a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= asOf));
    return {
      cost: active.reduce<Dec>((s, a) => s.plus(a.cost), ZERO),
      accumulated: active.reduce<Dec>((s, a) => s.plus(a.accumulated), ZERO),
      count: active.length,
      pendingPeriods: active.filter((a) => a.method !== 'NONE' && !D(a.monthlyEstimate).isZero() && (!a.lastDepreciation || a.lastDepreciation < asOf.slice(0, 7))).length,
    };
  }

  static accumulatedThrough = accumulatedThrough;
  static today = todayJakarta;
}

// ---------- Controller ----------
@ApiTags('Aset tetap')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('assets')
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('categories')
  categories(@CurrentUser() u: AuthUser) {
    return this.svc.listCategories(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) {
    return this.svc.createCategory(u.tenantId, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('categories/:id')
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('depreciation/runs')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.runs(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('depreciation/run')
  run(@CurrentUser() u: AuthUser, @Body() dto: RunDepreciationDto) {
    return this.svc.run(u, dto.period);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/roll-forward')
  rollForward(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.rollForward(u.tenantId, Number(year) || new Date().getFullYear());
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/fiscal')
  fiscal(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.fiscalComparison(u.tenantId, Number(year) || new Date().getFullYear());
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  assetSettings(@CurrentUser() u: AuthUser) {
    return this.svc.assetSettings(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Put('settings')
  saveAssetSettings(@CurrentUser() u: AuthUser, @Body() dto: AssetSettingsDto) {
    return this.svc.saveAssetSettings(u.tenantId, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('unregistered')
  unregistered(@CurrentUser() u: AuthUser) {
    return this.svc.unregistered(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('from-journal')
  fromJournal(@CurrentUser() u: AuthUser, @Body() dto: RegisterFromJournalDto) {
    return this.svc.registerFromJournal(u, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reconciliation')
  reconciliation(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.svc.reconciliation(u.tenantId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.svc.list(u.tenantId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssetDto) {
    return this.svc.create(u, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto) {
    return this.svc.update(u, id, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('categories/:id/change-method')
  changeCategoryMethod(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeMethodDto) {
    return this.svc.changeCategoryMethod(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id/method-preview')
  methodPreview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MethodPreviewQuery) {
    return this.svc.methodPreview(u.tenantId, id, q.method, q.effectiveMonth);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id/usage')
  usage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.usageList(u.tenantId, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id/usage')
  setUsage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UsageDto) {
    return this.svc.setUsage(u, id, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/change-method')
  changeMethod(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeMethodDto) {
    return this.svc.changeMethod(u, id, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    return this.svc.verify(u, id, dto);
  }
  @Roles('ADMIN')
  @Post(':id/transfer-branch')
  transferBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferAssetBranchDto) {
    return this.svc.transferBranch(u, id, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/dispose')
  dispose(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeDto) {
    return this.svc.dispose(u, id, dto);
  }
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

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetScheduler],
  exports: [AssetsService],
})
export class AssetsModule {}
