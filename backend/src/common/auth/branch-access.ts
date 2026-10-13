import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/**
 * Pembatasan cabang per pengguna. Pengguna tanpa batas (branchIds kosong) bebas memilih;
 * pengguna terbatas hanya boleh melihat cabangnya sendiri — tidak boleh melihat gabungan/Pusat/cabang lain.
 */
export function scopeBranch(u: AuthUser, requested?: string): string | undefined {
  const allowed = u.branchIds;
  if (!allowed?.length) return requested;
  if (!requested) {
    if (allowed.length === 1) return allowed[0];
    throw new ForbiddenException('Pilih salah satu cabang Anda untuk melihat laporan ini');
  }
  if (!allowed.includes(requested)) throw new ForbiddenException('Anda tidak punya akses ke cabang ini');
  return requested;
}

/** Laporan lintas cabang (perbandingan, konsolidasi) hanya untuk pengguna tanpa batas cabang */
export function assertAllBranches(u: AuthUser) {
  if (u.branchIds?.length) throw new ForbiddenException('Laporan lintas cabang hanya untuk pengguna tanpa batas cabang');
}
