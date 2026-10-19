import { sql } from 'drizzle-orm';
import { LOSS_WARN_PCT, ZONE_STATUS_LABEL, zoneLoss } from '../utility/zones';
import { Builder, num, rows } from './types';

export const utilityReport: Builder = async (c) => {
  const pFrom = c.from.slice(0, 7);
  const pTo = c.to.slice(0, 7);
  const status = await rows(c, sql`SELECT uc.status, COUNT(*)::int AS connections FROM utility_connections uc WHERE uc.tenant_id = ${c.tenantId} GROUP BY uc.status ORDER BY 2 DESC`);
  const bills = await rows(c, sql`SELECT b.period, COUNT(*)::int AS bills, SUM(b.usage) AS usage, SUM(b.subtotal) AS subtotal, SUM(b.late_fee) AS late_fee FROM utility_bills b WHERE b.tenant_id = ${c.tenantId} AND b.period BETWEEN ${pFrom} AND ${pTo} GROUP BY b.period ORDER BY b.period`);
  const arrears = await rows(c, sql`
    SELECT uc.number AS connection, cu.name AS customer, COUNT(*)::int AS bills, SUM(i.total - i.paid_amount - i.returned_amount) AS outstanding, MIN(i.due_date) AS oldest_due, (${c.today}::date - MIN(i.due_date))::int AS days
    FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections uc ON uc.id = b.connection_id JOIN customers cu ON cu.id = uc.customer_id
    WHERE b.tenant_id = ${c.tenantId} AND i.status <> 'PAID' AND i.due_date < ${c.today}::date GROUP BY uc.number, cu.name ORDER BY SUM(i.total - i.paid_amount - i.returned_amount) DESC LIMIT 200`);
  const byTariff = await rows(c, sql`SELECT t.name AS tariff, t.unit, COUNT(*)::int AS readings, SUM(r.usage) AS usage FROM utility_readings r JOIN utility_connections uc ON uc.id = r.connection_id JOIN utility_tariffs t ON t.id = uc.tariff_id WHERE r.tenant_id = ${c.tenantId} AND r.period BETWEEN ${pFrom} AND ${pTo} GROUP BY t.name, t.unit ORDER BY SUM(r.usage) DESC`);
  const flags = await rows(c, sql`SELECT f AS flag, COUNT(*)::int AS readings FROM utility_readings r, unnest(r.flags) AS f WHERE r.tenant_id = ${c.tenantId} AND r.period BETWEEN ${pFrom} AND ${pTo} GROUP BY f ORDER BY 2 DESC`);
  const unverified = await rows<{ n: string }>(c, sql`SELECT COUNT(*)::text AS n FROM utility_readings WHERE tenant_id = ${c.tenantId} AND status <> 'VERIFIED' AND period BETWEEN ${pFrom} AND ${pTo}`);
  const loss = await zoneLoss(c.db, c.tenantId, pFrom, pTo);
  const lossHigh = loss.filter((z) => z.status === 'HIGH' || z.status === 'NEGATIVE').length;
  const active = status.filter((s) => String(s.status).toUpperCase().startsWith('ACTIVE') || String(s.status).toUpperCase() === 'AKTIF').reduce((a, s) => a + num(s.connections), 0);
  return {
    kpis: [
      { label: 'Sambungan', value: status.reduce((a, s) => a + num(s.connections), 0), type: 'int' }, { label: 'Sambungan aktif', value: active, type: 'int' },
      { label: 'Tagihan periode ini', value: bills.reduce((a, b) => a + num(b.subtotal), 0), type: 'money' }, { label: 'Tunggakan', value: arrears.reduce((a, r) => a + num(r.outstanding), 0), type: 'money', tone: arrears.length ? 'warn' : 'ok' },
      { label: `Zona kehilangan tinggi (> ${LOSS_WARN_PCT}%)`, value: lossHigh, type: 'int', tone: lossHigh ? 'warn' : 'ok' },
      { label: 'Catatan meter belum diverifikasi', value: num(unverified[0]?.n), type: 'int', tone: num(unverified[0]?.n) ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'sambungan', title: 'Sambungan per status', columns: [{ key: 'status', label: 'Status' }, { key: 'connections', label: 'Sambungan', type: 'int' }], rows: status },
      { key: 'tagihan', title: 'Tagihan per periode', note: 'Periode tagihan bulanan dalam rentang tanggal.', columns: [{ key: 'period', label: 'Periode' }, { key: 'bills', label: 'Tagihan', type: 'int' }, { key: 'usage', label: 'Pemakaian', type: 'qty' }, { key: 'subtotal', label: 'Nilai', type: 'money' }, { key: 'late_fee', label: 'Denda', type: 'money' }], rows: bills },
      { key: 'tunggakan', title: 'Tunggakan', note: 'Tagihan lewat jatuh tempo yang belum lunas, per sambungan.', columns: [{ key: 'connection', label: 'Sambungan' }, { key: 'customer', label: 'Pelanggan' }, { key: 'bills', label: 'Tagihan', type: 'int' }, { key: 'outstanding', label: 'Sisa', type: 'money' }, { key: 'oldest_due', label: 'Tertua jatuh tempo', type: 'date' }, { key: 'days', label: 'Terlambat (hari)', type: 'int' }], rows: arrears, empty: 'Tidak ada tunggakan' },
      { key: 'kehilangan', title: 'Kehilangan per zona', note: `Pasokan zona (meter induk, diisi per bulan di Layanan utilitas › Sambungan pelanggan › Zona) dikurangi pemakaian pelanggan yang sudah diverifikasi. Tanda "tinggi" bila lebih dari ${LOSS_WARN_PCT}% pasokan. Angka belum lengkap bila ada pencatatan belum diverifikasi atau belum dicatat.`, columns: [{ key: 'zone', label: 'Zona' }, { key: 'period', label: 'Periode' }, { key: 'connections', label: 'Sambungan', type: 'int' }, { key: 'supplied', label: 'Pasokan', type: 'qty' }, { key: 'usage', label: 'Pemakaian terverifikasi', type: 'qty' }, { key: 'loss', label: 'Kehilangan', type: 'qty' }, { key: 'lossPct', label: '% kehilangan', type: 'pct' }, { key: 'unit', label: 'Satuan' }, { key: 'statusLabel', label: 'Status' }], rows: loss.map((z) => ({ ...z, statusLabel: ZONE_STATUS_LABEL[z.status] })), empty: 'Belum ada pasokan zona yang diisi pada rentang ini' },
      { key: 'tarif', title: 'Pemakaian per tarif', columns: [{ key: 'tariff', label: 'Tarif' }, { key: 'unit', label: 'Satuan' }, { key: 'readings', label: 'Pencatatan', type: 'int' }, { key: 'usage', label: 'Pemakaian', type: 'qty' }], rows: byTariff },
      { key: 'temuan', title: 'Temuan pencatatan meter', note: 'Tanda yang diberikan sistem pada pencatatan (mis. pemakaian ekstrem, jauh dari lokasi).', columns: [{ key: 'flag', label: 'Tanda' }, { key: 'readings', label: 'Pencatatan', type: 'int' }], rows: flags, empty: 'Tidak ada temuan pada rentang ini' },
    ],
  };
};
