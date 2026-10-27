// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosSession } from '@/api/types';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Kasir Uji', role: 'CASHIER', businessModel: 'RITEL', tenantName: 'Toko Uji', taxProfile: { pkp: false } } }) }));
vi.mock('../Receipt', () => ({ default: () => null, printReceipt: vi.fn() }));

import { Register } from './Register';

const product = (o: Record<string, unknown>) => ({ id: 'p', sku: 'SKU', name: 'Barang', sellPrice: '10000', stock: '5', baseUom: 'PCS', uoms: [], category: 'Umum', barcode: null, madeToOrder: false, ...o });
const PRODUCTS = [
  product({ id: 'kopi', sku: 'KOPI', name: 'Kopi Susu', sellPrice: '15000', stock: '10' }),
  product({ id: 'teh', sku: 'TEH', name: 'Teh Manis', sellPrice: '8000', stock: '1' }),
  product({ id: 'gratis', sku: 'GRT', name: 'Tanpa Harga', sellPrice: '0', stock: '9' }),
];
const session = { id: 'ses-1', number: 'KS-0001', warehouse: { id: 'wh-1', name: 'Toko Utama' }, summary: { orderCount: 0, totalSales: '0', byMethod: {}, openingCash: '0', expectedCash: '0' } } as unknown as PosSession;

describe('Kasir (Register)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/pos/products')) return PRODUCTS;
      if (url.startsWith('/loyalty/settings')) return { enabled: false, earnPerRp: 10000, pointValueRp: 100, minRedeemPoints: 10, maxRedeemPct: 50, expiryMonths: 12 };
      return [];
    });
    post.mockImplementation(async () => ({ id: 'o1', number: 'POS-1', total: '15000', lines: [], payments: [] }));
  });

  it('klik produk memasukkan ke keranjang dan total terhitung', async () => {
    renderWithProviders(<Register session={session} />);
    fireEvent.click(await screen.findByText('Kopi Susu'));
    await screen.findByText('Keranjang (1)');
    expect(screen.getAllByText(/15\.000/).length).toBeGreaterThan(0);
  });

  it('tidak boleh melebihi stok: klik kedua pada barang berstok 1 ditolak dengan pesan', async () => {
    renderWithProviders(<Register session={session} />);
    const teh = await screen.findByText('Teh Manis');
    fireEvent.click(teh);
    await screen.findByText('Keranjang (1)');
    fireEvent.click(teh);
    await screen.findByText(/Stok Teh Manis tidak cukup/);
    expect(screen.getByText('Keranjang (1)')).toBeInTheDocument();
  });

  it('barang tanpa harga jual tidak masuk keranjang', async () => {
    renderWithProviders(<Register session={session} />);
    fireEvent.click(await screen.findByText('Tanpa Harga'));
    await screen.findByText(/Harga jual Tanpa Harga belum diisi/);
    expect(screen.getByText('Keranjang (0)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bayar/ })).toBeDisabled();
  });

  it('bayar tunai pas: pesanan dikirim sekali dengan baris dan pembayaran yang benar', async () => {
    renderWithProviders(<Register session={session} />);
    fireEvent.click(await screen.findByText('Kopi Susu'));
    await screen.findByText('Keranjang (1)');
    fireEvent.click(screen.getByRole('button', { name: /Bayar/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Uang pas' }));
    const done = within(dlg).getByRole('button', { name: /Selesaikan transaksi/ });
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    fireEvent.click(done); // klik ganda cepat
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { sessionId: string; lines: { productId: string; qty: string; price: string }[]; payments: { method: string; amount: string }[] }];
    expect(path).toBe('/pos/orders');
    expect(body.sessionId).toBe('ses-1');
    expect(body.lines).toEqual([expect.objectContaining({ productId: 'kopi', qty: '1', price: '15000' })]);
    expect(body.payments).toEqual([{ method: 'CASH', amount: '15000.00' }]);
  });

  it('uang diterima kurang dari total: tombol selesai nonaktif dan tercatat kurang', async () => {
    renderWithProviders(<Register session={session} />);
    fireEvent.click(await screen.findByText('Kopi Susu'));
    fireEvent.click(await screen.findByRole('button', { name: /Bayar/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: /Selesaikan transaksi/ })).toBeDisabled();
    expect(within(dlg).getByText(/Kurang/)).toBeInTheDocument();
  });
});
