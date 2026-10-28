import { sql } from 'drizzle-orm';
import { projectCostsSql } from '../../common/project-costs';
import { revenueByAccount } from './jasa-shared';
import { AGING_COLS, arAging } from './sales';
import { Builder, num, rows } from './types';

/** Laporan kontraktor: laba per proyek, retensi, kemajuan BoQ, biaya langsung per jenis */
export const jasaKontraktorReport: Builder = async (c) => {
  const projects = await rows(c, sql`
    SELECT p.code, p.name AS project, cu.name AS customer, p.status, p.contract_value, p.cost_budget, p.retention_pct,
      COALESCE((SELECT SUM(i.subtotal) FROM invoices i WHERE i.project_id = p.id AND i.tenant_id = ${c.tenantId} AND i.date <= ${c.to}::date), 0) AS billed,
      COALESCE((SELECT SUM(x.amount) FROM ${projectCostsSql(c.tenantId, undefined, c.to)} x WHERE x.project_id = p.id), 0) AS cost
    FROM projects p JOIN customers cu ON cu.id = p.customer_id WHERE p.tenant_id = ${c.tenantId}
    ORDER BY (p.status = 'ACTIVE') DESC, p.code LIMIT 200`);
  const STATUS: Record<string, string> = { ACTIVE: 'Berjalan', DONE: 'Selesai', CANCELLED: 'Batal' };
  const projectRows = projects.map((p): Record<string, unknown> => {
    const margin = num(p.billed) - num(p.cost);
    return {
      ...p,
      status: STATUS[String(p.status)] ?? p.status,
      billed_pct: num(p.contract_value) > 0 ? Math.round((num(p.billed) / num(p.contract_value)) * 1000) / 10 : null,
      margin,
      margin_pct: num(p.billed) > 0 ? Math.round((margin / num(p.billed)) * 1000) / 10 : null,
      budget_used: num(p.cost_budget) > 0 ? Math.round((num(p.cost) / num(p.cost_budget)) * 1000) / 10 : null,
    };
  });
  const retention = await rows(c, sql`
    SELECT i.number, i.date, i.due_date, cu.name AS customer, p.code AS project, i.total, (i.total - i.paid_amount - i.returned_amount) AS open,
      CASE WHEN i.status = 'PAID' THEN 'Lunas' WHEN i.due_date < ${c.today}::date THEN 'Jatuh tempo' ELSE 'Masa pemeliharaan' END AS state
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.tenant_id = ${c.tenantId} AND i.retention_of_invoice_id IS NOT NULL AND (i.status <> 'PAID' OR i.date BETWEEN ${c.from}::date AND ${c.to}::date)
    ORDER BY i.due_date LIMIT 200`);
  const boq = await rows(c, sql`
    SELECT p.code AS project, b.code, b.description, b.unit, b.qty, b.completed_qty, b.unit_price, b.qty * b.unit_price AS value,
      CASE WHEN b.qty > 0 THEN ROUND(b.completed_qty / b.qty * 100, 1) ELSE NULL END AS pct
    FROM project_boq_items b JOIN projects p ON p.id = b.project_id WHERE b.tenant_id = ${c.tenantId} AND p.status = 'ACTIVE' ORDER BY p.code, b.line_no LIMIT 300`);
  const costs = await rows(c, sql`
    SELECT a.code, a.name, COUNT(*)::int AS docs, SUM(x.amount) AS amount
    FROM ${projectCostsSql(c.tenantId, c.from, c.to)} x JOIN accounts a ON a.id = x.account_id GROUP BY a.code, a.name ORDER BY SUM(x.amount) DESC`);
  const contract = projectRows.filter((p) => p.status === 'Berjalan').reduce((a, p) => a + num(p.contract_value), 0);
  const retOpen = retention.filter((r) => r.state !== 'Lunas').reduce((a, r) => a + num(r.open), 0);
  const retDue = retention.filter((r) => r.state === 'Jatuh tempo').reduce((a, r) => a + num(r.open), 0);
  const costTotal = costs.reduce((a, x) => a + num(x.amount), 0);
  return {
    kpis: [
      { label: 'Nilai kontrak berjalan', value: contract, type: 'money' },
      { label: 'Biaya langsung pada periode', value: costTotal, type: 'money' },
      { label: 'Retensi tertahan', value: retOpen, type: 'money' },
      { label: 'Retensi jatuh tempo', value: retDue, type: 'money', tone: retDue > 0 ? 'warn' : 'ok' },
      { label: 'Proyek melewati anggaran', value: projectRows.filter((p) => num(p.budget_used) > 100).length, type: 'int', tone: projectRows.some((p) => num(p.budget_used) > 100) ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'laba-proyek', title: 'Laba per proyek', note: 'Ditagih = tagihan proyek sebelum PPN (termasuk retensi) sampai akhir periode; biaya = biaya langsung dari tagihan pemasok, kas keluar, jurnal, dan gaji yang ditempatkan di proyek.', columns: [{ key: 'code', label: 'Kode' }, { key: 'project', label: 'Proyek' }, { key: 'customer', label: 'Pemberi kerja' }, { key: 'status', label: 'Status' }, { key: 'contract_value', label: 'Kontrak', type: 'money' }, { key: 'billed', label: 'Ditagih', type: 'money' }, { key: 'billed_pct', label: 'Tertagih', type: 'pct' }, { key: 'cost', label: 'Biaya langsung', type: 'money' }, { key: 'margin', label: 'Laba kotor', type: 'money' }, { key: 'margin_pct', label: 'Margin', type: 'pct' }, { key: 'budget_used', label: 'Anggaran terpakai', type: 'pct' }], rows: projectRows, empty: 'Belum ada proyek.' },
      { key: 'retensi', title: 'Retensi', note: 'Tagihan retensi yang belum lunas, dan yang terbit pada periode.', columns: [{ key: 'number', label: 'Nomor' }, { key: 'project', label: 'Proyek' }, { key: 'customer', label: 'Pemberi kerja' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'due_date', label: 'Jatuh tempo', type: 'date' }, { key: 'total', label: 'Nilai', type: 'money' }, { key: 'open', label: 'Sisa', type: 'money' }, { key: 'state', label: 'Keadaan' }], rows: retention, empty: 'Tidak ada retensi.' },
      { key: 'boq', title: 'Kemajuan BoQ', note: 'Volume selesai dibanding volume BoQ proyek yang berjalan.', columns: [{ key: 'project', label: 'Proyek' }, { key: 'code', label: 'Item' }, { key: 'description', label: 'Pekerjaan' }, { key: 'unit', label: 'Satuan' }, { key: 'qty', label: 'Volume', type: 'qty' }, { key: 'completed_qty', label: 'Selesai', type: 'qty' }, { key: 'pct', label: 'Kemajuan', type: 'pct' }, { key: 'value', label: 'Nilai BoQ', type: 'money' }], rows: boq, empty: 'Belum ada BoQ.' },
      { key: 'biaya-jenis', title: 'Biaya langsung per jenis', columns: [{ key: 'code', label: 'Akun' }, { key: 'name', label: 'Jenis biaya' }, { key: 'docs', label: 'Dokumen', type: 'int' }, { key: 'amount', label: 'Jumlah', type: 'money' }], rows: costs, empty: 'Belum ada biaya proyek pada periode ini.' },
      await revenueByAccount(c),
      { key: 'umur', title: 'Umur piutang pemberi kerja', note: `Per ${c.today}.`, columns: AGING_COLS.map((x) => (x.key === 'customer' ? { ...x, label: 'Pemberi kerja' } : x)), rows: await arAging(c) },
    ],
  };
};
