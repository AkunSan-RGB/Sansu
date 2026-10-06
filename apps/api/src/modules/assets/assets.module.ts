import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { DEPRECIATION_METHODS, FISCAL_ASSET_GROUPS, type FiscalAssetGroup } from '@sansu/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, assetCategories, assetDepreciations, fixedAssets } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { accumulatedThrough, fiscalDepreciation, lastDay, monthIndex, monthlyDepreciation, periodOf } from './depreciation';

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

export class CreateAssetDto {
  @ApiPropertyOptional({ description: 'Kosong = otomatis AT-0001' }) @IsOptional() @IsString() @MaxLength(30) code?: string;
  @ApiProperty({ example: 'Truk Colt Diesel B 9123 XY' }) @IsString() @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: '2026-07-15' }) @IsDateString() acquisitionDate: string;
  @ApiProperty({ example: '240000000' }) @IsNumberString() cost: string;
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() residualValue?: string;
  @ApiPropertyOptional({ description: 'Kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional({ enum: DEPRECIATION_METHODS }) @IsOptional() @IsIn(DEPRECIATION_METHODS) method?: string;
  @ApiPropertyOptional({ description: 'Bulan mulai disusutkan; kosong = bulan perolehan' }) @IsOptional() @IsDateString() depreciationStart?: string;
  @ApiProperty({ enum: ['CASH', 'PAYABLE', 'EXISTING'], description: 'CASH = dibayar dari kas/bank, PAYABLE = utang lain-lain, EXISTING = aset lama (tanpa jurnal)' })
  @IsIn(['CASH', 'PAYABLE', 'EXISTING'])
  funding: 'CASH' | 'PAYABLE' | 'EXISTING';
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Aset lama: akumulasi penyusutan s/d sebelum mulai disusutkan di SANSU' }) @IsOptional() @IsNumberString() openingAccumulated?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class RunDepreciationDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
}

export class DisposeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ example: '150000000', description: 'Harga jual (0 bila dihapus/rusak)' }) @IsNumberString() price: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
}

type Asset = typeof fixedAssets.$inferSelect;
type Category = typeof assetCategories.$inferSelect;

// ---------- Service ----------
@Injectable()
export class AssetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

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

  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    const [cur] = await this.db.select().from(assetCategories).where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    if (!cur) throw new NotFoundException('Kategori tidak ditemukan');
    await this.assertAccounts(tenantId, { ...cur, ...dto } as CategoryDto);
    const [c] = await this.db.update(assetCategories).set(dto).where(eq(assetCategories.id, id)).returning();
    return c;
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
    return rows.map((a) => this.withValues(a, posted.get(a.id), date));
  }

  private withValues(a: Asset & { category: { id: string; name: string; fiscalGroup: string } }, p: { total: Dec; last: string | null } | undefined, date: string) {
    const disposed = a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= date;
    const accumulated = disposed ? ZERO : D(a.openingAccumulated).plus(p?.total ?? ZERO);
    const cost = disposed ? ZERO : D(a.cost);
    const next = monthlyDepreciation(a, D(a.openingAccumulated).plus(p?.total ?? ZERO), date.slice(0, 7));
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
    const end = a.status === 'DISPOSED' && a.disposalDate ? monthIndex(a.disposalDate.slice(0, 7)) - 1 : start + Math.max(0, a.usefulLifeMonths - 1);
    for (let i = start; i <= end && a.method !== 'NONE'; i++) {
      const p = periodOf(i);
      const amt = postedMap.get(p) ?? monthlyDepreciation(a, acc, p);
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
      const cost = money(dto.cost);
      const residual = money(dto.residualValue ?? '0');
      if (cost.lte(0)) throw new BadRequestException('Harga perolehan harus > 0');
      if (residual.gte(cost)) throw new BadRequestException('Nilai residu harus lebih kecil dari harga perolehan');
      const opening = money(dto.openingAccumulated ?? '0');
      if (dto.funding !== 'EXISTING' && opening.gt(0)) throw new BadRequestException('Akumulasi awal hanya untuk aset lama');
      if (opening.gt(cost.minus(residual))) throw new BadRequestException('Akumulasi awal melebihi nilai yang dapat disusutkan');
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
      });
      if (dto.funding !== 'EXISTING') {
        const credit =
          dto.funding === 'CASH'
            ? { accountId: (await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK')).id, credit: cost }
            : { key: SYS.OTHER_PAYABLE, credit: cost };
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date: acquisitionDate,
          description: `Perolehan aset tetap ${asset.code} ${dto.name}`,
          sourceType: 'ASSET_ACQUISITION',
          sourceId: asset.id,
          createdById: user.sub,
          lines: [{ accountId: cat.assetAccountId, debit: cost }, credit],
        });
        await tx.update(fixedAssets).set({ acquisitionJournalId: j.id }).where(eq(fixedAssets.id, asset.id));
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FixedAsset', entityId: asset.id });
      return asset.id;
    });
    return this.get(user.tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateAssetDto) {
    const [a] = await this.db.update(fixedAssets).set(dto).where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId))).returning();
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
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
    },
  ) {
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
        method: a.method ?? cat.method,
        openingAccumulated: (a.opening ?? ZERO).toFixed(2),
        location: a.location,
        notes: a.notes,
        acquisitionJournalId: a.acquisitionJournalId,
        purchaseInvoiceId: a.purchaseInvoiceId,
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
    a: { categoryId: string; name: string; date: string; cost: Dec; usefulLifeMonths?: number; location?: string; journalId: string; purchaseInvoiceId: string; notes?: string },
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
    });
  }

  async category(tenantId: string, id: string) {
    const [cat] = await this.db.select().from(assetCategories).where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    return cat;
  }

  private async nextCode(tx: Tx, tenantId: string) {
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
      // per bulan → per kategori → nilai
      const plan = new Map<string, { cat: Category; asset: Asset; amount: Dec }[]>();
      for (const a of assets) {
        if (a.method === 'NONE' || a.usefulLifeMonths <= 0) continue;
        let acc = D(a.openingAccumulated).plus(posted.get(a.id)?.total ?? ZERO);
        const last = posted.get(a.id)?.last;
        const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), last ? monthIndex(last) + 1 : 0);
        for (let i = from; i <= monthIndex(period); i++) {
          const p = periodOf(i);
          const amt = monthlyDepreciation(a, acc, p);
          if (amt.isZero()) continue;
          acc = acc.plus(amt);
          plan.set(p, [...(plan.get(p) ?? []), { cat: a.category, asset: a, amount: amt }]);
        }
      }
      const journals: { period: string; number: string; amount: string; assets: number }[] = [];
      for (const p of [...plan.keys()].sort()) {
        const items = plan.get(p)!;
        const byCat = new Map<string, { cat: Category; amount: Dec }>();
        for (const it of items) {
          const cur = byCat.get(it.cat.id) ?? { cat: it.cat, amount: ZERO };
          byCat.set(it.cat.id, { cat: it.cat, amount: cur.amount.plus(it.amount) });
        }
        const lines = [...byCat.values()].flatMap(({ cat, amount }) => {
          if (!cat.accumulatedAccountId || !cat.expenseAccountId) throw new BadRequestException(`Kategori ${cat.name} belum punya akun penyusutan`);
          return [
            { accountId: cat.expenseAccountId, debit: amount, memo: cat.name },
            { accountId: cat.accumulatedAccountId, credit: amount, memo: cat.name },
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
  async dispose(user: AuthUser, id: string, dto: DisposeDto) {
    const date = toDocDate(dto.date);
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
      const lines: Parameters<PostingService['post']>[1]['lines'] = [{ accountId: a.category.assetAccountId, credit: cost }];
      if (accumulated.gt(0)) {
        if (!a.category.accumulatedAccountId) throw new BadRequestException('Kategori tanpa akun akumulasi');
        lines.push({ accountId: a.category.accumulatedAccountId, debit: accumulated });
      }
      if (price.gt(0)) lines.push({ accountId: (await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK')).id, debit: price });
      if (gain.gt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_GAIN, credit: gain });
      if (gain.lt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_LOSS, debit: gain.abs() });
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
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'DISPOSE', entity: 'FixedAsset', entityId: a.id, data: { gain: gain.toFixed(2) } });
    });
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
@Roles('ADMIN', 'FINANCE')
@Controller('assets')
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Get('categories')
  categories(@CurrentUser() u: AuthUser) {
    return this.svc.listCategories(u.tenantId);
  }
  @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) {
    return this.svc.createCategory(u.tenantId, dto);
  }
  @Patch('categories/:id')
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(u.tenantId, id, dto);
  }

  @Get('depreciation/runs')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.runs(u.tenantId);
  }
  @Post('depreciation/run')
  run(@CurrentUser() u: AuthUser, @Body() dto: RunDepreciationDto) {
    return this.svc.run(u, dto.period);
  }
  @Get('reports/roll-forward')
  rollForward(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.rollForward(u.tenantId, Number(year) || new Date().getFullYear());
  }
  @Get('reports/fiscal')
  fiscal(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.fiscalComparison(u.tenantId, Number(year) || new Date().getFullYear());
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.svc.list(u.tenantId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssetDto) {
    return this.svc.create(u, dto);
  }
  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto) {
    return this.svc.update(u.tenantId, id, dto);
  }
  @Post(':id/dispose')
  dispose(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeDto) {
    return this.svc.dispose(u, id, dto);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
