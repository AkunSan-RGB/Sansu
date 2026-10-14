import { Role } from '../../db/schema';

/** Isi token JWT yang tersedia di setiap request terautentikasi. */
export interface AuthUser {
  sub: string; // user id
  tenantId: string;
  role: Role;
  email: string;
  /** versi sesi — harus sama dengan users.token_version */
  tv?: number;
  /** Diisi guard dari database (bukan dari token) */
  emailVerified?: boolean;
  /** Gudang yang boleh diakses (diisi guard dari database); kosong = semua */
  warehouseIds?: string[] | null;
  /** Cabang yang boleh diakses (diisi guard dari database); kosong = semua */
  branchIds?: string[] | null;
  /** Peran khusus (diisi guard dari database): hak tulis yang dicabut dari peran dasarnya */
  customRole?: { id: string; name: string; denied: string[] } | null;
}
