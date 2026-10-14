import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsUUID,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { APP_KEYS, type AppKey, LEGAL_FORMS, RECIPE_TERMS, REPORTING_FRAMEWORKS, type ReportingFramework, TAX_SCHEMES, VAT_ROUNDINGS, type VatRounding } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { StrongPassword } from '../auth/dto/auth.dto';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SettingsService, taxProfileOf } from '../../common/settings.service';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { normalizeWarehouseIds } from '../../common/auth/warehouse-ids';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { branches, Role, roleEnum, tenants, users } from '../../db/schema';
import { IsNpwp } from '../../common/validators/npwp';
import { isDocDate } from '../../common/utils/dates';
import { refreshChartRelevance } from '../accounting/coa-sync';

// ---------- DTO ----------
export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: roleEnum.enumValues }) @IsOptional() @IsIn(roleEnum.enumValues) role?: Role;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Atur ulang kata sandi' }) @IsOptional() @StrongPassword() password?: string;
  @ApiPropertyOptional({ description: 'Matikan verifikasi 2 langkah pengguna ini (mis. HP hilang)' })
  @IsOptional()
  @IsBoolean()
  resetTwoFactor?: boolean;
  @ApiPropertyOptional({ description: 'Batasi ke gudang tertentu; [] = semua gudang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  warehouseIds?: string[];
  @ApiPropertyOptional({ description: 'Batasi ke cabang tertentu; [] = semua cabang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class UpdateCompanyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional({ example: '0123456789012345' }) @IsOptional() @IsString() @IsNpwp() npwp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ example: '11' }) @IsOptional() @IsNumberString() ppnRate?: string;
  @ApiPropertyOptional({ description: 'Pengusaha Kena Pajak (memungut PPN)' }) @IsOptional() @IsBoolean() pkp?: boolean;
  @ApiPropertyOptional({ description: 'Harga kasir sudah termasuk PPN' }) @IsOptional() @IsBoolean() posPricesIncludeVat?: boolean;
  @ApiPropertyOptional({ description: 'Bawaan harga penawaran/pesanan termasuk PPN' }) @IsOptional() @IsBoolean() salesPricesIncludeVat?: boolean;
  @ApiPropertyOptional({ description: 'Hari libur nasional / cuti bersama (YYYY-MM-DD) untuk menggeser tenggat pajak', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'Tanggal libur harus berformat YYYY-MM-DD' })
  holidays?: string[];
  @ApiPropertyOptional({ enum: VAT_ROUNDINGS, description: 'Pembulatan PPN dokumen ke rupiah penuh' }) @IsOptional() @IsIn(VAT_ROUNDINGS) vatRounding?: VatRounding;
  @ApiPropertyOptional({ description: 'Pajak restoran daerah (PB1/PBJT) menggantikan PPN pada penjualan kasir' }) @IsOptional() @IsBoolean() localTaxEnabled?: boolean;
  @ApiPropertyOptional({ example: '10', description: 'Tarif pajak daerah (%), 0–10 menurut peraturan daerah' }) @IsOptional() @IsNumberString() @Matches(/^(10(\.0+)?|[0-9](\.\d{1,2})?)$/, { message: 'Tarif pajak daerah harus 0–10 persen' }) localTaxRate?: string;
}

/** Kop surat & dokumen: logo, kontak, rekening pembayaran, catatan di faktur */
export interface Branding {
  logo: string | null;
  phone: string;
  email: string;
  bankInfo: string;
  invoiceNote: string;
}
const DEFAULT_BRANDING: Branding = { logo: null, phone: '', email: '', bankInfo: '', invoiceNote: '' };

export class BrandingDto {
  @ApiPropertyOptional({
    description: 'Logo sebagai data URL PNG/JPEG/WebP (maks. ±300 KB); kosongkan untuk menghapus',
  })
  @IsOptional()
  @IsString()
  @MaxLength(420_000, { message: 'Logo terlalu besar (maks. ±300 KB)' })
  @Matches(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, {
    message: 'Logo harus gambar PNG, JPG, atau WebP',
  })
  logo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) email?: string;
  @ApiPropertyOptional({ example: 'BCA 123-456-7890 a.n. PT Maju Jaya' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bankInfo?: string;
  @ApiPropertyOptional({ example: 'Barang yang sudah dibeli tidak dapat dikembalikan.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoiceNote?: string;
}

export class TermsSettingsDto {
  @ApiProperty({ enum: RECIPE_TERMS }) @IsIn(RECIPE_TERMS as unknown as string[]) recipe: string;
}

export class ReportingSettingsDto {
  @ApiPropertyOptional({ enum: REPORTING_FRAMEWORKS }) @IsOptional() @IsIn(REPORTING_FRAMEWORKS) framework?: ReportingFramework;
  @ApiPropertyOptional({ enum: LEGAL_FORMS }) @IsOptional() @IsIn(LEGAL_FORMS) legalForm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) businessActivity?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1900) @Max(2100) establishedYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) directorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) directorTitle?: string;
  @ApiPropertyOptional({ enum: TAX_SCHEMES }) @IsOptional() @IsIn(TAX_SCHEMES) taxScheme?: 'GENERAL' | 'FINAL_UMKM';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1980) @Max(2100) taxRegisteredYear?: number;
  @ApiPropertyOptional({ description: 'Batas kapitalisasi aset tetap (Rp per unit); 0 = kapitalisasi semua' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  capitalizationThreshold?: number;
}

export class PayrollSettingsDto {
  @ApiPropertyOptional({ enum: [5, 6] }) @IsOptional() @IsIn([5, 6]) workDaysPerWeek?: 5 | 6;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) bpjsKesCap?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) jpCap?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) jkkRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) jkmRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) overtimeDivisor?: number;
}

// ---------- Service ----------
@Injectable()
export class PlatformService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly subs: SubscriptionService,
  ) {}

  private async normalizeBranchIds(tenantId: string, ids: string[]) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return null;
    const rows = await this.db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), inArray(branches.id, uniq)));
    if (rows.length !== uniq.length) throw new BadRequestException('Ada cabang yang tidak ditemukan');
    return uniq;
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const [target] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, actor.tenantId)));
    if (!target) throw new NotFoundException('Pengguna tidak ditemukan');
    if ((target.role === 'OWNER' || dto.role === 'OWNER') && actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Pemilik yang bisa mengubah akun Pemilik');
    }
    if (dto.resetTwoFactor && actor.role !== 'OWNER' && ['OWNER', 'ADMIN', 'FINANCE'].includes(target.role)) {
      throw new ForbiddenException('Hanya Pemilik yang bisa me-reset verifikasi 2 langkah akun Admin/Keuangan');
    }
    if (dto.resetTwoFactor && id === actor.sub)
      throw new BadRequestException('Matikan verifikasi 2 langkah akun sendiri lewat menu Keamanan akun');
    if (id === actor.sub && (dto.isActive === false || (dto.role && dto.role !== target.role))) {
      throw new BadRequestException('Anda tidak bisa menonaktifkan atau mengubah peran akun sendiri');
    }
    // Jangan sampai perusahaan kehilangan pemilik aktif terakhir
    if (target.role === 'OWNER' && (dto.isActive === false || (dto.role && dto.role !== 'OWNER'))) {
      const others = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.tenantId, actor.tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true), ne(users.id, id)),
        );
      if (!others.length) throw new BadRequestException('Harus ada minimal satu Pemilik aktif');
    }
    if (dto.isActive === true && !target.isActive) await this.subs.assertCanAdd(actor.tenantId, 'users');
    const [u] = await this.db
      .update(users)
      .set({
        name: dto.name,
        role: dto.role,
        isActive: dto.isActive,
        warehouseIds: await normalizeWarehouseIds(this.db, actor.tenantId, dto.warehouseIds),
        branchIds: dto.branchIds === undefined ? undefined : await this.normalizeBranchIds(actor.tenantId, dto.branchIds),
        ...(dto.resetTwoFactor ? { totpEnabledAt: null, totpSecret: null, totpBackupCodes: null } : {}),
        // akses/kredensial berubah: putuskan Telegram (tautan persetujuan pribadi tidak boleh tertinggal di chat lama)
        ...(dto.password || dto.isActive === false || (dto.role && dto.role !== target.role) ? { telegramChatId: null, telegramLinkCode: null, telegramLinkExpires: null } : {}),
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
        // cabut semua sesi pengguna ini bila akses/kredensialnya berubah
        tokenVersion:
          dto.password || dto.resetTwoFactor || dto.isActive === false || (dto.role && dto.role !== target.role)
            ? sql`${users.tokenVersion} + 1`
            : undefined,
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        warehouseIds: users.warehouseIds,
        branchIds: users.branchIds,
        totpEnabledAt: users.totpEnabledAt,
      });
    await this.audit.log(this.db, {
      tenantId: actor.tenantId,
      userId: actor.sub,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      data: { ...dto, password: dto.password ? '***' : undefined },
    });
    return u;
  }

  async company(tenantId: string) {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    return {
      name: t.name,
      npwp: t.npwp,
      address: t.address,
      ppnRate: t.ppnRate,
      taxProfile: taxProfileOf(t.settings),
      branding: await this.settings.section(this.db, tenantId, 'branding', DEFAULT_BRANDING),
      payroll: await this.settings.payroll(this.db, tenantId),
      reporting: await this.settings.reporting(this.db, tenantId),
    };
  }

  async updateCompany(actor: AuthUser, dto: UpdateCompanyDto) {
    const { pkp, posPricesIncludeVat, salesPricesIncludeVat, holidays, vatRounding, localTaxEnabled, localTaxRate, ...rest } = dto;
    const company = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(company).length) await this.db.update(tenants).set(company).where(eq(tenants.id, actor.tenantId));
    if (pkp !== undefined || posPricesIncludeVat !== undefined || salesPricesIncludeVat !== undefined || holidays !== undefined || vatRounding !== undefined || localTaxEnabled !== undefined || localTaxRate !== undefined) {
      const patch = {
        pkp,
        posPricesIncludeVat,
        salesPricesIncludeVat,
        holidays: holidays && [...new Set(holidays.filter(isDocDate))].sort(),
        vatRounding,
        localTaxEnabled,
        localTaxRate,
      };
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete patch[k];
      const before = await this.settings.taxProfile(this.db, actor.tenantId);
      const after = await this.settings.saveTaxProfile(this.db, actor.tenantId, patch);
      await this.audit.log(this.db, { tenantId: actor.tenantId, userId: actor.sub, action: 'UPDATE', entity: 'TaxProfile', entityId: actor.tenantId, data: { before, after } });
    }
    return this.company(actor.tenantId);
  }

  /** Data kop surat untuk semua dokumen cetak — boleh dibaca semua pengguna */
  async letterhead(tenantId: string) {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const b = await this.settings.section(this.db, tenantId, 'branding', DEFAULT_BRANDING);
    return { name: t.name, address: t.address, npwp: t.npwp, ...b };
  }

  async updateBranding(actor: AuthUser, dto: BrandingDto) {
    const patch: Partial<Branding> = { ...dto, logo: dto.logo === undefined ? undefined : dto.logo || null };
    for (const k of Object.keys(patch) as (keyof Branding)[]) if (patch[k] === undefined) delete patch[k];
    await this.settings.saveSection(this.db, actor.tenantId, 'branding', DEFAULT_BRANDING, patch);
    await this.audit.log(this.db, {
      tenantId: actor.tenantId,
      userId: actor.sub,
      action: 'UPDATE',
      entity: 'Branding',
      entityId: actor.tenantId,
      data: { ...dto, logo: dto.logo === undefined ? undefined : dto.logo ? '(gambar)' : '(dihapus)' },
    });
    return this.letterhead(actor.tenantId);
  }

  async updateTerms(actor: AuthUser, dto: TermsSettingsDto) {
    await this.settings.saveSection(this.db, actor.tenantId, 'terms', { recipe: 'Resep' }, { recipe: dto.recipe });
    return { recipe: dto.recipe };
  }

  async updateReporting(actor: AuthUser, dto: ReportingSettingsDto) {
    await this.settings.saveReporting(this.db, actor.tenantId, dto);
    // Standar pelaporan berubah (SAK EP ↔ EMKM): akun yang tidak relevan (mis. pajak tangguhan) mengikuti otomatis
    if (dto.framework !== undefined) await refreshChartRelevance(this.db, actor.tenantId);
    return this.company(actor.tenantId);
  }

  async updatePayroll(actor: AuthUser, dto: PayrollSettingsDto) {
    await this.settings.savePayroll(this.db, actor.tenantId, dto);
    return this.company(actor.tenantId);
  }
}

// ---------- Controller ----------
@ApiTags('Platform')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  constructor(
    private readonly apps: AppsService,
    private readonly svc: PlatformService,
  ) {}

  /** Katalog aplikasi + status aktif (semua pengguna boleh melihat) */
  @Get('apps')
  catalog(@CurrentUser() u: AuthUser) {
    return this.apps.catalog(u.tenantId);
  }

  @Roles('ADMIN')
  @Post('apps/:key/install')
  install(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    return this.apps.install(u.tenantId, this.key(key));
  }

  @Roles('ADMIN')
  @Post('apps/:key/uninstall')
  uninstall(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    return this.apps.uninstall(u.tenantId, this.key(key));
  }

  @Roles('ADMIN')
  @Patch('users/:id')
  updateUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.svc.updateUser(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'HR')
  @Get('settings/company')
  company(@CurrentUser() u: AuthUser) {
    return this.svc.company(u.tenantId);
  }

  @Roles('ADMIN')
  @Patch('settings/company')
  updateCompany(@CurrentUser() u: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.svc.updateCompany(u, dto);
  }

  /** Kop surat untuk faktur, surat jalan, PO, penawaran — semua peran */
  @Get('settings/letterhead')
  letterhead(@CurrentUser() u: AuthUser) {
    return this.svc.letterhead(u.tenantId);
  }

  @Roles('ADMIN')
  @Patch('settings/branding')
  updateBranding(@CurrentUser() u: AuthUser, @Body() dto: BrandingDto) {
    return this.svc.updateBranding(u, dto);
  }

  @Roles('ADMIN')
  @Patch('settings/terms')
  updateTerms(@CurrentUser() u: AuthUser, @Body() dto: TermsSettingsDto) {
    return this.svc.updateTerms(u, dto);
  }

  @Roles('ADMIN', 'FINANCE')
  @Patch('settings/reporting')
  updateReporting(@CurrentUser() u: AuthUser, @Body() dto: ReportingSettingsDto) {
    return this.svc.updateReporting(u, dto);
  }

  @Roles('ADMIN', 'HR')
  @Patch('settings/payroll')
  updatePayroll(@CurrentUser() u: AuthUser, @Body() dto: PayrollSettingsDto) {
    return this.svc.updatePayroll(u, dto);
  }

  private key(k: string): AppKey {
    if (!APP_KEYS.includes(k as AppKey)) throw new BadRequestException('Aplikasi tidak dikenal');
    return k as AppKey;
  }
}

@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
