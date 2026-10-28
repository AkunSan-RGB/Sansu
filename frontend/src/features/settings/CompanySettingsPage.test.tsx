// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ me: { name: 'Uji', role: 'OWNER', businessModel: 'RITEL', tenantName: 'PT Uji', tenantId: 't1', framework: 'SAK_EMKM' } }) }));
vi.mock('@/lib/apps', async (orig) => ({ ...(await orig<typeof import('@/lib/apps')>()), useApps: () => ({ can: () => false, enabled: new Set(), isAdmin: true }) }));
// kartu dan tab lain punya tes sendiri; di sini yang diuji adalah rangka halaman dan formulir profil
for (const f of ['BrandingCard', 'BranchFeatureCard', 'RecipeTermCard', 'BusinessModelCard', 'ServiceProfilesCard', 'RoleCustomizationCard', 'ModelSetupCard', 'AccountingPolicyTab', 'ApprovalPolicyTab', 'PayrollSettingsTab', 'ReminderSettingsCard', 'SupportThresholdsCard', 'DataPrivacyCard', 'EntityProfileWizard']) vi.doMock(`./${f}`, () => ({ default: () => null }));

import CompanySettingsPage from './CompanySettingsPage';

const COMPANY = { name: 'PT Contoh Abadi', npwp: '01.234.567.8-901.000', address: 'Jl. Merdeka 1', ppnRate: '11', taxProfile: { pkp: true, posPricesIncludeVat: true, salesPricesIncludeVat: false }, payroll: {}, reporting: { framework: 'SAK_EMKM', taxScheme: 'NORMAL' } };

describe('Pengaturan perusahaan (CompanySettingsPage)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockImplementation(async (url: string) => (url.startsWith('/settings/company') ? COMPANY : {}));
    patch.mockResolvedValue({});
  });

  it('menampilkan ringkasan perusahaan: nama, jenis usaha, dan status PKP', async () => {
    renderWithProviders(<CompanySettingsPage />);
    await screen.findByText('PT Contoh Abadi');
    expect(screen.getByText('Ritel / toko')).toBeInTheDocument();
    expect(screen.getAllByText('PKP').length).toBeGreaterThan(0);
  });

  it('formulir profil terisi dari server dan menyimpan perubahan nama lewat PATCH', async () => {
    renderWithProviders(<CompanySettingsPage />);
    const name = (await screen.findByLabelText('Nama perusahaan')) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('PT Contoh Abadi'));
    expect((screen.getByLabelText('NPWP') as HTMLInputElement).value).toBe('01.234.567.8-901.000');
    fireEvent.change(name, { target: { value: 'PT Contoh Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [path, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/settings/company');
    expect(body.name).toBe('PT Contoh Baru');
  });

  it('nama perusahaan wajib diisi: tidak mengirim bila dikosongkan', async () => {
    renderWithProviders(<CompanySettingsPage />);
    const name = (await screen.findByLabelText('Nama perusahaan')) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('PT Contoh Abadi'));
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await screen.findByText('Nama perusahaan wajib diisi', {}, { timeout: 8000 });
    expect(patch).not.toHaveBeenCalled();
  });

  it('daftar tab memuat Profil, Pajak, dan pengaturan khusus jenis usaha', async () => {
    renderWithProviders(<CompanySettingsPage />);
    await screen.findByText('PT Contoh Abadi');
    expect(screen.getAllByText('Profil perusahaan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pajak').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pengaturan Ritel/).length).toBeGreaterThan(0);
  });
});
