// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const allowed = { current: new Set<string>() };
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Uji', role: 'OWNER', businessModel: 'DAGANG', tenantName: 'PT Uji', tenantId: 't1' } }) }));
vi.mock('@/auth/useCan', () => ({ useCan: () => (_m: string, path: string) => allowed.current.has(path) }));
vi.mock('@/features/workflow/WorkflowBadge', () => ({ default: () => null }));
vi.mock('@/features/inventory/BinSelect', () => ({ default: () => null, useWarehouseBins: () => ({ enabled: false }) }));
vi.mock('@/components/print/Letterhead', async (orig) => ({ ...(await orig<typeof import('@/components/print/Letterhead')>()), useLetterhead: () => ({}) }));

import PurchaseOrderDetailPage from './PurchaseOrderDetailPage';

const line = (o: Record<string, unknown> = {}) => ({ id: 'l1', productId: 'p1', uom: 'pcs', qty: '10', price: '5000', discountPct: '0', lineTotal: '50000', product: { sku: 'BRG-1', name: 'Kopi' }, receivedQty: '0', billedQty: '0', ...o });
const po = (o: Record<string, unknown> = {}) => ({ id: 'po1', number: 'PO/2026/0001', date: '2026-10-01', status: 'DRAFT', subtotal: '50000', taxAmount: '0', total: '50000', notes: null, supplier: { id: 's1', code: 'S-1', name: 'CV Pemasok Jaya' }, warehouse: { id: 'w1', code: 'G1', name: 'Gudang Utama' }, lines: [line()], invoice: null, receiptStatus: 'NONE', ...o });

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <AntApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/purchase-orders/po1']}>
          <Routes>
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AntApp>,
  );
}

describe('Detail pesanan pembelian (PurchaseOrderDetailPage)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    allowed.current = new Set(['/purchase-orders/:id/confirm', '/purchase-orders/:id/receipts', '/purchase-orders/:id/cancel', '/purchase-invoices']);
  });

  it('PO draft: menampilkan pemasok, gudang, dan tombol Konfirmasi serta Batalkan; belum ada Terima barang', async () => {
    get.mockResolvedValue(po());
    show();
    await screen.findByText('CV Pemasok Jaya');
    expect(screen.getAllByText('Gudang Utama').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Konfirmasi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batalkan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terima barang' })).not.toBeInTheDocument();
  });

  it('tanpa hak mengonfirmasi, tombol Konfirmasi tidak ditampilkan', async () => {
    allowed.current = new Set();
    get.mockResolvedValue(po());
    show();
    await screen.findByText('CV Pemasok Jaya');
    expect(screen.queryByRole('button', { name: 'Konfirmasi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument();
  });

  it('PO terkonfirmasi yang belum diterima: boleh Terima barang, belum bisa Buat faktur sebelum ada barang diterima', async () => {
    get.mockResolvedValue(po({ status: 'CONFIRMED' }));
    show();
    await screen.findByRole('button', { name: 'Terima barang' });
    expect(screen.queryByRole('button', { name: 'Konfirmasi' })).not.toBeInTheDocument();
  });

  it('PO yang sudah diterima penuh tidak menawarkan Terima barang lagi, tetapi menawarkan faktur atas barang diterima', async () => {
    get.mockResolvedValue(po({ status: 'CONFIRMED', receiptStatus: 'FULL', lines: [line({ receivedQty: '10', billedQty: '0' })] }));
    show();
    await waitFor(() => expect(screen.getByText('CV Pemasok Jaya')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Terima barang' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').some((b) => /faktur/i.test(b.textContent ?? ''))).toBe(true);
  });

  it('PO dibatalkan: tanpa tombol cetak dan tanpa aksi lanjutan', async () => {
    get.mockResolvedValue(po({ status: 'CANCELLED' }));
    show();
    await screen.findByText('CV Pemasok Jaya');
    expect(screen.queryByRole('button', { name: /Cetak PO/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Konfirmasi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terima barang' })).not.toBeInTheDocument();
  });
});
