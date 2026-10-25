import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { warehouses } from '../../db/schema';

/** Akses data untuk TenantSetup: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TenantSetupRepository {
  /** Dipakai oleh TenantSetupService.provision */
  insertWarehouses(
    db: DbOrTx,
    tenantId: string,
    model: 'DAGANG' | 'RITEL' | 'JASA' | 'FMCG' | 'MANUFAKTUR' | 'FNB' | 'UTILITAS',
  ) {
    return db
      .insert(warehouses)
      .values({ tenantId: tenantId, code: 'GDG-01', name: model === 'RITEL' ? 'Toko Utama' : 'Gudang Utama' });
  }
}
