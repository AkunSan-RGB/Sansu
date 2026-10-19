import { BUSINESS_MODELS, type BusinessModel, localize } from '@sansu/shared';
import { describe, expect, it } from 'vitest';
import { DEPT_REPORTS } from '@/features/laporan/DeptReportPage';
import { GROUP_ORDER, type Group, type Item, MENU, menuFor, type Sub } from './menuData';

const MODELS = BUSINESS_MODELS.map((m) => m.key) as BusinessModel[];
const flat = (g: Group): Item[] => (g.children ?? []).flatMap((c: Sub) => ('section' in c ? c.items : [c]));
const forModel = (m: BusinessModel, g: Group) => flat(g).filter((i) => (!i.models || i.models.includes(m)) && !i.hideFor?.includes(m));
const groups = (m: BusinessModel) => menuFor(m).filter((g) => !g.models || g.models.includes(m));

describe('menu: susunan bertahap per jenis usaha', () => {
  it('Cek kesehatan mandiri tepat di bawah Dashboard, bukan anak menu Akuntansi', () => {
    for (const m of MODELS) {
      const top = menuFor(m).slice(0, 3).map((g) => g.key);
      expect(top).toEqual(['/dashboard', '/health', '/tasks']);
      const acc = MENU.find((g) => g.key === 'accounting')!;
      expect(flat(acc).some((i) => i.key === '/health')).toBe(false);
    }
  });

  it('laporan pendukung hanya satu menu di Akuntansi, tepat sesudah Laporan keuangan', () => {
    const all = MENU.flatMap(flat).filter((i) => i.key.startsWith('/support-reports'));
    expect(all.map((i) => i.key)).toEqual(['/support-reports']);
    const acc = MENU.find((g) => g.key === 'accounting')!;
    const rep = (acc.children as Sub[]).find((c): c is { section: string; items: Item[] } => 'section' in c && c.section === 'Laporan')!;
    const keys = rep.items.map((i) => i.key);
    expect(keys.indexOf('/support-reports')).toBe(keys.indexOf('/reports') + 1);
  });

  it('semua "Laporan <bagian>" membuka laporan kerja bagian itu (/laporan/...), bukan laporan pendukung', () => {
    const reports = MENU.flatMap(flat).filter((i) => i.label.startsWith('Laporan ') && !['Laporan keuangan', 'Laporan pendukung'].includes(i.label));
    expect(reports.length).toBeGreaterThanOrEqual(10);
    for (const r of reports) {
      expect(r.key).toMatch(/^\/laporan\//);
      expect(DEPT_REPORTS[r.key.split('/')[2]]).toBeDefined();
    }
  });

  it('jenis usaha hanya melihat laporan bagian yang sesuai', () => {
    const reportKeys = (m: BusinessModel) => groups(m).filter((g) => g.key !== 'utility' || m === 'UTILITAS').flatMap((g) => forModel(m, g)).map((i) => i.key).filter((k) => k.startsWith('/laporan/')).sort();
    expect(reportKeys('RITEL')).toEqual(['/laporan/cash', '/laporan/hr', '/laporan/inventory', '/laporan/pos', '/laporan/purchases']);
    expect(reportKeys('FNB')).toEqual(['/laporan/cash', '/laporan/fnb', '/laporan/hr', '/laporan/inventory', '/laporan/pos', '/laporan/purchases']);
    expect(reportKeys('JASA')).toEqual(['/laporan/cash', '/laporan/hr', '/laporan/inventory', '/laporan/jasa', '/laporan/purchases']);
    expect(reportKeys('MANUFAKTUR')).toEqual(['/laporan/cash', '/laporan/hr', '/laporan/inventory', '/laporan/mfg', '/laporan/purchases', '/laporan/sales']);
    expect(reportKeys('FMCG')).toEqual(['/laporan/cash', '/laporan/fmcg', '/laporan/hr', '/laporan/inventory', '/laporan/purchases', '/laporan/sales']);
    expect(reportKeys('DAGANG')).toEqual(['/laporan/cash', '/laporan/hr', '/laporan/inventory', '/laporan/purchases', '/laporan/sales']);
    expect(reportKeys('UTILITAS')).toEqual(['/laporan/cash', '/laporan/hr', '/laporan/inventory', '/laporan/purchases', '/laporan/utility']);
  });

  it('di dalam tiap bagian, judul kecil berurutan Persiapan → Proses → Laporan & kontrol', () => {
    const order = ['Persiapan', 'Proses', 'Laporan & kontrol'];
    for (const g of MENU) {
      const secs = (g.children ?? []).filter((c): c is { section: string; items: Item[] } => 'section' in c).map((c) => c.section).filter((s) => order.includes(s));
      const idx = secs.map((s) => order.indexOf(s));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it('urutan bagian mengikuti alur utama jenis usaha', () => {
    const biz = (m: BusinessModel) => groups(m).map((g) => g.key).filter((k) => ['crm', 'sales', 'pos', 'purchase', 'inventory', 'production'].includes(k));
    expect(biz('RITEL').slice(0, 2)).toEqual(['pos', 'sales']); // kasir lebih dulu
    expect(biz('FNB').slice(0, 4)).toEqual(['pos', 'purchase', 'inventory', 'production']);
    expect(biz('MANUFAKTUR').slice(0, 3)).toEqual(['purchase', 'inventory', 'production']); // bahan masuk dulu, lalu produksi
    expect(biz('MANUFAKTUR').indexOf('sales')).toBeGreaterThan(biz('MANUFAKTUR').indexOf('production'));
    expect(biz('DAGANG').slice(0, 3)).toEqual(['crm', 'sales', 'pos']);
    for (const m of MODELS) {
      const keys = menuFor(m).map((g) => g.key);
      expect(keys.indexOf('cash')).toBeGreaterThan(keys.indexOf('inventory'));
      expect(keys.indexOf('accounting')).toBeGreaterThan(keys.indexOf('cash'));
      expect(GROUP_ORDER[m].length).toBeGreaterThan(0);
    }
  });

  it('langkah penjualan berurutan: pesanan → ... → faktur → retur (Dagang, FMCG, Jasa)', () => {
    const proc = (m: BusinessModel) => forModel(m, MENU.find((g) => g.key === 'sales')!).map((i) => i.key);
    const dag = proc('DAGANG');
    expect(dag.indexOf('/sales-orders')).toBeLessThan(dag.indexOf('/deliveries'));
    expect(dag.indexOf('/deliveries')).toBeLessThan(dag.indexOf('/invoices'));
    expect(dag.indexOf('/invoices')).toBeLessThan(dag.indexOf('/returns?tab=sales'));
    const jasa = proc('JASA');
    for (const k of ['/sales-orders', '/projects', '/scheduling', '/timesheets', '/retainers', '/customer-deposits', '/invoices']) expect(jasa).toContain(k);
    expect(jasa.indexOf('/projects')).toBeLessThan(jasa.indexOf('/scheduling'));
    expect(jasa.indexOf('/scheduling')).toBeLessThan(jasa.indexOf('/timesheets'));
    expect(jasa.indexOf('/timesheets')).toBeLessThan(jasa.indexOf('/retainers'));
    expect(jasa.indexOf('/retainers')).toBeLessThan(jasa.indexOf('/invoices'));
    expect(jasa).not.toContain('/deliveries');
    const fm = proc('FMCG');
    expect(fm.indexOf('/delivery-trips')).toBeLessThan(fm.indexOf('/canvass'));
    expect(fm.indexOf('/canvass')).toBeLessThan(fm.indexOf('/invoices'));
  });

  it('pembelian berurutan dan persiapan (pemasok, kontrak harga) lebih dulu', () => {
    for (const m of MODELS) {
      const keys = forModel(m, MENU.find((g) => g.key === 'purchase')!).map((i) => i.key);
      expect(keys.indexOf('/suppliers')).toBeLessThan(keys.indexOf('/purchase-orders'));
      expect(keys.indexOf('/purchase-requests')).toBeLessThan(keys.indexOf('/purchase-orders'));
      expect(keys.indexOf('/purchase-orders')).toBeLessThan(keys.indexOf('/purchase-invoices'));
      expect(keys.filter((k) => k === '/price-agreements')).toHaveLength(m === 'JASA' ? 0 : 1); // satu varian nama per jenis usaha
    }
  });

  it('tidak ada kunci menu ganda dalam satu jenis usaha', () => {
    for (const m of MODELS) {
      const keys = groups(m).flatMap((g) => forModel(m, g)).map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('istilah: Sales Order dan Purchase Order sesuai jenis usaha', () => {
  const so: Record<BusinessModel, string> = { DAGANG: 'Pesanan penjualan', RITEL: 'Pesanan penjualan', FNB: 'Pesanan katering', FMCG: 'Pesanan outlet', MANUFAKTUR: 'Pesanan pelanggan', JASA: 'Pesanan kerja', UTILITAS: 'Pesanan pasang baru' };
  const po: Record<BusinessModel, string> = { DAGANG: 'Pesanan pembelian', RITEL: 'Pesanan pembelian', FNB: 'Pesanan bahan', FMCG: 'Pesanan ke prinsipal', MANUFAKTUR: 'Pesanan bahan', JASA: 'Pesanan pembelian', UTILITAS: 'Pesanan bahan' };
  it('menu dan judul tidak lagi berbahasa Inggris untuk satu pun jenis usaha', () => {
    for (const m of MODELS) {
      expect(localize('Sales Order', m)).toBe(so[m]);
      expect(localize('Purchase Order', m)).toBe(po[m]);
      expect(localize('Buat Purchase Order manual', m)).not.toContain('Purchase Order');
    }
  });
});
