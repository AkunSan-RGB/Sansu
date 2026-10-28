import { Injectable } from '@nestjs/common';
import { BUSINESS_MODEL_BY_KEY, NEW_SERVICE_PROFILES, type BusinessModel, type ServiceProfile } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { AppsService } from '../../common/apps/apps.service';
import { Tx } from '../../db/db';
import { syncChartOfAccounts } from '../accounting/coa-sync';
import { TenantSetupRepository } from './tenant-setup.repository';

/** Menyiapkan perusahaan baru: bagan akun standar SAK EP, kategori aset tetap, gudang utama, aplikasi bawaan. */
@Injectable()
export class TenantSetupService {
  constructor(
    private readonly apps: AppsService,
    private readonly settings: SettingsService,
    private readonly repo: TenantSetupRepository,
  ) {}

  async provision(tx: Tx, tenantId: string, model: BusinessModel = 'DAGANG', opts: { serviceProfiles?: ServiceProfile[] } = {}) {
    // Model (dan profil layanan Jasa) disimpan lebih dulu: bagan akun menyesuaikan jenis usaha dan profilnya.
    // Perusahaan jasa baru mulai dengan profil sederhana (konsultan) kecuali pemanggil menyebut profilnya; profil lain dipilih di Pengaturan usaha
    await this.settings.saveSection(tx, tenantId, 'business', { model: 'DAGANG' as BusinessModel }, { model });
    if (model === 'JASA') await this.settings.saveServiceProfiles(tx, tenantId, opts.serviceProfiles?.length ? opts.serviceProfiles : NEW_SERVICE_PROFILES);
    await syncChartOfAccounts(tx, tenantId, { apps: new Set<string>(BUSINESS_MODEL_BY_KEY[model].apps) });
    await this.repo.insertWarehouses(tx, tenantId, model);
    // Toko ritel: harga rak/kasir umumnya sudah termasuk PPN
    if (model === 'RITEL') await this.settings.saveTaxProfile(tx, tenantId, { posPricesIncludeVat: true });
    // Kafe/restoran: penjualan makanan & minuman dikenai pajak restoran daerah (PB1/PBJT, 10%), bukan PPN; tarif bisa diubah sesuai perda
    if (model === 'FNB') await this.settings.saveTaxProfile(tx, tenantId, { localTaxEnabled: true, localTaxRate: '10' });
    await this.apps.provisionDefaults(tx, tenantId, BUSINESS_MODEL_BY_KEY[model].apps);
  }
}
