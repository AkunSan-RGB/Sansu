import { Button, Result, Space } from 'antd';
import React from 'react';

type Props = {
  children: React.ReactNode;
  /** Berubah (mis. pindah halaman) → boundary mencoba menampilkan anaknya lagi */
  resetKey?: string;
  /** Tampilan penuh layar (boundary terluar) atau di dalam kerangka halaman */
  fullscreen?: boolean;
};
type State = { error: Error | null };

/** Galat memuat potongan kode (umumnya aplikasi baru dirilis saat tab lama masih terbuka) */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Loading chunk|dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
}

/**
 * Menangkap galat saat menampilkan halaman supaya layar tidak putih: pengguna melihat pesan, bisa mencoba lagi
 * atau memuat ulang, dan menu/kerangka di luar boundary tetap berfungsi.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Galat tampilan', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div style={this.props.fullscreen ? { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 } : { padding: 16 }}>
        <Result
          status={stale ? 'info' : 'error'}
          title={stale ? 'Ada versi SANSU yang lebih baru' : 'Halaman ini gagal ditampilkan'}
          subTitle={
            stale
              ? 'Muat ulang halaman untuk memakai versi terbaru. Data yang sudah disimpan aman.'
              : 'Data Anda aman. Coba lagi; bila berulang, muat ulang halaman atau kirim tangkapan layar ini ke pengelola.'
          }
          extra={
            <Space direction="vertical" size={8}>
              <Space>
                {!stale && <Button onClick={() => this.setState({ error: null })}>Coba lagi</Button>}
                <Button type="primary" onClick={() => window.location.reload()}>
                  Muat ulang halaman
                </Button>
              </Space>
              {!stale && (
                <code style={{ fontSize: 12, opacity: 0.7, wordBreak: 'break-word' }}>{error.message.slice(0, 200)}</code>
              )}
            </Space>
          }
        />
      </div>
    );
  }
}
