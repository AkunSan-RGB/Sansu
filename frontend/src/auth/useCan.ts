import { useQuery } from '@tanstack/react-query';
import { get } from '@/api/client';
import { useAuth } from './AuthContext';

type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Apakah peran pengguna boleh memakai endpoint penulisan ini? Jawabannya dari server (`/auth/permissions`, diturunkan dari
 * @Roles tiap endpoint), jadi tombol yang pasti ditolak server tidak ditampilkan dan tidak bisa menyimpang dari aturan server.
 * Kunci memakai jalur rute server apa adanya, mis. `can('POST', '/purchase-orders/:id/confirm')`
 * (tes backend memeriksa semua kunci literal di kode tampilan terhadap matriks rute).
 * Selagi izin belum dimuat atau gagal dimuat, tombol tetap tampil (server tetap menolak yang tidak berhak).
 */
export function useCan() {
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ['permissions', me?.role],
    queryFn: () => get<{ role: string; allow: string[] }>('/auth/permissions'),
    enabled: !!me,
    staleTime: Infinity,
  });
  const allow = q.data ? new Set(q.data.allow) : null;
  return (method: WriteMethod, path: string) => !allow || allow.has(`${method} ${path}`);
}
