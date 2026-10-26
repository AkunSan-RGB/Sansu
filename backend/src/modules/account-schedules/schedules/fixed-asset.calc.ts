import { D, Dec, ZERO } from '../../../common/utils/money';
import type { assetCategories, fixedAssets } from '../../../db/schema';

export interface AssetRow {
  asset: typeof fixedAssets.$inferSelect;
  category: typeof assetCategories.$inferSelect;
}

export interface DepreciationRow {
  asset_id: string;
  period: string;
  amount: string;
}

/**
 * Perhitungan posisi aset tetap pada suatu tanggal (murni, tanpa akses data), memakai aturan yang sama dengan
 * roll-forward CALK: aset yang dilepas pada/sebelum tanggal itu tidak lagi dihitung, akumulasi awal aset lama ikut saat terdaftar.
 */
export class FixedAssetCalc {
  private readonly dep = new Map<string, Map<string, Dec>>();

  constructor(private readonly dr: DepreciationRow[]) {
    for (const r of dr) {
      const m = this.dep.get(r.asset_id) ?? new Map<string, Dec>();
      m.set(r.period, D(r.amount));
      this.dep.set(r.asset_id, m);
    }
  }

  /** Aset masih tercatat pada tanggal itu: sudah diperoleh dan belum dilepas */
  held(a: AssetRow['asset'], date: string) {
    return a.acquisitionDate <= date && !(a.disposalDate && a.disposalDate <= date);
  }

  costAt(a: AssetRow['asset'], date: string): Dec {
    return this.held(a, date) ? D(a.cost) : ZERO;
  }

  /** Akumulasi penyusutan pada tanggal itu: akumulasi awal + penyusutan dibukukan sampai bulan tanggal itu */
  accAt(a: AssetRow['asset'], date: string): Dec {
    if (!this.held(a, date)) return ZERO;
    return D(a.openingAccumulated).plus(this.depThrough(a.id, date.slice(0, 7)));
  }

  depThrough(assetId: string, period: string): Dec {
    let s = ZERO;
    for (const [p, v] of this.dep.get(assetId) ?? []) if (p <= period) s = s.plus(v);
    return s;
  }

  depIn(assetId: string, period: string): Dec {
    return this.dep.get(assetId)?.get(period) ?? ZERO;
  }

  /** Penyusutan pada rentang periode YYYY-MM (inklusif) */
  depBetween(assetId: string, fromPeriod: string, toPeriod: string): Dec {
    let s = ZERO;
    for (const [p, v] of this.dep.get(assetId) ?? []) if (p >= fromPeriod && p <= toPeriod) s = s.plus(v);
    return s;
  }
}
