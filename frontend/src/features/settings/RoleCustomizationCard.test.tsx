// @vitest-environment jsdom
import { roleCatalog } from '@sansu/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const put = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), del: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { role: 'OWNER', businessModel: 'JASA', apps: [] } }) }));

import RoleCustomizationCard from './RoleCustomizationCard';

const view = (customization = {}) => ({ model: 'JASA', customization, catalog: roleCatalog('JASA', customization), baseline: roleCatalog('JASA') });

describe('RoleCustomizationCard', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    put.mockResolvedValue({});
  });

  it('menampilkan sebutan jenis usaha dan keterangan bahwa hak akses tidak berubah', async () => {
    get.mockResolvedValue(view());
    renderWithProviders(<RoleCustomizationCard />);
    await screen.findByText('Peran & sebutan');
    expect(screen.getAllByText('Koordinator lapangan').length).toBeGreaterThan(0);
    expect(screen.getByText(/Hak akses tiap peran tidak berubah/)).toBeInTheDocument();
  });

  it('hanya mengirim selisih dari bawaan jenis usaha: sebutan baru dan peran yang disembunyikan', async () => {
    get.mockResolvedValue(view());
    renderWithProviders(<RoleCustomizationCard />);
    await screen.findByText('Peran & sebutan');
    const inputs = screen.getAllByPlaceholderText('Pemasaran & kontrak');
    fireEvent.change(inputs[0], { target: { value: 'Admin akademik' } });
    // matikan peran Pembelian (Switch ke-6: Pemilik, Admin, Keuangan, Akuntan, Sales, Pembelian)
    fireEvent.click(screen.getAllByRole('switch')[5]);
    fireEvent.click(screen.getByRole('button', { name: /Simpan penyesuaian/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toBe('/settings/customization/roles');
    expect(put.mock.calls[0][1]).toEqual({ labels: { SALES: 'Admin akademik' }, hidden: ['PURCHASING'], extra: [] });
  });

  it('Pemilik dan Admin tidak dapat disembunyikan', async () => {
    get.mockResolvedValue(view());
    renderWithProviders(<RoleCustomizationCard />);
    await screen.findByText('Peran & sebutan');
    const sw = screen.getAllByRole('switch');
    expect(sw[0]).toBeDisabled();
    expect(sw[1]).toBeDisabled();
    expect(sw[2]).not.toBeDisabled();
  });
});
