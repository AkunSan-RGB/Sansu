import { isRoleBlocked, isRoleOffered, MODEL_ROLES, roleCatalog, roleLabelFor, validateRoleCustomization } from '@sansu/shared';
import { BUSINESS_MODEL_KEYS } from '@sansu/shared';

describe('katalog peran per jenis usaha', () => {
  it('sebutan mengikuti jenis usaha; perusahaan dapat menimpanya; bawaan bila tidak ada', () => {
    expect(roleLabelFor('WAREHOUSE', 'JASA')).toBe('Koordinator lapangan');
    expect(roleLabelFor('WAREHOUSE', 'UTILITAS')).toBe('Petugas lapangan');
    expect(roleLabelFor('WAREHOUSE', 'DAGANG')).toBe('Gudang');
    expect(roleLabelFor('WAREHOUSE', 'JASA', { labels: { WAREHOUSE: ' Penyelia  ' } })).toBe('Penyelia');
    expect(roleLabelFor('OWNER', 'JASA')).toBe('Pemilik');
    expect(roleLabelFor('SALES', undefined)).toBe('Sales');
  });

  it('semua jenis usaha menawarkan Pemilik dan Admin; Kasir tidak ditawarkan usaha tanpa kasir kecuali aplikasi Kasir menyala', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      expect(isRoleOffered('OWNER', m)).toBe(true);
      expect(isRoleOffered('ADMIN', m, { hidden: ['ADMIN' as never] })).toBe(true);
    }
    expect(isRoleOffered('CASHIER', 'DAGANG')).toBe(false);
    expect(isRoleOffered('CASHIER', 'DAGANG', undefined, ['pos'])).toBe(true);
    expect(isRoleOffered('CASHIER', 'RITEL')).toBe(true);
    expect(isRoleOffered('CASHIER', 'JASA')).toBe(true);
  });

  it('penyesuaian perusahaan menyembunyikan atau menambahkan peran tanpa menyentuh jenis usaha lain', () => {
    expect(isRoleOffered('PURCHASING', 'JASA', { hidden: ['PURCHASING'] })).toBe(false);
    expect(isRoleOffered('PURCHASING', 'RITEL')).toBe(true);
    expect(isRoleOffered('CASHIER', 'MANUFAKTUR', { extra: ['CASHIER'] })).toBe(true);
    expect(roleCatalog('JASA', { hidden: ['HR'] }).find((r) => r.role === 'HR')?.offered).toBe(false);
  });

  it('validasi penyesuaian menolak sebutan pendek/panjang/kembar, peran tak dikenal, dan menyembunyikan Pemilik/Admin', () => {
    expect(validateRoleCustomization({ labels: { SALES: 'X' } })).toMatch(/2–40/);
    expect(validateRoleCustomization({ labels: { SALES: 'a'.repeat(41) } })).toMatch(/2–40/);
    expect(validateRoleCustomization({ labels: { SALES: 'Admin akademik', WAREHOUSE: 'admin akademik' } })).toMatch(/kembar/);
    expect(validateRoleCustomization({ hidden: ['OWNER'] })).toMatch(/tidak boleh disembunyikan/);
    expect(validateRoleCustomization({ hidden: ['ADMIN'] })).toMatch(/tidak boleh disembunyikan/);
    expect(validateRoleCustomization({ hidden: ['BOSS' as never] })).toMatch(/tidak dikenal/);
    expect(validateRoleCustomization({ labels: { SALES: 'Admin akademik' }, hidden: ['HR'], extra: ['CASHIER'] })).toBeNull();
  });

  it('hanya peran yang disembunyikan perusahaan yang diblokir di server; bawaan jenis usaha tidak', () => {
    expect(isRoleBlocked('CASHIER', undefined)).toBe(false);
    expect(isRoleBlocked('PURCHASING', { hidden: ['PURCHASING'] })).toBe(true);
    expect(isRoleBlocked('ADMIN', { hidden: ['ADMIN' as never] })).toBe(false);
  });

  it('setiap jenis usaha terdaftar di katalog', () => {
    for (const m of BUSINESS_MODEL_KEYS) expect(MODEL_ROLES[m]).toBeDefined();
  });
});
