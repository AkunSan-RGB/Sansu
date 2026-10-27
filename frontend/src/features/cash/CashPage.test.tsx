// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const post = vi.fn();
const role = { current: 'OWNER' };
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Uji', role: role.current, businessModel: 'DAGANG', tenantName: 'PT Uji', tenantId: 't1' } }) }));
vi.mock('@/lib/apps', () => ({ useApps: () => ({ can: () => false }) }));
vi.mock('@/components/ExportButtons', () => ({ default: () => null }));

import CashPage from './CashPage';

const today = new Date().toISOString().slice(0, 10);
const tx = (o: Record<string, unknown>) => ({ id: 'x', number: 'KK-1', date: today, type: 'OUT', amount: '100000', status: 'POSTED', description: 'Bayar listrik', reference: 'N-1', cashAccount: { id: 'a1', name: 'Kas Besar' }, toCashAccount: null, lines: [{ id: 'l', account: { name: 'Beban Listrik' }, memo: '', amount: '100000' }], journalNumber: 'JU-1', ...o });
const TXS = [
  tx({ id: 't1', number: 'KK-0001', description: 'Bayar listrik gudang', amount: '250000' }),
  tx({ id: 't2', number: 'KM-0002', type: 'IN', description: 'Setoran modal pemilik', amount: '1000000', reference: 'S-9' }),
  tx({ id: 't3', number: 'KK-0003', description: 'Parkir', amount: '5000', reference: undefined }),
  tx({ id: 't4', number: 'KK-0004', description: 'Salah catat', amount: '777000', status: 'VOID' }),
];

describe('Halaman uang masuk & keluar (CashPage)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    role.current = 'OWNER';
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/cash/accounts')) return [{ id: 'a1', code: '1-1100', name: 'Kas Besar', balance: '5000000', currency: 'IDR' }];
      if (url.startsWith('/cash/transactions')) return TXS;
      if (url.startsWith('/cash/settings')) return { evidenceFrom: 1000000, blockNegative: true, maxCashBalance: 0 };
      if (url.startsWith('/cash/controls')) return { items: [] };
      if (url.startsWith('/cash/income-sources')) return { from: today, to: today, rows: [], totals: { sales: 0, nonSales: 0, other: 0 }, categories: { sales: 0, capital: 0, loan: 0, other: 0 } };
      if (url.startsWith('/branches')) return { branches: [], unassignedWarehouses: [] };
      return [];
    });
  });

  it('menampilkan saldo, riwayat, dan ringkasan arus tanpa menghitung transaksi dibatalkan', async () => {
    renderWithProviders(<CashPage />);
    await screen.findByText('Bayar listrik gudang');
    expect(screen.getByText('Setoran modal pemilik')).toBeInTheDocument();
    expect(screen.getAllByText(/5\.000\.000/).length).toBeGreaterThan(0); // saldo rekening
    // masuk 1.000.000, keluar 250.000 + 5.000 (yang dibatalkan 777.000 tidak dihitung) → bertambah 745.000
    expect(screen.getAllByText(/745\.000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1\.027\.000/)).not.toBeInTheDocument();
  });

  it('pencarian menyaring riwayat', async () => {
    renderWithProviders(<CashPage />);
    await screen.findByText('Bayar listrik gudang');
    fireEvent.change(screen.getByPlaceholderText(/Cari keterangan/), { target: { value: 'parkir' } });
    await waitFor(() => expect(screen.queryByText('Bayar listrik gudang')).not.toBeInTheDocument());
    expect(screen.getByText('Parkir')).toBeInTheDocument();
  });

  it('Pemilik bisa membatalkan transaksi (modal alasan), transaksi yang sudah batal tidak punya tombol Batalkan', async () => {
    renderWithProviders(<CashPage />);
    await screen.findByText('Bayar listrik gudang');
    const batal = screen.getAllByRole('button', { name: 'Batalkan' });
    expect(batal).toHaveLength(3); // 4 transaksi, satu sudah dibatalkan
    fireEvent.click(batal[0]);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Ini hanya mengoreksi pembukuan/)).toBeInTheDocument();
  });

  it('transaksi keluar tanpa bukti menawarkan "Lengkapi bukti"', async () => {
    renderWithProviders(<CashPage />);
    await screen.findByText('Parkir');
    expect(screen.getAllByRole('button', { name: 'Lengkapi bukti' })).toHaveLength(1);
  });

  it('peran tanpa wewenang kas (Penjualan) tidak melihat tombol uang masuk/keluar maupun Batalkan', async () => {
    role.current = 'SALES';
    renderWithProviders(<CashPage />);
    await screen.findByText('Bayar listrik gudang');
    expect(screen.queryByRole('button', { name: /Uang masuk/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Uang keluar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument();
  });
});
