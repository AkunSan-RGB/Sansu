import { productionConfigProblems } from './bootstrap';

const good = {
  JWT_SECRET: 'q8Zr2mK5vX1nB7cD9fG3hJ6kL0pS4tUwYeA2iO8xRzN5bV',
  DATA_ENCRYPTION_KEY: 'Tj3Vb9Xn2Lq7Wc5Hs8Dk1Rp6Fm4Gy0ZaEu9Ni2OtBx7CvQ',
  DATABASE_URL: 'postgresql://sansu_app:Zk29xQw7Lm@db.internal:5432/sansu',
} as NodeJS.ProcessEnv;

describe('productionConfigProblems', () => {
  it('konfigurasi kuat → tidak ada masalah', () => {
    expect(productionConfigProblems(good)).toEqual([]);
  });

  it('DATA_ENCRYPTION_KEY kosong ditolak dengan petunjuk membuatnya', () => {
    const p = productionConfigProblems({ ...good, DATA_ENCRYPTION_KEY: '' });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('DATA_ENCRYPTION_KEY wajib diisi');
    expect(p[0]).toContain('openssl rand');
  });

  it('DATA_ENCRYPTION_KEY pendek, bawaan contoh, atau sama dengan JWT_SECRET ditolak', () => {
    expect(productionConfigProblems({ ...good, DATA_ENCRYPTION_KEY: 'pendek' })[0]).toContain('minimal 32 karakter');
    expect(productionConfigProblems({ ...good, DATA_ENCRYPTION_KEY: 'ganti-dengan-kunci-acak-yang-panjang-sekali-1234' })[0]).toContain('acak');
    expect(productionConfigProblems({ ...good, DATA_ENCRYPTION_KEY: good.JWT_SECRET })[0]).toContain('berbeda dari JWT_SECRET');
  });

  it('JWT_SECRET lemah dan kata sandi database bawaan tetap ditolak', () => {
    const p = productionConfigProblems({ ...good, JWT_SECRET: 'rahasia', DATABASE_URL: 'postgresql://akurata:akurata@localhost/x' });
    expect(p.join('|')).toContain('JWT_SECRET');
    expect(p.join('|')).toContain('Password database');
  });
});
