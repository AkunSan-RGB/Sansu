import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { Db } from '../../db/db';

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

  const noNtpn = await db.execute<{ number: string; type: string; period: string; v: string }>(sql`
    SELECT number, type, period, amount::text AS v FROM tax_payments
    WHERE tenant_id = ${tenantId} AND date >= ${since} AND date <= ${addDays(today, -7)} AND COALESCE(NULLIF(TRIM(ntpn), ''), '') = ''
    ORDER BY date DESC LIMIT 30`);
  add('TAX_NO_NTPN', 'warning', 'Setoran pajak tanpa NTPN', noNtpn.rows.map((r) => `${r.number} ${r.type} masa ${r.period} ${rp(r.v)}`), 'Bukti setor resmi (NTPN) belum diisi lebih dari 7 hari. Tanpa NTPN, setoran sulit dibuktikan ke kantor pajak dan bisa fiktif.');

  const manual = await db.execute<{ number: string; d: string; acc: string }>(sql`
    SELECT DISTINCT j.number, j.date::text AS d, a.name AS acc
    FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
    WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since}
      AND COALESCE(a.system_key, '') IN ('VAT_IN', 'VAT_OUT', 'PPH21_PAYABLE', 'PPH23_PAYABLE', 'PPH4_2_PAYABLE', 'FINAL_TAX_WITHHELD')
    ORDER BY d DESC LIMIT 30`);
  add('TAX_MANUAL_JOURNAL', 'warning', 'Jurnal manual ke akun pajak', manual.rows.map((r) => `${r.number} (${r.d}) ${r.acc}`), 'Akun PPN dan PPh seharusnya bergerak lewat faktur, slip gaji, dan setoran pajak. Jurnal manual ke sana membuat saldo pajak tidak cocok dengan dokumennya.');

  const unpaid = await db.execute<{ period: string; withheld: string; paid: string }>(sql`
    SELECT r.period, r.total_pph21::text AS withheld,
      COALESCE((SELECT SUM(t.amount) FROM tax_payments t WHERE t.tenant_id = ${tenantId} AND t.type = 'PPH21' AND t.period = r.period), 0)::text AS paid
    FROM payroll_runs r
    WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.total_pph21 > 0
      AND ((r.period || '-01')::date + interval '1 month' + interval '9 days')::date < ${today}::date
    ORDER BY r.period DESC LIMIT 12`);
  add('PPH21_UNPAID', 'warning', 'PPh 21 dipotong dari gaji tetapi belum tercatat disetor', unpaid.rows.filter((r) => Number(r.withheld) - Number(r.paid) >= 1).map((r) => `Masa ${r.period}: dipotong ${rp(r.withheld)}, disetor ${rp(r.paid)}`), 'Pajak yang dipotong dari karyawan adalah titipan. Setoran umumnya jatuh tempo tanggal 10 bulan berikutnya; catat setoran di Pajak atau telusuri ke mana uangnya.');

  return out;
}
