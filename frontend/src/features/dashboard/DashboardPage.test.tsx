// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const role = { current: 'OWNER' };
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Budi Santoso', role: role.current, businessModel: 'DAGANG', tenantName: 'PT Uji', tenantId: 't1', branchIds: null } }) }));
vi.mock('./InsightPanel', () => ({ default: () => <div>panel-wawasan</div> }));

import DashboardPage from './DashboardPage';

const SUMMARY = { salesMonth: 42425000, grossProfitMonth: 1633276.74, grossMarginPct: 3.8, cashBalance: 662168032, arOutstanding: 71067750, arOverdue: 23976000, apOutstanding: 284320950, stockValue: 226039171.19, ordersPending: 2, invoicesMonth: 4, posOrdersMonth: 0, overdueCount: 1, recentInvoices: [] };

describe('Dasbor', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    role.current = 'OWNER';
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/dashboard/attention')) return { score: 90, grade: 'A', items: [] };
      if (url.startsWith('/dashboard')) return SUMMARY;
      return { branches: [], unassignedWarehouses: [] };
    });
  });

  it('menyapa nama depan, menampilkan jenis usaha dan tiga angka utama tanpa sen', async () => {
    renderWithProviders(<DashboardPage />);
    await screen.findByText(/Rp\s?42\.425\.000/);
    expect(screen.getByText(/Budi/)).toBeInTheDocument();
    expect(screen.getByText('Dagang & distribusi')).toBeInTheDocument();
    expect(screen.getByText(/Rp\s?662\.168\.032/)).toBeInTheDocument();
    // angka ringkasan tidak memuat sen
    expect(screen.getByText(/Rp\s?226\.039\.171$/)).toBeInTheDocument();
  });

  it('kartu angka memuat piutang, hutang, dan margin dengan keterangannya', async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/Jatuh tempo: Rp\s?23\.976\.000/)).toBeInTheDocument();
    expect(screen.getByText('Piutang beredar')).toBeInTheDocument();
    expect(screen.getByText('3.8%')).toBeInTheDocument();
    expect(screen.getByText('Margin kotor')).toBeInTheDocument();
  });

  it('peran tanpa hak melihat keuangan tidak melihat angka uang (server mengirim null)', async () => {
    role.current = 'WAREHOUSE';
    get.mockImplementation(async (url: string) => (url.startsWith('/dashboard') ? { ...SUMMARY, salesMonth: null, grossProfitMonth: null, cashBalance: null, arOutstanding: null, apOutstanding: null, stockValue: null } : { branches: [], unassignedWarehouses: [] }));
    renderWithProviders(<DashboardPage />);
    await screen.findByText(/Selamat/);
    await waitFor(() => expect(screen.queryByText('Piutang beredar')).not.toBeInTheDocument());
    expect(screen.queryByText(/Rp\s?42\.425\.000/)).not.toBeInTheDocument();
  });
});
