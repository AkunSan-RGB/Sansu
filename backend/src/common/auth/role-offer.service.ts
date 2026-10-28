import { BadRequestException, Injectable } from '@nestjs/common';
import { isRoleBlocked, type Role, roleLabelFor } from '@sansu/shared';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SettingsService } from '../settings.service';

/**
 * Peran yang diblokir perusahaan: hanya yang disembunyikan perusahaan itu sendiri (lihat `isRoleBlocked`).
 * Hanya soal siapa yang dapat diberi peran apa; hak akses peran tetap ditentukan kode dan tidak berubah karena penyesuaian.
 */
@Injectable()
export class RoleOfferService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Menolak peran yang disembunyikan perusahaan ini; pengguna lama yang sudah memegang peran itu tidak terpengaruh */
  async assertOffered(tenantId: string, role: Role) {
    const custom = await this.settings.roleCustomization(this.db, tenantId);
    if (isRoleBlocked(role, custom)) {
      const model = await this.settings.businessModel(this.db, tenantId);
      throw new BadRequestException(`Peran ${roleLabelFor(role, model, custom)} tidak ditawarkan untuk perusahaan ini. Pemilik dapat menawarkannya di Pengaturan › Jenis usaha › Peran.`);
    }
  }
}
