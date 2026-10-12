import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from './auth-user';

/** Gudang yang boleh diakses pengguna; null = semua gudang */
export const allowedWarehouses = (u?: Pick<AuthUser, 'warehouseIds'> | null): string[] | null => (u?.warehouseIds?.length ? u.warehouseIds : null);

export function assertWarehouseAccess(u: Pick<AuthUser, 'warehouseIds'> | null | undefined, warehouseId: string) {
  const allowed = allowedWarehouses(u);
  if (allowed && !allowed.includes(warehouseId)) throw new ForbiddenException('Anda tidak punya akses ke gudang ini. Hubungi admin perusahaan.');
}
