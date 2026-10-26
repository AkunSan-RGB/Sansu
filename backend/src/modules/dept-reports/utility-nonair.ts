import { AIR_REVENUE_KEYS, NON_AIR_CHARGE_KEYS, NON_AIR_REVENUE_KEYS, REVENUE_KEY_LABELS } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { Builder, num, rows } from './types';

const inList = (keys: readonly string[]) => sql.join(keys.map((k) => sql`${k}`), sql`, `);
/** Faktur layanan non-air = faktur yang barisnya masuk akun pendapatan non-air dan bukan tagihan meter bulanan */
const chargeInvoice = (tenantId: string) => sql`i.tenant_id = ${tenantId} AND NOT EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id)
  AND EXISTS (SELECT 1 FROM service_invoice_lines sl JOIN accounts sa ON sa.id = sl.account_id WHERE sl.invoice_id = i.id AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}))`;

/**
 * Laporan layanan non-air: sambung baru, sambung kembali, ganti meter/material, administrasi, denda, dan layanan lain.
 * Terpisah dari penjualan air (pemakaian + abonemen) dan dicocokkan dengan buku besar.
 */
export const utilityNonAirReport: Builder = async (c) => {
  const pFrom = c.from.slice(0, 7);
  const pTo = c.to.slice(0, 7);
  const allKeys = [...AIR_REVENUE_KEYS, ...NON_AIR_REVENUE_KEYS];

  const gl = await rows<{ month: string; key: string; amt: string }>(c, sql`
    SELECT to_char(j.date, 'YYYY-MM') AS month, a.system_key AS key, COALESCE(SUM(l.credit - l.debit), 0)::text AS amt
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE j.tenant_id = ${c.tenantId} AND j.date BETWEEN ${c.from} AND ${c.to} AND a.system_key IN (${inList(allKeys)}) GROUP BY 1, 2 ORDER BY 1`);
  const glBy = new Map<string, number>();
  for (const r of gl) glBy.set(`${r.month}|${r.key}`, num(r.amt));
  const months = [...new Set(gl.map((r) => r.month))].sort();
  const sumKeys = (m: string, keys: readonly string[]) => keys.reduce((a, k) => a + (glBy.get(`${m}|${k}`) ?? 0), 0);
  const totalBy = (keys: readonly string[]) => months.reduce((a, m) => a + sumKeys(m, keys), 0);
  const nonAirTotal = totalBy(NON_AIR_REVENUE_KEYS);
  const airTotal = totalBy(AIR_REVENUE_KEYS);

  const byAccount = NON_AIR_REVENUE_KEYS.map((k) => ({ key: k, layanan: REVENUE_KEY_LABELS[k] ?? k, amount: months.reduce((a, m) => a + (glBy.get(`${m}|${k}`) ?? 0), 0) }));
  const accountRows = byAccount.map((r) => ({ layanan: r.layanan, amount: r.amount, pct: nonAirTotal ? (r.amount / nonAirTotal) * 100 : 0 }));

  const monthRows = months.map((m) => {
    const nonAir = sumKeys(m, NON_AIR_REVENUE_KEYS);
    const air = sumKeys(m, AIR_REVENUE_KEYS);
    const row: Record<string, unknown> = { month: m };
    for (const k of NON_AIR_REVENUE_KEYS) row[k] = glBy.get(`${m}|${k}`) ?? 0;
    return { ...row, nonAir, air, pct: nonAir + air ? (nonAir / (nonAir + air)) * 100 : 0 };
  });

  const invoices = await rows(c, sql`
    SELECT i.number, i.date, i.due_date AS due, cu.name AS customer, string_agg(DISTINCT sl.description, '; ') AS service, SUM(sl.line_total) AS dpp, i.tax_amount AS tax, i.total, i.paid_amount AS paid,
      (i.total - i.paid_amount - i.returned_amount) AS open, i.status,
      CASE WHEN i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < ${c.to}::date THEN (${c.to}::date - i.due_date)::int ELSE 0 END AS late_days
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts sa ON sa.id = sl.account_id
    WHERE ${chargeInvoice(c.tenantId)} AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}) AND i.date BETWEEN ${c.from} AND ${c.to}
    GROUP BY i.id, cu.name ORDER BY i.date DESC, i.number DESC LIMIT 1000`);

  const perService = await rows(c, sql`
    SELECT sl.description AS service, sa.name AS account, COUNT(DISTINCT i.id)::int AS invoices, SUM(sl.qty) AS qty, SUM(sl.line_total) AS dpp
    FROM invoices i JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts sa ON sa.id = sl.account_id
    WHERE ${chargeInvoice(c.tenantId)} AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}) AND i.date BETWEEN ${c.from} AND ${c.to}
    GROUP BY sl.description, sa.name ORDER BY SUM(sl.line_total) DESC`);

  const perCustomer = await rows(c, sql`
    SELECT cu.name AS customer, COUNT(*)::int AS invoices, SUM(i.total) AS total, SUM(i.paid_amount) AS paid, SUM(i.total - i.paid_amount - i.returned_amount) AS open
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id
    WHERE ${chargeInvoice(c.tenantId)} AND i.date BETWEEN ${c.from} AND ${c.to} GROUP BY cu.name ORDER BY SUM(i.total) DESC LIMIT 200`);

  const aging = await rows<{ bucket: string; ord: number; invoices: number; open: string }>(c, sql`
    SELECT x.bucket, x.ord, COUNT(*)::int AS invoices, SUM(x.open)::text AS open FROM (
      SELECT (i.total - i.paid_amount - i.returned_amount) AS open,
        CASE WHEN i.due_date >= ${c.to}::date THEN 'Belum jatuh tempo' WHEN ${c.to}::date - i.due_date <= 30 THEN '1–30 hari' WHEN ${c.to}::date - i.due_date <= 60 THEN '31–60 hari' WHEN ${c.to}::date - i.due_date <= 90 THEN '61–90 hari' ELSE 'Lebih dari 90 hari' END AS bucket,
        CASE WHEN i.due_date >= ${c.to}::date THEN 0 WHEN ${c.to}::date - i.due_date <= 30 THEN 1 WHEN ${c.to}::date - i.due_date <= 60 THEN 2 WHEN ${c.to}::date - i.due_date <= 90 THEN 3 ELSE 4 END AS ord
      FROM invoices i WHERE ${chargeInvoice(c.tenantId)} AND i.date <= ${c.to} AND i.total - i.paid_amount - i.returned_amount > 0.5) x GROUP BY x.bucket, x.ord ORDER BY x.ord`);

  const receipts = await rows(c, sql`
    SELECT p.date, p.number, i.number AS invoice, cu.name AS customer, p.amount, p.method, COALESCE(ct.name, '-') AS counter, COALESCE(r.channel, '-') AS channel
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers cu ON cu.id = p.customer_id
    LEFT JOIN utility_counter_receipts r ON r.payment_id = p.id LEFT JOIN utility_counters ct ON ct.id = r.counter_id
    WHERE ${chargeInvoice(c.tenantId)} AND p.date BETWEEN ${c.from} AND ${c.to} ORDER BY p.date DESC, p.number DESC LIMIT 1000`);

  const lateFees = await rows(c, sql`
    SELECT b.period, uc.number AS connection, cu.name AS customer, b.late_fee AS fee, i.number AS invoice, i.status
    FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections uc ON uc.id = b.connection_id JOIN customers cu ON cu.id = uc.customer_id
    WHERE b.tenant_id = ${c.tenantId} AND b.late_fee > 0 AND i.date BETWEEN ${c.from} AND ${c.to} ORDER BY b.period DESC, uc.number LIMIT 500`);

  const [recon] = await rows<{ docs: string; gl: string }>(c, sql`
    SELECT (SELECT COALESCE(SUM(sl.line_total), 0) FROM invoices i JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts sa ON sa.id = sl.account_id
              WHERE ${chargeInvoice(c.tenantId)} AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}) AND i.date BETWEEN ${c.from} AND ${c.to} AND i.journal_id IS NOT NULL)::text AS docs,
           (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
              WHERE a.type = 'REVENUE' AND l.journal_id IN (SELECT i.journal_id FROM invoices i WHERE ${chargeInvoice(c.tenantId)} AND i.date BETWEEN ${c.from} AND ${c.to} AND i.journal_id IS NOT NULL))::text AS gl`);
  const diff = num(recon?.docs) - num(recon?.gl);

  const sumOf = (xs: Record<string, unknown>[], k: string) => xs.reduce((a, r) => a + num(r[k]), 0);
  const open = sumOf(invoices, 'open');
  const lateTotal = totalBy(['UTILITY_LATE_FEE_REVENUE']);
  void pFrom;
  void pTo;

  const monthCols = [
    { key: 'month', label: 'Bulan' },
    ...NON_AIR_REVENUE_KEYS.map((k) => ({ key: k, label: REVENUE_KEY_LABELS[k] ?? k, type: 'money' as const })),
    { key: 'nonAir', label: 'Total non-air', type: 'money' as const },
    { key: 'air', label: 'Pendapatan air (pembanding)', type: 'money' as const },
    { key: 'pct', label: 'Porsi non-air', type: 'pct' as const },
  ];

  return {
    kpis: [
      { label: 'Pendapatan non-air (buku besar)', value: nonAirTotal, type: 'money' },
      { label: 'Porsi dari seluruh pendapatan layanan', value: nonAirTotal + airTotal ? (nonAirTotal / (nonAirTotal + airTotal)) * 100 : 0, type: 'pct' },
      { label: 'Faktur layanan non-air', value: invoices.length, type: 'int' },
      { label: 'Nilai tagihan (termasuk PPN)', value: sumOf(invoices, 'total'), type: 'money' },
      { label: 'Sudah dibayar', value: sumOf(invoices, 'paid'), type: 'money', tone: 'ok' },
      { label: 'Belum dibayar', value: open, type: 'money', tone: open > 0 ? 'warn' : 'ok' },
      { label: 'Denda keterlambatan', value: lateTotal, type: 'money' },
      { label: 'Selisih dengan buku besar', value: diff, type: 'money', tone: Math.abs(diff) < 1 ? 'ok' : 'warn' },
    ],
    sections: [
      { key: 'ringkasan', title: 'Pendapatan per jenis layanan', note: 'Dari buku besar: akun pendapatan non-air pada rentang tanggal. "Biaya administrasi" juga memuat biaya admin pada tagihan air bulanan; "Denda" berasal dari tagihan air yang menunggak.', columns: [{ key: 'layanan', label: 'Jenis layanan' }, { key: 'amount', label: 'Pendapatan', type: 'money' }, { key: 'pct', label: 'Porsi', type: 'pct' }], rows: accountRows },
      { key: 'bulanan', title: 'Per bulan', note: 'Pendapatan non-air tiap bulan per jenis, dibandingkan dengan pendapatan air.', columns: monthCols, rows: monthRows },
      { key: 'layanan', title: 'Per layanan (daftar harga)', note: 'Layanan yang ditagih lewat menu Layanan non-air, dikelompokkan menurut nama layanan.', columns: [{ key: 'service', label: 'Layanan' }, { key: 'account', label: 'Akun pendapatan' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'dpp', label: 'Nilai (sebelum PPN)', type: 'money' }], rows: perService },
      { key: 'faktur', title: 'Daftar tagihan non-air', note: 'Satu baris per faktur: nilai, PPN, pembayaran, sisa, dan keterlambatan pada tanggal akhir laporan.', columns: [{ key: 'date', label: 'Tanggal', type: 'date' }, { key: 'number', label: 'Faktur' }, { key: 'customer', label: 'Pelanggan' }, { key: 'service', label: 'Layanan' }, { key: 'dpp', label: 'Sebelum PPN', type: 'money' }, { key: 'tax', label: 'PPN', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Dibayar', type: 'money' }, { key: 'open', label: 'Sisa', type: 'money' }, { key: 'due', label: 'Jatuh tempo', type: 'date' }, { key: 'late_days', label: 'Terlambat (hari)', type: 'int' }, { key: 'status', label: 'Status' }], rows: invoices },
      { key: 'pelanggan', title: 'Per pelanggan', columns: [{ key: 'customer', label: 'Pelanggan' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'total', label: 'Total tagihan', type: 'money' }, { key: 'paid', label: 'Dibayar', type: 'money' }, { key: 'open', label: 'Sisa', type: 'money' }], rows: perCustomer },
      { key: 'umur', title: 'Umur piutang non-air', note: 'Sisa tagihan layanan non-air pada tanggal akhir laporan, menurut lama lewat jatuh tempo.', columns: [{ key: 'bucket', label: 'Umur' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'open', label: 'Sisa tagihan', type: 'money' }], rows: aging },
      { key: 'penerimaan', title: 'Penerimaan pembayaran', note: 'Pembayaran atas tagihan non-air pada rentang tanggal, beserta loket dan kanalnya bila diterima di loket.', columns: [{ key: 'date', label: 'Tanggal', type: 'date' }, { key: 'number', label: 'Pembayaran' }, { key: 'invoice', label: 'Faktur' }, { key: 'customer', label: 'Pelanggan' }, { key: 'amount', label: 'Jumlah', type: 'money' }, { key: 'counter', label: 'Loket' }, { key: 'channel', label: 'Kanal' }], rows: receipts },
      { key: 'denda', title: 'Denda keterlambatan', note: 'Denda yang ditagihkan bersama tagihan air bulanan pada rentang tanggal.', columns: [{ key: 'period', label: 'Periode tagihan' }, { key: 'connection', label: 'Sambungan' }, { key: 'customer', label: 'Pelanggan' }, { key: 'fee', label: 'Denda', type: 'money' }, { key: 'invoice', label: 'Faktur' }, { key: 'status', label: 'Status' }], rows: lateFees },
      { key: 'pencocokan', title: 'Pencocokan dengan buku besar', note: 'Nilai faktur layanan non-air (sebelum PPN) harus sama dengan akun pendapatan pada jurnal faktur itu. Selisih berarti jurnal diubah di luar dokumen.', columns: [{ key: 'item', label: 'Uraian' }, { key: 'amount', label: 'Jumlah', type: 'money' }], rows: [{ item: 'Faktur layanan non-air (sebelum PPN)', amount: num(recon?.docs) }, { item: 'Akun pendapatan pada jurnal faktur tersebut', amount: num(recon?.gl) }, { item: 'Selisih', amount: diff }] },
    ],
  };
};
