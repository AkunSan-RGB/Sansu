import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Seed demo (npm run db:seed) tidak dijalankan oleh tes e2e, jadi aturan saldo awal dijaga di sini:
 * Ekuitas Saldo Awal (3-9000) diisi otomatis sebagai penyeimbang dan ditolak bila dimasukkan manual (AccountingService.openingBalance).
 * Seed yang memasukkannya manual membuat db:seed gagal di database baru.
 */
describe('seed demo: saldo awal', () => {
  const src = readFileSync(join(__dirname, 'simulate.ts'), 'utf8');
  const opening = src.slice(src.indexOf('accounting.openingBalance('), src.indexOf('accounting.openingBalance(') + 1200);

  it('tidak mengisi Ekuitas Saldo Awal (3-9000) secara manual', () => {
    expect(opening).toContain("date: '2025-12-31'");
    expect(opening).not.toMatch(/3-9000/);
    expect(opening).not.toMatch(/OPENING_EQUITY/);
  });

  it('tidak mengisi akun kontrol (persediaan, piutang, utang) secara manual', () => {
    for (const code of ['1-1300', '1-1310', '1-1400', '2-1100']) expect(opening).not.toContain(`'${code}'`);
  });
});
