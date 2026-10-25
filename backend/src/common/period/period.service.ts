import { BadRequestException, Injectable } from '@nestjs/common';
import { DocDate } from '../utils/dates';
import { DbOrTx } from '../../db/db';
import { PeriodRepository } from './period.repository';

/**
 * Tutup buku: transaksi bertanggal pada/sebelum `tenants.locked_until` ditolak.
 * Dipanggil oleh mesin posting jurnal dan mutasi stok, sehingga berlaku untuk semua dokumen.
 */
@Injectable()
export class PeriodService {
  constructor(private readonly repo: PeriodRepository) {}

  async lockedUntil(db: DbOrTx, tenantId: string): Promise<string | null> {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    return t?.lockedUntil ?? null;
  }

  async assertOpen(db: DbOrTx, tenantId: string, date: DocDate) {
    const locked = await this.lockedUntil(db, tenantId);
    if (locked && date <= locked) {
      throw new BadRequestException(
        `Periode sampai ${locked} sudah ditutup. Gunakan tanggal setelahnya atau buka kembali periode (peran Pemilik).`,
      );
    }
  }
}
