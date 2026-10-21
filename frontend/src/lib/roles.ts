import { useAuth } from '@/auth/AuthContext';

/** Pemilik boleh semuanya; peran lain hanya yang disebut (sama dengan @Roles di endpoint server yang dimaksud) */
export const hasRole = (role: string | undefined, allowed: readonly string[]) => role === 'OWNER' || (!!role && allowed.includes(role));

/**
 * Apakah peran pengguna termasuk yang boleh memanggil sebuah endpoint? Dipakai untuk `enabled` pada data pelengkap halaman,
 * supaya peran yang pasti ditolak server (403) tidak memanggilnya sama sekali.
 */
export function useHasRole(allowed: readonly string[]) {
  const { me } = useAuth();
  return hasRole(me?.role, allowed);
}
