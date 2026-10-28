import { BadRequestException, Injectable } from '@nestjs/common';
import { roleCatalog, type RoleCustomization, validateRoleCustomization } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { RoleCustomizationDto } from './role-customization.dto';

/**
 * Penyesuaian peran per perusahaan: sebutan dan peran yang ditawarkan, disimpan di pengaturan perusahaan itu saja
 * (terpisah antar perusahaan, tidak tertimpa pembaruan jenis usaha). Tidak mengubah hak akses peran.
 */
@Injectable()
export class RoleCustomizationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly apps: AppsService,
    private readonly audit: AuditService,
  ) {}

  /** Katalog yang berlaku (jenis usaha + penyesuaian) berdampingan dengan bawaan jenis usaha */
  async get(tenantId: string) {
    const [model, custom, apps] = await Promise.all([this.settings.businessModel(this.db, tenantId), this.settings.roleCustomization(this.db, tenantId), this.apps.enabled(tenantId)]);
    return { model, customization: custom, catalog: roleCatalog(model, custom, [...apps]), baseline: roleCatalog(model, undefined, [...apps]) };
  }

  async set(u: AuthUser, dto: RoleCustomizationDto) {
    const next: RoleCustomization = {
      labels: Object.fromEntries(Object.entries(dto.labels ?? {}).map(([r, l]) => [r, String(l).trim()]).filter(([, l]) => l)) as RoleCustomization['labels'],
      hidden: [...new Set(dto.hidden ?? [])],
      extra: [...new Set(dto.extra ?? [])],
    };
    const bad = validateRoleCustomization(next);
    if (bad) throw new BadRequestException(bad);
    if (next.hidden?.some((r) => next.extra?.includes(r))) throw new BadRequestException('Satu peran tidak boleh sekaligus disembunyikan dan ditambahkan');
    const before = await this.settings.roleCustomization(this.db, u.tenantId);
    await this.settings.saveRoleCustomization(this.db, u.tenantId, next);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'RoleCustomization', entityId: u.tenantId, data: { before, after: next } });
    return this.get(u.tenantId);
  }

  /** Kembali mengikuti jenis usaha sepenuhnya */
  async reset(u: AuthUser) {
    const before = await this.settings.roleCustomization(this.db, u.tenantId);
    await this.settings.saveRoleCustomization(this.db, u.tenantId, {});
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'RoleCustomization', entityId: u.tenantId, data: { before, after: {}, reset: true } });
    return this.get(u.tenantId);
  }
}
