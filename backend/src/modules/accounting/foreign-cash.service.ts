import { BadRequestException, Injectable } from '@nestjs/common';
import { D, Dec, money } from '../../common/utils/money';
import { DbOrTx } from '../../db/db';
import { ForeignCashRepository } from './foreign-cash.repository';

export interface ForeignPosition {
  /** Saldo dalam mata uang rekening */
  foreign: Dec;
  /** Nilai Rupiah tercatat (biaya perolehan rata-rata tertimbang) */
  idr: Dec;
}

/**
 * Rekening kas/bank bermata uang asing: saldo valas, nilai Rupiah tercatat, dan biaya keluar.
 * Uang valas keluar dinilai pada biaya rata-rata tertimbang saldo (PSAK 10): selisih terhadap nilai transaksi
 * (kurs hari itu) menjadi laba/rugi selisih kurs terealisasi. Pengeluaran yang menghabiskan saldo mengambil seluruh nilai
 * tercatat sehingga saldo Rupiah rekening tepat nol, tanpa sisa pembulatan.
 */
@Injectable()
export class ForeignCashService {
  constructor(private readonly repo: ForeignCashRepository) {}

  async position(db: DbOrTx, tenantId: string, accountId: string, asOf?: string): Promise<ForeignPosition> {
    const [r] = (await this.repo.queryPosition(db, tenantId, accountId, asOf)).rows;
    return { foreign: D(r?.foreign_bal ?? 0), idr: D(r?.idr_bal ?? 0) };
  }

  /** Posisi seluruh rekening valas per tanggal (untuk penilaian ulang dan tampilan) */
  async accounts(db: DbOrTx, tenantId: string, asOf: string) {
    return (await this.repo.queryForeignAccounts(db, tenantId, asOf)).rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, currency: r.currency, foreign: D(r.foreign_bal), idr: D(r.idr_bal),
    }));
  }

  /**
   * Biaya Rupiah tercatat atas uang valas yang keluar dari rekening. Mengunci rekening (serial per rekening) dan,
   * bila kontrol "Tolak saldo negatif" aktif, menolak pengeluaran melebihi saldo valas.
   */
  async costOut(tx: DbOrTx, tenantId: string, account: { id: string; name: string; currency: string }, amountForeign: Dec): Promise<Dec> {
    await this.repo.queryLock(tx, account.id);
    const pos = await this.position(tx, tenantId, account.id);
    const [t] = (await this.repo.queryBlockNegative(tx, tenantId)).rows;
    if (t?.block !== false && amountForeign.gt(pos.foreign)) {
      throw new BadRequestException(`Saldo ${account.name} tidak cukup (${pos.foreign.toFixed(2)} ${account.currency}); pengeluaran ini akan membuat saldo negatif`);
    }
    if (pos.foreign.lte(0)) return money(D(0));
    if (amountForeign.gte(pos.foreign)) return pos.idr;
    return money(pos.idr.times(amountForeign).div(pos.foreign));
  }
}
