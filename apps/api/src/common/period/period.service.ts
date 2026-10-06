import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DocDate } from '../utils/dates';
import { DbOrTx } from '../../db/db';
import { tenants } from '../../db/schema';

/**
 * Tutup buku: transaksi bertanggal pada/sebelum `tenants.locked_until` ditolak.
 * Dipanggil oleh mesin posting jurnal dan mutasi stok, sehingga berlaku untuk semua dokumen.
 */
@Injectable()
export class PeriodService {
  async lockedUntil(db: DbOrTx, tenantId: string): Promise<string | null> {
    const [t] = await db.select({ lockedUntil: tenants.lockedUntil }).from(tenants).where(eq(tenants.id, tenantId));
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
