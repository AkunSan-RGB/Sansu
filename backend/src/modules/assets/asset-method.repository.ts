import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { assetUsage } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { UsageDto } from './assets.dto';
import type { Decimal } from 'decimal.js';

/** Akses data untuk AssetMethod: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AssetMethodRepository {
  /** Dipakai oleh AssetMethodService.setUsage */
  findAssetUsageByAssetIdAndPeriod(db: DbOrTx, id: string, period: string) {
    return db
      .select()
      .from(assetUsage)
      .where(and(eq(assetUsage.assetId, id), eq(assetUsage.period, period)));
  }

  /** Dipakai oleh AssetMethodService.setUsage */
  listAssetUsageByAssetId(db: DbOrTx, id: string) {
    return db.select().from(assetUsage).where(eq(assetUsage.assetId, id));
  }

  /** Dipakai oleh AssetMethodService.changeMethod */
  queryAssetDepreciation(db: DbOrTx, id: string) {
    return db.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${id}`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AssetMethodService.setUsage */
  insertAssetUsage(db: DbOrTx, tenantId: string, id: string, dto: UsageDto, units: Decimal, sub: string) {
    return db.insert(assetUsage).values({
      tenantId: tenantId,
      assetId: id,
      period: dto.period,
      units: units.toFixed(4),
      note: dto.note ?? null,
      createdById: sub,
    });
  }
}
