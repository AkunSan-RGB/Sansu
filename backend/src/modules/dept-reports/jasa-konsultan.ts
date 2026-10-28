import { sql } from 'drizzle-orm';
import { revenueByAccount } from './jasa-shared';
import { jasaReport } from './services';
import { Builder, num, rows } from './types';

/** Laporan konsultan: utilisasi, jam belum ditagih, retainer, pendapatan per klien dan per jenis */
export const jasaKonsultanReport: Builder = async (c) => {
  const base = await jasaReport(c);
  const keep = new Set(['belum-ditagih', 'utilisasi', 'retainer', 'umur']);
  const clients = await rows(c, sql`
    SELECT cu.name AS customer, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp,
      COALESCE((SELECT SUM(t.hours) FROM time_entries t WHERE t.customer_id = cu.id AND t.tenant_id = ${c.tenantId} AND t.status = 'BILLED' AND t.work_date BETWEEN ${c.from}::date AND ${c.to}::date), 0) AS hours
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id
    WHERE i.tenant_id = ${c.tenantId} AND i.date BETWEEN ${c.from}::date AND ${c.to}::date AND NOT i.is_opening
    GROUP BY cu.id, cu.name ORDER BY SUM(i.subtotal) DESC LIMIT 200`);
  const total = clients.reduce((a, x) => a + num(x.dpp), 0);
  return {
    kpis: base.kpis.filter((k) => !/Uang muka/.test(k.label)),
    sections: [
      { key: 'klien', title: 'Pendapatan per klien', note: 'Tagihan sebelum PPN pada periode; jam = jam yang sudah ditagih dari lembar waktu.', columns: [{ key: 'customer', label: 'Klien' }, { key: 'invoices', label: 'Tagihan', type: 'int' }, { key: 'dpp', label: 'Sebelum PPN', type: 'money' }, { key: 'share', label: 'Porsi', type: 'pct' }, { key: 'hours', label: 'Jam ditagih', type: 'hours' }], rows: clients.map((x) => ({ ...x, share: total ? Math.round((num(x.dpp) / total) * 1000) / 10 : null })), empty: 'Belum ada tagihan pada periode ini.' },
      ...base.sections.filter((s) => keep.has(s.key)),
      await revenueByAccount(c),
    ],
  };
};
