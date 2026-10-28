import { BadRequestException, Injectable } from '@nestjs/common';
import { isRoleOffered, type Role, roleLabelFor } from '@sansu/shared';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AppsService } from '../apps/apps.service';
import { SettingsService } from '../settings.service';

/**
 * Peran yang ditawarkan perusahaan: katalog jenis usaha + penyesuaian perusahaan itu sendiri.
 * Hanya soal siapa yang dapat diberi peran apa; hak akses peran tetap ditentukan kode dan tidak berubah karena penyesuaian.
 */
@Injectable()
export class RoleOfferService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly apps: AppsService,
  ) {}

  /** Menolak peran yang tidak ditawarkan; pengguna lama yang sudah memegang peran itu tidak terpengaruh */
  async assertOffered(tenantId: string, role: Role) {
    const [model, custom, apps] = await Promise.all([
      this.settings.businessModel(this.db, tenantId),
      this.settings.roleCustomization(this.db, tenantId),
      this.apps.enabled(tenantId),
    ]);
    if (!isRoleOffered(role, model, custom, [...apps]))
      throw new BadRequestException(`Peran ${roleLabelFor(role, model, custom)} tidak ditawarkan untuk perusahaan ini. Pemilik dapat menawarkannya di Pengaturan › Jenis usaha › Peran.`);
  }
}
