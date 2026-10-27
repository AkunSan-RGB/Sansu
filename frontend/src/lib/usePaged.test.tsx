// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a) }));
import { usePaged } from './usePaged';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe('usePaged', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      const q = new URLSearchParams(url.split('?')[1]);
      return { rows: [{ id: `p${q.get('page')}` }], total: 130, page: Number(q.get('page')), pageSize: Number(q.get('pageSize')) };
    });
  });

  it('meminta halaman dari server dan melaporkan total sebenarnya', async () => {
    const { result } = renderHook(() => usePaged<{ id: string }>(['x'], '/utility/connections', { status: 'ACTIVE', search: undefined }), { wrapper });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'p1' }]));
    expect(get.mock.calls[0][0]).toBe('/utility/connections?status=ACTIVE&page=1&pageSize=25');
    expect(result.current.pagination).toMatchObject({ current: 1, pageSize: 25, total: 130 });
  });

  it('pindah halaman memuat halaman itu; ganti penyaring kembali ke halaman 1', async () => {
    const { result, rerender } = renderHook(({ s }: { s: string }) => usePaged<{ id: string }>(['x'], '/utility/connections', { search: s }), { wrapper, initialProps: { s: '' } });
    await waitFor(() => expect(result.current.rows[0]?.id).toBe('p1'));
    act(() => result.current.pagination.onChange(3, 25));
    await waitFor(() => expect(result.current.rows[0]?.id).toBe('p3'));
    rerender({ s: 'andi' });
    await waitFor(() => expect(result.current.pagination.current).toBe(1));
    await waitFor(() => expect(get.mock.calls.at(-1)![0]).toContain('search=andi&page=1'));
  });

  it('enabled=false tidak meminta apa pun', async () => {
    renderHook(() => usePaged(['x'], '/utility/readings/due', { period: '2026-10' }, { enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(get).not.toHaveBeenCalled();
  });
});
