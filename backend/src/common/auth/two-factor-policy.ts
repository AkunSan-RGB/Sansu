import { Injectable } from '@nestjs/common';
import type { Role } from '../../db/schema';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SettingsService } from '../settings.service';

export type TwoFactorRequirement = 'NONE' | 'ADMINS' | 'ALL';
export interface SecuritySettings {
  /** Wajib verifikasi 2 langkah: tidak ada · Pemilik/Admin/Keuangan · semua pengguna */
  require2fa: TwoFactorRequirement;
}
export const DEFAULT_SECURITY: SecuritySettings = { require2fa: 'NONE' };
const PRIVILEGED: Role[] = ['OWNER', 'ADMIN', 'FINANCE'];

/** Kebijakan 2FA per perusahaan (disimpan di pengaturan perusahaan, di-cache singkat) */
@Injectable()
export class TwoFactorPolicy {
  private cache = new Map<string, { at: number; v: SecuritySettings }>();
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async get(tenantId: string): Promise<SecuritySettings> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.v;
    const v = await this.settings.section(this.db, tenantId, 'security', DEFAULT_SECURITY);
    this.cache.set(tenantId, { at: Date.now(), v });
    return v;
  }

  async save(tenantId: string, patch: Partial<SecuritySettings>) {
    const v = await this.settings.saveSection(this.db, tenantId, 'security', DEFAULT_SECURITY, patch);
    this.cache.delete(tenantId);
    return v;
  }

  /** Apakah peran ini wajib memakai 2FA di perusahaan tersebut */
  async requiredFor(tenantId: string, role: Role) {
    const { require2fa } = await this.get(tenantId);
    return require2fa === 'ALL' || (require2fa === 'ADMINS' && PRIVILEGED.includes(role));
  }
}
