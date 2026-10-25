import { Db } from '../../db/db';
import { queryTaxPayment, queryJournalEntry, queryPayrollRun } from './tax-controls.repository';

export interface TaxFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;

/**
 * Temuan pajak yang berbasis bukti data (bukan tafsir aturan): setoran tanpa NTPN, jurnal manual ke akun pajak,
 * PPh 21 yang sudah dipotong di slip gaji tetapi belum tercatat disetor untuk masa yang lewat jatuh tempo.
 * Ketentuan tenggat memakai kebiasaan umum (setor tanggal 10 bulan berikutnya) — tinjau dengan konsultan pajak.
 */
export async function taxFindings(db: Db, tenantId: string, since: string, today: string): Promise<TaxFinding[]> {
  const out: TaxFinding[] = [];
  const add = (key: string, level: TaxFinding['level'], title: string, refs: string[], detail: string) => {
    if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
  };

  const noNtpn = await queryTaxPayment(db, tenantId, since, today);
  add(
    'TAX_NO_NTPN',
    'warning',
    'Setoran pajak tanpa NTPN',
    noNtpn.rows.map((r) => `${r.number} ${r.type} masa ${r.period} ${rp(r.v)}`),
    'Bukti setor resmi (NTPN) belum diisi lebih dari 7 hari. Tanpa NTPN, setoran sulit dibuktikan ke kantor pajak dan bisa fiktif.',
  );

  const manual = await queryJournalEntry(db, tenantId, since);
  add(
    'TAX_MANUAL_JOURNAL',
    'warning',
    'Jurnal manual ke akun pajak',
    manual.rows.map((r) => `${r.number} (${r.d}) ${r.acc}`),
    'Akun PPN dan PPh seharusnya bergerak lewat faktur, slip gaji, dan setoran pajak. Jurnal manual ke sana membuat saldo pajak tidak cocok dengan dokumennya.',
  );

  const unpaid = await queryPayrollRun(db, tenantId, today);
  add(
    'PPH21_UNPAID',
    'warning',
    'PPh 21 dipotong dari gaji tetapi belum tercatat disetor',
    unpaid.rows
      .filter((r) => Number(r.withheld) - Number(r.paid) >= 1)
      .map((r) => `Masa ${r.period}: dipotong ${rp(r.withheld)}, disetor ${rp(r.paid)}`),
    'Pajak yang dipotong dari karyawan adalah titipan. Setoran umumnya jatuh tempo tanggal 10 bulan berikutnya; catat setoran di Pajak atau telusuri ke mana uangnya.',
  );

  return out;
}
