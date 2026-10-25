import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService, taxProfileOf } from '../../common/settings.service';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { normalizeWarehouseIds } from '../../common/auth/warehouse-ids';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { branches, customRoles, tenants, users } from '../../db/schema';
import { isDocDate } from '../../common/utils/dates';
import { refreshChartRelevance } from '../accounting/coa-sync';
import { UpdateUserDto, UpdateCompanyDto, BrandingDto, TermsSettingsDto, ReportingSettingsDto, PayrollSettingsDto } from './platform.dto';
import { findOwned, patchById } from '../../db/owned';
import { PlatformRepository } from './platform.repository';

/** Kop surat & dokumen: logo, kontak, rekening pembayaran, catatan di faktur */
export interface Branding {
  logo: string | null;
  phone: string;
  email: string;
  bankInfo: string;
  invoiceNote: string;
}

const DEFAULT_BRANDING: Branding = { logo: null, phone: '', email: '', bankInfo: '', invoiceNote: '' };

@Injectable()
export class PlatformService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly subs: SubscriptionService,
    private readonly repo: PlatformRepository,
  ) {}

  private async normalizeBranchIds(tenantId: string, ids: string[]) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return null;
    const rows = await this.repo.listBranchesById(this.db, tenantId, uniq);
    if (rows.length !== uniq.length) throw new BadRequestException('Ada cabang yang tidak ditemukan');
    return uniq;
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await findOwned(this.db, users, actor.tenantId, id);
    if (!target) throw new NotFoundException('Pengguna tidak ditemukan');
    if ((target.role === 'OWNER' || dto.role === 'OWNER') && actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Pemilik yang bisa mengubah akun Pemilik');
    }
    if (dto.resetTwoFactor && actor.role !== 'OWNER' && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(target.role)) {
      throw new ForbiddenException('Hanya Pemilik yang bisa me-reset verifikasi 2 langkah akun Admin/Keuangan');
    }
    if (dto.resetTwoFactor && id === actor.sub)
      throw new BadRequestException('Matikan verifikasi 2 langkah akun sendiri lewat menu Keamanan akun');
    if (id === actor.sub && (dto.isActive === false || (dto.role && dto.role !== target.role))) {
      throw new BadRequestException('Anda tidak bisa menonaktifkan atau mengubah peran akun sendiri');
    }
    // Jangan sampai perusahaan kehilangan pemilik aktif terakhir
    if (target.role === 'OWNER' && (dto.isActive === false || (dto.role && dto.role !== 'OWNER'))) {
      const others = await this.repo.listUsersByRoleAndIsActiveAndId(this.db, actor.tenantId, id);
      if (!others.length) throw new BadRequestException('Harus ada minimal satu Pemilik aktif');
    }
    // Peran khusus membatasi hak: yang membatasi/melonggarkan hanya Pemilik (Admin tidak bisa melepas batas orang lain atau dirinya)
    const nextRole = dto.role ?? target.role;
    if (target.customRoleId && actor.role !== 'OWNER' && (dto.customRoleId !== undefined || (dto.role && dto.role !== target.role))) {
      throw new ForbiddenException('Pengguna ini memakai peran khusus; hanya Pemilik yang dapat mengubah perannya');
    }
    let customRoleId: string | null | undefined;
    if (dto.customRoleId !== undefined) {
      if (actor.role !== 'OWNER') throw new ForbiddenException('Hanya Pemilik yang dapat menetapkan peran khusus');
      if (dto.customRoleId !== null) {
        const [cr] = await this.repo.findCustomRolesById(this.db, dto.customRoleId, actor.tenantId);
        if (!cr) throw new BadRequestException('Peran khusus tidak ditemukan');
        if (cr.baseRole !== nextRole) throw new BadRequestException('Peran khusus harus turunan dari peran dasar pengguna');
      }
      customRoleId = dto.customRoleId;
    } else if (dto.role && dto.role !== target.role && target.customRoleId) {
      customRoleId = null; // peran dasar berganti: peran khusus lama tidak berlaku lagi
    }
    const customRoleChanged = customRoleId !== undefined && customRoleId !== target.customRoleId;
    if (dto.isActive === true && !target.isActive) await this.subs.assertCanAdd(actor.tenantId, 'users');
    const [u] = await this.db
      .update(users)
      .set({
        name: dto.name,
        role: dto.role,
        customRoleId,
        isActive: dto.isActive,
        warehouseIds: await normalizeWarehouseIds(this.db, actor.tenantId, dto.warehouseIds),
        branchIds: dto.branchIds === undefined ? undefined : await this.normalizeBranchIds(actor.tenantId, dto.branchIds),
        ...(dto.resetTwoFactor ? { totpEnabledAt: null, totpSecret: null, totpBackupCodes: null } : {}),
        // akses/kredensial berubah: putuskan Telegram (tautan persetujuan pribadi tidak boleh tertinggal di chat lama)
        ...(dto.password || dto.isActive === false || customRoleChanged || (dto.role && dto.role !== target.role) ? { telegramChatId: null, telegramLinkCode: null, telegramLinkExpires: null } : {}),
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
        // cabut semua sesi pengguna ini bila akses/kredensialnya berubah
        tokenVersion:
          dto.password || dto.resetTwoFactor || dto.isActive === false || customRoleChanged || (dto.role && dto.role !== target.role)
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
      // peran lama dicatat agar perpindahan peran yang saling mengawasi (Keuangan ↔ Akuntan) bisa dideteksi
      data: { ...dto, password: dto.password ? '***' : undefined, ...(dto.role && dto.role !== target.role ? { previousRole: target.role } : {}), ...(customRoleChanged ? { previousCustomRoleId: target.customRoleId, customRoleId } : {}) },
    });
    return u;
  }

  async company(tenantId: string) {
    const [t] = await this.repo.findTenantsById(this.db, tenantId);
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
    if (Object.keys(company).length) await patchById(this.db, tenants, actor.tenantId, company);
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
    const [t] = await this.repo.findTenantsById(this.db, tenantId);
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
