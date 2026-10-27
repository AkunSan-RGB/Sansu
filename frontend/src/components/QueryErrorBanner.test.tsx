// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import QueryErrorBanner, { failedQueries } from './QueryErrorBanner';

function Page({ fn, name = 'data-uji' }: { fn: () => Promise<unknown>; name?: string }) {
  useQuery({ queryKey: [name], queryFn: fn, retry: false });
  return <QueryErrorBanner />;
}
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('QueryErrorBanner', () => {
  it('data yang gagal dimuat tampil sebagai banner, tombol coba lagi memuat ulang dan banner hilang saat berhasil', async () => {
    let ok = false;
    const fn = vi.fn(async () => {
      if (!ok) throw new ApiError(500, 'Terjadi kesalahan di server (500)');
      return 1;
    });
    wrap(<Page fn={fn} />);
    await screen.findByText('Sebagian data di halaman ini gagal dimuat');
    expect(screen.getByText(/Terjadi kesalahan di server/)).toBeInTheDocument();
    ok = true;
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    await waitFor(() => expect(screen.queryByText('Sebagian data di halaman ini gagal dimuat')).not.toBeInTheDocument());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('401/403/503 dan pemeriksaan server tidak memunculkan banner', async () => {
    for (const status of [401, 403, 503]) {
      const { unmount } = wrap(
        <Page
          name={`x${status}`}
          fn={async () => {
            throw new ApiError(status, 'x');
          }}
        />,
      );
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText(/gagal dimuat/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('failedQueries mengabaikan kueri tanpa pengamat dan kunci __', () => {
    const qc = new QueryClient();
    qc.setQueryData(['a'], 1);
    expect(failedQueries(qc.getQueryCache().getAll())).toEqual([]);
  });
});
