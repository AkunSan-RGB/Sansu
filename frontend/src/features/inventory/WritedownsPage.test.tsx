// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const post = vi.fn();
const role = { current: 'OWNER' };
const canPost = { current: true };
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Uji', role: role.current, businessModel: 'DAGANG', tenantName: 'PT Uji', tenantId: 't1' } }) }));
vi.mock('@/auth/useCan', () => ({ useCan: () => () => canPost.current }));
vi.mock('@/api/queries', async (orig) => ({ ...(await orig<typeof import('@/api/queries')>()), useWarehouses: () => ({ data: [{ id: 'w1', name: 'Gudang Utama' }] }) }));

import WritedownsPage from './WritedownsPage';

const CAND = [
  { productId: 'p1', sku: 'BRG-1', name: 'Kopi Bubuk', unit: 'kg', warehouseId: 'w1', warehouseName: 'Gudang Utama', qty: '10', avgCost: '50000', sellPrice: '40000', nrv: '40000', loss: '100000' },
  { productId: 'p2', sku: 'BRG-2', name: 'Gula Pasir', unit: 'kg', warehouseId: 'w1', warehouseName: 'Gudang Utama', qty: '20', avgCost: '15000', sellPrice: '14000', nrv: '14000', loss: '20000' },
];

describe('Penurunan nilai persediaan (WritedownsPage)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    role.current = 'OWNER';
    canPost.current = true;
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/inventory/writedowns/candidates')) return CAND;
      if (url.startsWith('/inventory/writedowns/recoverable')) return [];
      if (url.startsWith('/inventory/writedowns')) return [];
      if (url.startsWith('/inventory/balances')) return [];
      return [];
    });
  });

  it('peran tanpa hak melihat keuangan hanya melihat penjelasan, tanpa memanggil data', async () => {
    role.current = 'WAREHOUSE';
    renderWithProviders(<WritedownsPage />);
    await screen.findByText(/Hanya Pemilik, Admin, Keuangan, atau Akuntan/);
    expect(get).not.toHaveBeenCalled();
  });

  it('menampilkan barang yang harga jualnya di bawah harga pokok beserta total taksiran rugi', async () => {
    renderWithProviders(<WritedownsPage />);
    await screen.findByText('BRG-1 · Kopi Bubuk');
    expect(screen.getByText('BRG-2 · Gula Pasir')).toBeInTheDocument();
    // 100.000 + 20.000
    expect(screen.getAllByText(/120\.000/).length).toBeGreaterThan(0);
  });

  it('tombol Turunkan nilai nonaktif sampai ada barang dipilih, lalu membuka formulir berisi barang itu', async () => {
    renderWithProviders(<WritedownsPage />);
    await screen.findByText('BRG-1 · Kopi Bubuk');
    const btn = screen.getByRole('button', { name: /Turunkan nilai/ });
    expect(btn).toBeDisabled();
    const row = screen.getByText('BRG-1 · Kopi Bubuk').closest('tr')!;
    fireEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Turunkan nilai \(1 barang\)/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Turunkan nilai \(1 barang\)/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Kopi Bubuk/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled(); // belum disimpan sebelum dikonfirmasi
  });

  it('tanpa hak mencatat, tabel tidak punya pilihan baris dan tombol aksi', async () => {
    canPost.current = false;
    renderWithProviders(<WritedownsPage />);
    await screen.findByText('BRG-1 · Kopi Bubuk');
    expect(screen.queryByRole('button', { name: /Turunkan nilai/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('keadaan kosong menjelaskan bahwa tidak ada barang yang harga jualnya di bawah harga pokok', async () => {
    get.mockImplementation(async () => []);
    renderWithProviders(<WritedownsPage />);
    await screen.findByText('Tidak ada barang yang harga jualnya di bawah harga pokok');
  });
});
