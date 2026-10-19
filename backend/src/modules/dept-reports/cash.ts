import { sql } from 'drizzle-orm';
import { Builder, num, rows } from './types';

export const cashReport: Builder = async (c) => {
  const accts = await rows(c, sql`
    SELECT a.code, a.name AS account,
      COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.date < ${c.from}::date), 0) AS opening,
      COALESCE(SUM(l.debit) FILTER (WHERE e.date BETWEEN ${c.from}::date AND ${c.to}::date), 0) AS inflow,
      COALESCE(SUM(l.credit) FILTER (WHERE e.date BETWEEN ${c.from}::date AND ${c.to}::date), 0) AS outflow,
      COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.date <= ${c.to}::date), 0) AS closing
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries e ON e.id = l.journal_id
    WHERE a.tenant_id = ${c.tenantId} AND a.is_cash_account AND a.is_postable AND a.is_active GROUP BY a.code, a.name ORDER BY a.code`);
  const daily = await rows(c, sql`
    SELECT to_char(e.date, 'YYYY-MM-DD') AS day, SUM(l.debit) AS inflow, SUM(l.credit) AS outflow, SUM(l.debit - l.credit) AS net
    FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE a.tenant_id = ${c.tenantId} AND a.is_cash_account AND a.is_postable AND e.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY 1 ORDER BY 1`);
  const bySource = await rows(c, sql`
    SELECT e.source_type AS source, COUNT(*)::int AS lines, SUM(l.debit) AS inflow, SUM(l.credit) AS outflow
    FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE a.tenant_id = ${c.tenantId} AND a.is_cash_account AND a.is_postable AND e.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY e.source_type ORDER BY SUM(l.debit + l.credit) DESC`);
  const recon = await rows(c, sql`
    SELECT a.code, a.name AS account, r.period AS last_period, r.book_balance AS balance, r.signed_at AS signed_at
    FROM accounts a LEFT JOIN LATERAL (SELECT period, book_balance, signed_at FROM bank_reconciliations x WHERE x.cash_account_id = a.id AND x.tenant_id = ${c.tenantId} ORDER BY period DESC LIMIT 1) r ON true
    WHERE a.tenant_id = ${c.tenantId} AND a.is_cash_account AND a.is_postable AND a.is_active AND a.system_key IS DISTINCT FROM 'CASH' ORDER BY a.code`);
  const lastMonth = new Date(Date.parse(`${c.today}T00:00:00Z`)); lastMonth.setUTCDate(1); lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const lastMonthKey = lastMonth.toISOString().slice(0, 7);
  const reconRows = recon.map((r) => ({ ...r, status: !r.last_period ? 'Belum pernah dicocokkan' : String(r.last_period) < lastMonthKey ? 'Terlambat' : 'Terbaru' }));
  const late = reconRows.filter((r) => r.status !== 'Terbaru').length;
  return {
    kpis: [
      { label: 'Saldo kas & bank akhir', value: accts.reduce((a, r) => a + num(r.closing), 0), type: 'money' }, { label: 'Uang masuk', value: accts.reduce((a, r) => a + num(r.inflow), 0), type: 'money' },
      { label: 'Uang keluar', value: accts.reduce((a, r) => a + num(r.outflow), 0), type: 'money' }, { label: 'Rekening belum dicocokkan bulan lalu', value: late, type: 'int', tone: late ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'saldo', title: 'Saldo per akun', note: 'Dari buku besar; perpindahan antar akun kas ikut terhitung sebagai masuk dan keluar.', columns: [{ key: 'code', label: 'Kode' }, { key: 'account', label: 'Akun' }, { key: 'opening', label: 'Saldo awal', type: 'money' }, { key: 'inflow', label: 'Masuk', type: 'money' }, { key: 'outflow', label: 'Keluar', type: 'money' }, { key: 'closing', label: 'Saldo akhir', type: 'money' }], rows: accts },
      { key: 'harian', title: 'Arus per hari', columns: [{ key: 'day', label: 'Tanggal', type: 'date' }, { key: 'inflow', label: 'Masuk', type: 'money' }, { key: 'outflow', label: 'Keluar', type: 'money' }, { key: 'net', label: 'Bersih', type: 'money' }], rows: daily },
      { key: 'sumber', title: 'Menurut sumber', note: 'Dari jenis dokumen yang membuat jurnal kas/bank.', columns: [{ key: 'source', label: 'Sumber' }, { key: 'lines', label: 'Jurnal', type: 'int' }, { key: 'inflow', label: 'Masuk', type: 'money' }, { key: 'outflow', label: 'Keluar', type: 'money' }], rows: bySource },
      { key: 'pencocokan', title: 'Pencocokan bank', note: 'Pencocokan terakhir per rekening bank.', columns: [{ key: 'code', label: 'Kode' }, { key: 'account', label: 'Rekening' }, { key: 'last_period', label: 'Periode terakhir' }, { key: 'balance', label: 'Saldo buku', type: 'money' }, { key: 'status', label: 'Status' }], rows: reconRows },
    ],
  };
};
