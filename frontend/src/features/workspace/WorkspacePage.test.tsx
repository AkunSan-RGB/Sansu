// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const me = { current: { name: 'Uji', role: 'OWNER', businessModel: 'RITEL', tenantName: 'PT Uji', framework: 'SAK_EP', multiBranch: true, hasBudget: false, subscription: { enabled: true }, taxFeatures: {} } as Record<string, unknown> };
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: me.current }) }));
vi.mock('@/lib/apps', async (orig) => ({ ...(await orig<typeof import('@/lib/apps')>()), useApps: () => ({ can: () => true }) }));

import WorkspacePage from './WorkspacePage';

describe('Ruang kerja jenis usaha', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    me.current = { name: 'Uji', role: 'OWNER', businessModel: 'RITEL', tenantName: 'PT Uji', framework: 'SAK_EP', multiBranch: true, hasBudget: false, subscription: { enabled: true }, taxFeatures: {} };
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/onboarding/setup')) return { items: [{ key: 'a', title: 'Rekening pencairan EDC dan QRIS', done: false, link: '/cash' }, { key: 'b', title: 'Program poin pelanggan', done: true }], done: 1, total: 2 };
      if (url.startsWith('/dashboard')) return { salesMonth: 1000000, arOutstanding: 500000, cashBalance: 2500000 };
      return [];
    });
  });

  it('Ritel: judul, alur kerja bernomor, dan tautan khas toko', async () => {
    renderWithProviders(<WorkspacePage />);
    await screen.findByText('Ritel & toko');
    expect(screen.getByRole('link', { name: /Layar kasir/ })).toHaveAttribute('href', '/pos');
    expect(screen.getByRole('link', { name: /Pencairan QRIS\/kartu/ })).toHaveAttribute('href', '/pos/settlements');
    expect(screen.queryByRole('link', { name: /Meja & pesanan/ })).not.toBeInTheDocument(); // khusus F&B
  });

  it('kesiapan pengaturan menampilkan yang belum diatur dengan tautan Atur', async () => {
    renderWithProviders(<WorkspacePage />);
    await screen.findByText('Rekening pencairan EDC dan QRIS');
    expect(screen.getByText(/1 dari 2 pengaturan sudah terisi/)).toBeInTheDocument();
    expect(screen.queryByText('Program poin pelanggan')).not.toBeInTheDocument();
  });

  it('peran Gudang tidak melihat tautan keuangan/kasir yang bukan haknya', async () => {
    me.current = { ...me.current, role: 'WAREHOUSE' };
    renderWithProviders(<WorkspacePage />);
    await screen.findByText('Ritel & toko');
    expect(screen.queryByRole('link', { name: /Program loyalitas/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Saldo kas & bank')).not.toBeInTheDocument(); // angka uang hanya untuk peran keuangan
  });

  it('Dagang menampilkan rute pengiriman dan daftar harga, bukan kasir', async () => {
    me.current = { ...me.current, businessModel: 'DAGANG' };
    renderWithProviders(<WorkspacePage />);
    await screen.findByText('Dagang & distribusi');
    expect(screen.getByRole('link', { name: /Rute pengiriman/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Daftar harga/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Layar kasir/ })).not.toBeInTheDocument();
  });
});
