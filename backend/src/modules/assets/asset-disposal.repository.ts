import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk AssetDisposal: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AssetDisposalRepository {
  /** Dipakai oleh AssetDisposalService.transferBranch */
  queryBranche(db: DbOrTx, target: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM branches WHERE id = ${target} AND tenant_id = ${tenantId} AND is_active`,
    );
  }

  /** Dipakai oleh AssetDisposalService.transferBranch */
  queryAssetDepreciation(db: DbOrTx, id: string) {
    return db.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${id}`,
    );
  }
}
