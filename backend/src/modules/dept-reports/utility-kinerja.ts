import { COMPLAINT_CATEGORY_LABELS, NRW_WARN_PCT, nonRevenueWater, type ComplaintCategory } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { Builder, num, rows } from './types';

const catLabel = (k: string) => COMPLAINT_CATEGORY_LABELS[k as ComplaintCategory] ?? k;

/**
 * Laporan kinerja layanan air: efisiensi penagihan, umur piutang per golongan, kinerja rute dan kolektor,
 * ketepatan penanganan pengaduan, air tak berekening, dan kualitas air. Semua angka dari dokumen, bukan isian tangan.
 */
export const utilityKinerjaReport: Builder = async (c) => {
  const T = c.tenantId;
  const waterInv = sql`i.tenant_id = ${T} AND EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id)`;

  const perTariff = await rows<{ tariff: string; connections: number; usage: string; billed: string; collected: string; open: string }>(c, sql`
    SELECT t.name AS tariff,
      (SELECT COUNT(*) FROM utility_connections uc WHERE uc.tenant_id = ${T} AND uc.tariff_id = t.id AND uc.status = 'ACTIVE')::int AS connections,
      COALESCE(SUM(b.usage) FILTER (WHERE i.date BETWEEN ${c.from} AND ${c.to}), 0)::text AS usage,
      COALESCE(SUM(i.total) FILTER (WHERE i.date BETWEEN ${c.from} AND ${c.to}), 0)::text AS billed,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices pi ON pi.id = p.invoice_id JOIN utility_bills pb ON pb.invoice_id = pi.id JOIN utility_connections pc ON pc.id = pb.connection_id
                WHERE pc.tariff_id = t.id AND pi.tenant_id = ${T} AND p.date BETWEEN ${c.from} AND ${c.to}), 0)::text AS collected,
      COALESCE(SUM(i.total - i.paid_amount - i.returned_amount) FILTER (WHERE i.date <= ${c.to} AND i.total - i.paid_amount - i.returned_amount > 0.5), 0)::text AS open
    FROM utility_tariffs t LEFT JOIN utility_connections c2 ON c2.tariff_id = t.id LEFT JOIN utility_bills b ON b.connection_id = c2.id LEFT JOIN invoices i ON i.id = b.invoice_id
    WHERE t.tenant_id = ${T} GROUP BY t.id, t.name ORDER BY t.name`);
  const tariffRows = perTariff.map((r) => ({ ...r, pct: num(r.billed) ? (num(r.collected) / num(r.billed)) * 100 : 0 }));

  const aging = await rows(c, sql`
    SELECT t.name AS tariff,
      COALESCE(SUM(x.open) FILTER (WHERE x.late <= 0), 0) AS b0, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 1 AND 30), 0) AS b1, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 31 AND 60), 0) AS b2,
      COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 61 AND 90), 0) AS b3, COALESCE(SUM(x.open) FILTER (WHERE x.late > 90), 0) AS b4, COALESCE(SUM(x.open), 0) AS total
    FROM utility_tariffs t LEFT JOIN (
      SELECT uc.tariff_id, (i.total - i.paid_amount - i.returned_amount) AS open, (${c.to}::date - i.due_date) AS late
      FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections uc ON uc.id = b.connection_id
      WHERE ${waterInv} AND i.date <= ${c.to} AND i.total - i.paid_amount - i.returned_amount > 0.5) x ON x.tariff_id = t.id
    WHERE t.tenant_id = ${T} GROUP BY t.id, t.name ORDER BY t.name`);

  const perRoute = await rows(c, sql`
    SELECT r.code, r.name AS route, COALESCE(u.name, '-') AS collector,
      (SELECT COUNT(*) FROM utility_connections uc WHERE uc.route_id = r.id AND uc.status = 'ACTIVE')::int AS connections,
      COALESCE((SELECT SUM(i.total) FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections uc ON uc.id = b.connection_id WHERE uc.route_id = r.id AND i.date BETWEEN ${c.from} AND ${c.to}), 0) AS billed,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN utility_bills b ON b.invoice_id = p.invoice_id JOIN utility_connections uc ON uc.id = b.connection_id WHERE uc.route_id = r.id AND p.date BETWEEN ${c.from} AND ${c.to}), 0) AS collected,
      COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections uc ON uc.id = b.connection_id WHERE uc.route_id = r.id AND i.date <= ${c.to} AND i.due_date < ${c.to}::date AND i.total - i.paid_amount - i.returned_amount > 0.5), 0) AS overdue,
      (SELECT COUNT(*) FROM utility_collection_visits v JOIN utility_connections uc ON uc.id = v.connection_id WHERE uc.route_id = r.id AND (v.visited_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${c.from} AND ${c.to})::int AS visits
    FROM utility_routes r LEFT JOIN users u ON u.id = r.collector_id WHERE r.tenant_id = ${T} ORDER BY r.code`);

  const complaints = await rows<{ category: string; total: number; done: number; on_time: number; avg_hours: string | null }>(c, sql`
    SELECT category, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS done, COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= due_at)::int AS on_time,
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL)::text AS avg_hours
    FROM utility_complaints WHERE tenant_id = ${T} AND (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${c.from} AND ${c.to} GROUP BY category ORDER BY COUNT(*) DESC`);
  const complaintRows = complaints.map((r) => ({ category: catLabel(r.category), total: r.total, done: r.done, on_time: r.on_time, pct: r.done ? (r.on_time / r.done) * 100 : 0, avg_hours: r.avg_hours == null ? 0 : num(r.avg_hours) }));

  const nrwRaw = await rows<{ month: string; produced: string; distributed: string; billed: string }>(c, sql`
    SELECT m.month, COALESCE(p.produced, 0)::text AS produced, COALESCE(p.distributed, 0)::text AS distributed, COALESCE(b.billed, 0)::text AS billed FROM (
      SELECT to_char(d, 'YYYY-MM') AS month FROM generate_series(${c.from}::date, ${c.to}::date, interval '1 month') d GROUP BY 1) m
    LEFT JOIN (SELECT to_char(date, 'YYYY-MM') AS month, SUM(produced) AS produced, SUM(distributed) AS distributed FROM utility_production WHERE tenant_id = ${T} GROUP BY 1) p ON p.month = m.month
    LEFT JOIN (SELECT period AS month, SUM(usage) AS billed FROM utility_bills WHERE tenant_id = ${T} GROUP BY 1) b ON b.month = m.month ORDER BY m.month`);
  const nrwRows = nrwRaw.map((r) => { const n = nonRevenueWater(num(r.distributed), num(r.billed)); return { month: r.month, produced: num(r.produced), distributed: num(r.distributed), billed: num(r.billed), volume: n.volume, pct: n.pct ?? 0, status: num(r.distributed) === 0 ? 'Belum ada data produksi' : (n.pct ?? 0) > NRW_WARN_PCT ? 'Di atas batas wajar' : 'Wajar' }; });

  const quality = await rows<{ point: string; samples: number; failing: number }>(c, sql`
    SELECT point, COUNT(*)::int AS samples, COUNT(*) FILTER (WHERE NOT ok)::int AS failing FROM utility_water_quality WHERE tenant_id = ${T} AND sampled_on BETWEEN ${c.from} AND ${c.to} GROUP BY point ORDER BY point`);
  const qualityRows = quality.map((r) => ({ ...r, ok: r.samples - r.failing, pct: r.samples ? ((r.samples - r.failing) / r.samples) * 100 : 0 }));

  const sum = (xs: Record<string, unknown>[], k: string) => xs.reduce((a, r) => a + num(r[k]), 0);
  const billed = sum(tariffRows, 'billed');
  const collected = sum(tariffRows, 'collected');
  const open = sum(tariffRows, 'open');
  const cDone = sum(complaintRows, 'done');
  const cOnTime = sum(complaintRows, 'on_time');
  const nrwTotal = nonRevenueWater(sum(nrwRows, 'distributed'), sum(nrwRows, 'billed'));
  const qSamples = sum(qualityRows, 'samples');
  const qOk = sum(qualityRows, 'ok');

  const money = (k: string, label: string) => ({ key: k, label, type: 'money' as const });
  return {
    kpis: [
      { label: 'Tagihan air periode ini', value: billed, type: 'money' },
      { label: 'Penerimaan air periode ini', value: collected, type: 'money', tone: 'ok' },
      { label: 'Efisiensi penagihan', value: billed ? (collected / billed) * 100 : 0, type: 'pct', tone: billed && collected / billed < 0.8 ? 'warn' : 'ok' },
      { label: 'Piutang air (akhir periode)', value: open, type: 'money', tone: open > 0 ? 'warn' : 'ok' },
      { label: 'Pengaduan selesai tepat waktu', value: cDone ? (cOnTime / cDone) * 100 : 0, type: 'pct', tone: cDone && cOnTime / cDone < 0.8 ? 'warn' : 'ok' },
      { label: 'Air tak berekening (NRW)', value: nrwTotal.pct ?? 0, type: 'pct', tone: (nrwTotal.pct ?? 0) > NRW_WARN_PCT ? 'warn' : 'ok' },
      { label: 'Sampel air memenuhi baku mutu', value: qSamples ? (qOk / qSamples) * 100 : 0, type: 'pct', tone: qSamples && qOk < qSamples ? 'warn' : 'ok' },
      { label: 'Sambungan aktif', value: sum(tariffRows, 'connections'), type: 'int' },
    ],
    sections: [
      { key: 'golongan', title: 'Per golongan tarif', note: 'Tagihan dan penerimaan pada rentang tanggal; piutang pada akhir rentang. Efisiensi = penerimaan ÷ tagihan (penerimaan bisa melunasi tagihan bulan sebelumnya).', columns: [{ key: 'tariff', label: 'Golongan' }, { key: 'connections', label: 'Sambungan aktif', type: 'int' }, { key: 'usage', label: 'Pemakaian (m³)', type: 'qty' }, money('billed', 'Tagihan'), money('collected', 'Penerimaan'), { key: 'pct', label: 'Efisiensi', type: 'pct' }, money('open', 'Piutang')], rows: tariffRows },
      { key: 'umur', title: 'Umur piutang per golongan', note: 'Sisa tagihan air pada akhir rentang menurut lama lewat jatuh tempo.', columns: [{ key: 'tariff', label: 'Golongan' }, money('b0', 'Belum jatuh tempo'), money('b1', '1–30 hari'), money('b2', '31–60 hari'), money('b3', '61–90 hari'), money('b4', '> 90 hari'), money('total', 'Total')], rows: aging },
      { key: 'rute', title: 'Per rute dan kolektor', note: 'Tunggakan = tagihan lewat jatuh tempo pada akhir rentang. Kunjungan dihitung dalam rentang tanggal.', columns: [{ key: 'code', label: 'Kode' }, { key: 'route', label: 'Rute' }, { key: 'collector', label: 'Kolektor' }, { key: 'connections', label: 'Sambungan', type: 'int' }, money('billed', 'Tagihan'), money('collected', 'Penerimaan'), money('overdue', 'Menunggak'), { key: 'visits', label: 'Kunjungan', type: 'int' }], rows: perRoute, empty: 'Belum ada rute. Buat rute di menu Rute baca.' },
      { key: 'pengaduan', title: 'Penanganan pengaduan', note: 'Tepat waktu = selesai sebelum batas SLA kategori itu.', columns: [{ key: 'category', label: 'Kategori' }, { key: 'total', label: 'Masuk', type: 'int' }, { key: 'done', label: 'Selesai', type: 'int' }, { key: 'on_time', label: 'Tepat waktu', type: 'int' }, { key: 'pct', label: '% tepat waktu', type: 'pct' }, { key: 'avg_hours', label: 'Rata-rata penyelesaian', type: 'hours' }], rows: complaintRows, empty: 'Belum ada pengaduan pada rentang ini.' },
      { key: 'nrw', title: 'Air tak berekening (NRW)', note: `NRW = air dialirkan − air ditagih. Batas wajar ${NRW_WARN_PCT}%. Air ditagih diambil dari pemakaian pada tagihan periode itu.`, columns: [{ key: 'month', label: 'Bulan' }, { key: 'produced', label: 'Diproduksi (m³)', type: 'qty' }, { key: 'distributed', label: 'Dialirkan (m³)', type: 'qty' }, { key: 'billed', label: 'Ditagih (m³)', type: 'qty' }, { key: 'volume', label: 'Hilang (m³)', type: 'qty' }, { key: 'pct', label: 'NRW', type: 'pct' }, { key: 'status', label: 'Status' }], rows: nrwRows },
      { key: 'kualitas', title: 'Kualitas air', note: 'Hasil uji dibandingkan baku mutu air minum (pH, kekeruhan, sisa klor, coliform, zat padat terlarut).', columns: [{ key: 'point', label: 'Titik sampel' }, { key: 'samples', label: 'Sampel', type: 'int' }, { key: 'ok', label: 'Memenuhi', type: 'int' }, { key: 'failing', label: 'Tidak memenuhi', type: 'int' }, { key: 'pct', label: '% memenuhi', type: 'pct' }], rows: qualityRows, empty: 'Belum ada hasil uji pada rentang ini.' },
    ],
  };
};
