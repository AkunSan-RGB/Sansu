import { SANSU_BUILD } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'antd';
import { useEffect, useRef } from 'react';

/**
 * Pantau koneksi ke server SANSU. Bila server sempat mati / baru menyala, semua data
 * di layar dimuat ulang otomatis begitu server kembali. Peringatkan bila server yang
 * berjalan adalah versi lama (mis. jendela SANSU lama masih terbuka).
 */
export default function ServerStatus() {
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: ['__health'],
    queryFn: async () => {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error(`Server menjawab ${r.status}`);
      return (await r.json()) as { status: string; build?: string };
    },
    refetchInterval: (q) => (q.state.status === 'error' ? 3000 : 30000),
    retry: false,
    staleTime: 0,
  });
  const wasDown = useRef(false);
  useEffect(() => {
    if (health.isError) wasDown.current = true;
    if (health.isSuccess && wasDown.current) {
      wasDown.current = false;
      // Server kembali: muat ulang semua data yang tadi gagal
      qc.refetchQueries({ predicate: (q) => q.state.status === 'error' || q.state.data === undefined });
    }
  }, [health.isError, health.isSuccess, qc]);

  if (health.isError)
    return (
      <Alert
        type="warning"
        showIcon
        banner
        style={{ marginBottom: 16 }}
        message="Menghubungkan ke server SANSU…"
        description="Server sedang menyala atau jendela SANSU tertutup. Data akan dimuat otomatis begitu server siap."
      />
    );
  if (health.data?.build && health.data.build !== SANSU_BUILD)
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="Server SANSU versi lama masih berjalan"
        description={`Server: ${health.data.build}, tampilan: ${SANSU_BUILD}. Tutup semua jendela SANSU (termasuk yang tersembunyi), lalu jalankan ulang jalankan-sansu.bat.`}
      />
    );
  if (health.data && !health.data.build)
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="Server SANSU versi lama masih berjalan"
        description="Tutup semua jendela SANSU, lalu jalankan ulang jalankan-sansu.bat agar server versi terbaru yang dipakai."
      />
    );
  return null;
}
