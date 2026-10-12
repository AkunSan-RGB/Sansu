import { describeAudit } from './audit.module';
import { sanitize } from '../../common/audit/audit.interceptor';

describe('jejak audit: label & sanitasi', () => {
  it.each([
    ['POST /api/products', 'Membuat produk', 'master'],
    ['PATCH /api/products/:id', 'Mengubah produk', 'master'],
    ['POST /api/accounting/journals', 'Membuat jurnal umum', 'accounting'],
    ['POST /api/accounting/journals/:id/reverse', 'Membalik jurnal umum', 'accounting'],
    ['POST /api/accounting/period/lock', 'Mengunci periode akuntansi', 'accounting'],
    ['PATCH /api/users/:id', 'Mengubah akses pengguna', 'security'],
    ['POST /api/apps/:key/install', 'Mengaktifkan aplikasi', 'settings'],
    ['PATCH /api/settings/branding', 'Mengubah kop surat', 'settings'],
    ['POST /api/payroll/runs/:id/post', 'Memposting penggajian', 'hr'],
  ])('%s → %s', (route, label, category) => {
    expect(describeAudit('UPDATE', 'API', { route })).toEqual({ label, category });
  });
  it('catatan rinci & login', () => {
    expect(describeAudit('CONFIRM', 'SalesOrder', null)).toEqual({ label: 'Mengonfirmasi sales order', category: 'sales' });
    expect(describeAudit('LOGIN', 'API', { route: 'POST /api/auth/login' }).label).toBe('Masuk ke aplikasi');
  });
  it('rahasia disembunyikan, data besar dipotong', () => {
    const s = sanitize({ password: 'x', newPassword: 'y', name: 'A', logo: 'data:image/png;base64,AAA', rows: Array.from({ length: 30 }, (_, i) => i) }) as Record<string, unknown>;
    expect(s).toMatchObject({ password: '***', newPassword: '***', name: 'A', logo: '(berkas)' });
    expect((s.rows as unknown[]).length).toBe(21);
  });
});
