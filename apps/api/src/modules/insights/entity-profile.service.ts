/**
 * Wizard standar akuntansi & pajak: mengukur ukuran usaha dari pembukuan, merekomendasikan SAK EMKM / SAK EP,
 * skema PPh, dan status PKP, lalu menerapkannya sekaligus. Aturan rekomendasi ada di @sansu/shared
 * (fungsi murni yang sama dipakai tampilan untuk pratinjau).
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
  type EntityProfileInput,
  LEGAL_FORMS,
  type LegalForm,
  recommendProfile,
  REPORTING_FRAMEWORKS,
  type ReportingFramework,
  simplificationsFor,
  TAX_SCHEMES,
  type TaxScheme,
  TAX_REVENUE_LIMIT,
  FINAL_TAX_EXCLUDED_FORMS,
} from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SYS } from '../accounting/default-coa';
import { get, loadAccounts, natural, sumByAccount } from '../accounting/ledger-data';
import { AssetsService } from '../assets/assets.module';
import { refreshChartRelevance } from '../accounting/coa-sync';

export class EntityAnswersDto {
  @ApiProperty() @IsBoolean() publicAccountability: boolean;
  @ApiProperty({ enum: LEGAL_FORMS }) @IsIn(LEGAL_FORMS) legalForm: LegalForm;
  @ApiProperty({ description: 'Total aset di luar tanah & bangunan (Rp)' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e15) assets: number;
  @ApiProperty({ description: 'Peredaran bruto setahun (Rp)' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e15) revenue: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1980) @Max(2100) taxRegisteredYear?: number;
}

export class ApplyEntityProfileDto extends EntityAnswersDto {
  @ApiProperty({ enum: REPORTING_FRAMEWORKS }) @IsIn(REPORTING_FRAMEWORKS) framework: ReportingFramework;
  @ApiProperty({ enum: TAX_SCHEMES }) @IsIn(TAX_SCHEMES) taxScheme: TaxScheme;
  @ApiPropertyOptional({ description: 'Kosong = status PKP tidak diubah' }) @IsOptional() @IsBoolean() pkp?: boolean;
}

interface SavedProfile extends EntityProfileInput {
  taxRegisteredYear: number | null;
  appliedAt: string;
  appliedFramework: ReportingFramework;
  appliedTaxScheme: TaxScheme;
}

const LAND_BUILDING = ['LAND', 'BUILDING_PERMANENT', 'BUILDING_NON_PERMANENT'];

@Injectable()
export class EntityProfileService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  /** Peredaran bruto (penjualan neto + pendapatan lain) antara dua tanggal, dari buku besar; jurnal penutup tidak dihitung */
  async revenueBetween(tenantId: string, from: string, to: string): Promise<number> {
    const accs = await loadAccounts(this.db, tenantId);
    const moves = await sumByAccount(this.db, tenantId, { from, to, excludeSources: ['CLOSING'] });
    const revenue = accs
      .filter((a) => a.isPostable && a.type === 'REVENUE' && ['SALES_REVENUE', 'SALES_DEDUCTION', 'OTHER_INCOME'].includes(a.reportGroup))
      .reduce<Dec>((s, a) => s.plus(natural(a.type, get(moves, a.id))), ZERO);
    return Math.max(0, Math.round(revenue.toNumber() * 100) / 100);
  }

  /** Ukuran usaha dari pembukuan: peredaran 12 bulan terakhir & aset di luar tanah dan bangunan */
  async measure(tenantId: string) {
    const to = todayJakarta();
    const from = addDays(to, -364);
    const accs = await loadAccounts(this.db, tenantId);
    const [revenue, balances] = await Promise.all([this.revenueBetween(tenantId, from, to), sumByAccount(this.db, tenantId, { to })]);
    const totalAssets = accs.filter((a) => a.isPostable && a.type === 'ASSET').reduce<Dec>((s, a) => s.plus(natural(a.type, get(balances, a.id))), ZERO);
    // Tanah & bangunan dikecualikan berdasarkan akun buku besar kategori asetnya (akun aset dan akumulasi penyusutan),
    // sehingga tanah yang dibukukan lewat jurnal manual pun ikut dikecualikan. Akun yang juga dipakai
    // kategori lain tidak dikecualikan agar aset non-tanah tidak ikut terbuang.
    const cats = await this.assets.listCategories(tenantId);
    const accountsOf = (c: (typeof cats)[number]) => [c.assetAccountId, c.accumulatedAccountId].filter((id): id is string => !!id);
    const shared = new Set(cats.filter((c) => !LAND_BUILDING.includes(c.fiscalGroup)).flatMap(accountsOf));
    const landBuildingAccounts = new Set(cats.filter((c) => LAND_BUILDING.includes(c.fiscalGroup)).flatMap(accountsOf).filter((id) => !shared.has(id)));
    const landBuilding = accs
      .filter((a) => landBuildingAccounts.has(a.id))
      .reduce<Dec>((s, a) => s.plus(natural(a.type, get(balances, a.id))), ZERO);
    return { from, to, revenue: Math.round(revenue), assets: Math.max(0, Math.round(totalAssets.minus(landBuilding).toNumber())) };
  }

  async state(tenantId: string) {
    const [reporting, tax, saved, measured] = await Promise.all([
      this.settings.reporting(this.db, tenantId),
      this.settings.taxProfile(this.db, tenantId),
      this.settings.section<Partial<SavedProfile>>(this.db, tenantId, 'entityProfile', {}),
      this.measure(tenantId),
    ]);
    const legalForm = reporting.legalForm as LegalForm;
    const answers: EntityProfileInput = {
      publicAccountability: saved.publicAccountability ?? false,
      legalForm,
      assets: measured.assets,
      revenue: measured.revenue,
    };
    const recommendation = recommendProfile(answers);
    const current = {
      framework: reporting.framework,
      taxScheme: reporting.taxScheme,
      pkp: tax.pkp,
      legalForm,
      taxRegisteredYear: reporting.taxRegisteredYear,
    };
    return {
      current,
      saved: saved.appliedAt ? saved : null,
      measured,
      answers,
      recommendation,
      simplifications: simplificationsFor(recommendation.framework, recommendation.taxScheme),
      /** Pilihan saat ini dibandingkan dengan angka pembukuan terkini */
      drift: {
        framework: current.framework === recommendation.framework || recommendation.frameworkAlternatives.includes(current.framework),
        taxScheme: current.taxScheme !== 'FINAL_UMKM' || recommendation.finalTaxEligible,
        pkp: !recommendation.pkpRequired || current.pkp,
      },
    };
  }

  recommend(dto: EntityAnswersDto) {
    const rec = recommendProfile(dto);
    return { recommendation: rec, simplifications: simplificationsFor(rec.framework, rec.taxScheme) };
  }

  /** Saldo pajak tangguhan yang sudah dibukukan (tidak dihitung ulang bila pindah ke EMKM / PPh final) */
  private async deferredTaxBalance(tenantId: string) {
    const accs = await loadAccounts(this.db, tenantId);
    const bal = await sumByAccount(this.db, tenantId, { to: todayJakarta() });
    const net = (key: string) => {
      const a = accs.find((x) => x.systemKey === key);
      return a ? natural(a.type, get(bal, a.id)) : ZERO;
    };
    return net(SYS.DEFERRED_TAX_ASSET).minus(net(SYS.DEFERRED_TAX_LIABILITY));
  }

  async apply(user: AuthUser, dto: ApplyEntityProfileDto) {
    const rec = recommendProfile(dto);
    if (rec.outOfScope) throw new BadRequestException(rec.warnings[0]);
    if (dto.framework !== rec.framework && !rec.frameworkAlternatives.includes(dto.framework)) {
      throw new BadRequestException(
        `${dto.framework === 'SAK_EMKM' ? 'SAK EMKM' : 'SAK EP'} tidak memenuhi syarat untuk usaha ini (${rec.reasons[0]})`,
      );
    }
    if (dto.taxScheme === 'FINAL_UMKM' && !rec.finalTaxEligible) {
      throw new BadRequestException(
        dto.revenue > TAX_REVENUE_LIMIT
          ? `PPh final UMKM hanya untuk peredaran bruto sampai Rp${TAX_REVENUE_LIMIT.toLocaleString('id-ID')}`
          : FINAL_TAX_EXCLUDED_FORMS.includes(dto.legalForm)
            ? 'Bentuk badan usaha ini tidak lagi berhak PPh final UMKM 0,5%'
            : 'Usaha ini tidak memenuhi syarat PPh final UMKM',
      );
    }
    if (dto.pkp === false && rec.pkpRequired) {
      throw new BadRequestException(`Peredaran bruto melewati Rp${TAX_REVENUE_LIMIT.toLocaleString('id-ID')}: perusahaan wajib dikukuhkan sebagai PKP`);
    }

    if (dto.pkp !== undefined && !['OWNER', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Hanya Pemilik atau Admin yang boleh mengubah status PKP');
    }

    const before = await this.state(user.tenantId);
    const deferred = await this.deferredTaxBalance(user.tenantId);
    await this.db.transaction(async (tx) => {
      await this.settings.saveReporting(tx, user.tenantId, {
        framework: dto.framework,
        taxScheme: dto.taxScheme,
        legalForm: dto.legalForm,
        ...(dto.taxRegisteredYear ? { taxRegisteredYear: dto.taxRegisteredYear } : {}),
      });
      if (dto.pkp !== undefined) await this.settings.saveTaxProfile(tx, user.tenantId, { pkp: dto.pkp });
      await refreshChartRelevance(tx, user.tenantId);
      await this.settings.saveSection(tx, user.tenantId, 'entityProfile', {}, {
        publicAccountability: dto.publicAccountability,
        legalForm: dto.legalForm,
        assets: dto.assets,
        revenue: dto.revenue,
        taxRegisteredYear: dto.taxRegisteredYear ?? null,
        appliedAt: new Date().toISOString(),
        appliedFramework: dto.framework,
        appliedTaxScheme: dto.taxScheme,
      } satisfies SavedProfile);
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'UPDATE',
        entity: 'EntityProfile',
        entityId: user.tenantId,
        data: { before: before.current, after: { framework: dto.framework, taxScheme: dto.taxScheme, pkp: dto.pkp, legalForm: dto.legalForm }, size: rec.size },
      });
    });

    const warnings: string[] = [];
    if (!deferred.isZero() && (dto.framework === 'SAK_EMKM' || dto.taxScheme === 'FINAL_UMKM')) {
      warnings.push(
        `Pembukuan sudah memuat saldo pajak tangguhan Rp${Math.abs(Math.round(deferred.toNumber())).toLocaleString('id-ID')}. Dengan pilihan ini pajak tangguhan tidak dihitung lagi; minta akuntan membalik saldonya lewat jurnal penyesuaian.`,
      );
    }
    if (dto.pkp !== undefined && dto.pkp !== before.current.pkp) {
      warnings.push(dto.pkp ? 'Status PKP aktif: penjualan baru dipungut PPN keluaran.' : 'Status PKP nonaktif: penjualan baru tanpa PPN dan PPN supplier menjadi bagian harga perolehan.');
    }
    return { ...(await this.state(user.tenantId)), applied: { framework: dto.framework, taxScheme: dto.taxScheme }, warnings, simplifications: simplificationsFor(dto.framework, dto.taxScheme) };
  }
}
