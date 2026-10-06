import { Injectable } from '@nestjs/common';
import { BUSINESS_MODEL_BY_KEY, type BusinessModel } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { AppsService } from '../../common/apps/apps.service';
import { Tx } from '../../db/db';
import { warehouses } from '../../db/schema';
import { syncChartOfAccounts } from '../accounting/coa-sync';

/** Menyiapkan perusahaan baru: bagan akun standar SAK EP, kategori aset tetap, gudang utama, aplikasi bawaan. */
@Injectable()
export class TenantSetupService {
  constructor(
    private readonly apps: AppsService,
    private readonly settings: SettingsService,
  ) {}

  async provision(tx: Tx, tenantId: string, model: BusinessModel = 'DAGANG') {
    // Model disimpan lebih dulu: bagan akun menyesuaikan jenis usaha
    await this.settings.saveSection(tx, tenantId, 'business', { model: 'DAGANG' as BusinessModel }, { model });
    await syncChartOfAccounts(tx, tenantId, { apps: new Set<string>(BUSINESS_MODEL_BY_KEY[model].apps) });
    await tx.insert(warehouses).values({ tenantId, code: 'GDG-01', name: model === 'RITEL' ? 'Toko Utama' : 'Gudang Utama' });
    // Toko ritel: harga rak/kasir umumnya sudah termasuk PPN
    if (model === 'RITEL') await this.settings.saveTaxProfile(tx, tenantId, { posPricesIncludeVat: true });
    await this.apps.provisionDefaults(tx, tenantId, BUSINESS_MODEL_BY_KEY[model].apps);
  }
}
