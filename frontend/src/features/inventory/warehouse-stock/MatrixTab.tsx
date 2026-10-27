import { SearchOutlined, SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { BRAND, type Warehouse } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Checkbox, Empty, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useProducts } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ExportButtons from '@/components/ExportButtons';
import SummaryCards from '@/components/SummaryCards';
import { fmtMoney, fmtQty } from '@/lib/format';
import { n, SheetBuilder, type SheetSpec, type Val } from '@/lib/xlsx/book';
import { t } from '@/lib/terms';

interface Matrix {
  warehouses: (Warehouse & { isActive: boolean })[];
  rows: { productId: string; sku: string; name: string; category: string | null; baseUom: string; qty: Record<string, string>; min: Record<string, string>; totalQty: string; value: string }[];
  totals: { value: string; byWarehouse: Record<string, string> };
}

export function matrixSheet(m: Matrix, company?: string): SheetSpec[] {
  const whs = m.warehouses;
  const s = new SheetBuilder('Rekap Stok Gudang', {
    company,
    title: t('Rekap Stok per Gudang'),
    subtitle: [`Per ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, 'Jumlah dalam satuan dasar · nilai dalam Rupiah (HPP rata-rata)'],
    columns: [
      { key: 'sku', header: 'SKU', fmt: 'code', width: 14 },
      { key: 'name', header: t('Nama produk'), width: 34 },
      { key: 'cat', header: 'Kategori', width: 14 },
      { key: 'uom', header: 'Satuan', width: 8 },
      ...whs.map((w) => ({ key: `w${w.id}`, header: w.code, fmt: 'dec' as const, width: 12 })),
      { key: 'total', header: 'Total', fmt: 'dec', width: 13 },
      { key: 'value', header: t('Nilai persediaan'), fmt: 'money', width: 18 },
    ],
    filter: true,
    freezeCols: 2,
    landscape: whs.length > 3,
  });
  const first = s.next;
  for (const r of m.rows) {
    const row = s.next;
    const vals: Record<string, Val> = { sku: r.sku, name: r.name, cat: r.category ?? '', uom: r.baseUom, value: n(r.value) };
    for (const w of whs) vals[`w${w.id}`] = n(r.qty[w.id] ?? '0');
    vals.total = whs.length ? s.verified(`SUM(${s.ref(`w${whs[0].id}`, row)}:${s.ref(`w${whs[whs.length - 1].id}`, row)})`, n(r.totalQty), whs.reduce((a, w) => a + Number(r.qty[w.id] ?? 0), 0)) : n(r.totalQty);
    s.row(vals);
  }
  s.totals('Jumlah', first, s.next - 1, ['value'], { style: 'grand', labelKey: 'name', cache: { value: n(m.totals.value) } });
  return [s.spec];
}

export function MatrixTab() {
  const { me } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const { data: products } = useProducts();
  const [includeZero, setIncludeZero] = useState(false);
  const [category, setCategory] = useState<string>();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['matrix', includeZero, category], queryFn: () => get<Matrix>(`/inventory/matrix${qs({ includeZero: includeZero ? 'true' : undefined, category })}`) });
  const categories = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))] as string[];
  const m = q.data;
  const [view, setView] = useState<'ALL' | 'LOW'>('ALL');
  const below = (r: Matrix['rows'][number], wid: string) => r.min[wid] != null && Number(r.qty[wid] ?? 0) < Number(r.min[wid]);
  const isLow = (r: Matrix['rows'][number]) => (m?.warehouses ?? []).some((w) => below(r, w.id));
  const allRows = m?.rows ?? [];
  const lowCount = allRows.filter(isLow).length;
  const rows = allRows.filter((r) => (view === 'ALL' || isLow(r)) && (!search || `${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase())));
  return (
    <>
      {m && (
        <SummaryCards
          items={[
            { label: t('Total nilai persediaan'), value: fmtMoney(m.totals.value), hint: `${m.warehouses.length} gudang` },
            { label: 'Jumlah produk', value: String(allRows.length), hint: includeZero ? 'termasuk yang tanpa stok' : 'yang ada stoknya', onClick: () => setView('ALL'), active: view === 'ALL' },
            { label: 'Persediaan di bawah minimum', value: String(lowCount), hint: 'produk perlu ditambah', tone: lowCount ? 'bad' : 'good', onClick: () => setView('LOW'), active: view === 'LOW' },
          ]}
        />
      )}
    <Card>
      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }} className="no-print">
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Segmented
            value={view}
            onChange={(v) => setView(v as typeof view)}
            options={[{ value: 'ALL', label: `Semua (${allRows.length})` }, { value: 'LOW', label: `Di bawah minimum (${lowCount})` }]}
          />
        </div>
        <Input prefix={<SearchOutlined />} placeholder="Cari SKU / nama" allowClear value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        <Select allowClear placeholder="Semua kategori" style={{ width: 180 }} value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
        <Checkbox checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)}>
          Tampilkan produk tanpa stok
        </Checkbox>
        {can('POST', '/inventory/transfers') && (
          <Button icon={<SwapOutlined />} onClick={() => navigate('/inventory/transfers?new=1')}>
            Transfer antar gudang
          </Button>
        )}
        <ExportButtons filename="rekap-stok-gudang" title={t('Rekap persediaan per gudang')} sheets={() => (m ? matrixSheet({ ...m, rows }, me?.tenantName) : null)} />
      </Space>
      <div className="print-area">
        <Table
          rowKey="productId"
          size="small"
          loading={q.isLoading}
          dataSource={rows}
          locale={{ emptyText: <Empty description={allRows.length ? 'Tidak ada produk yang cocok dengan pilihan ini' : 'Belum ada stok di gudang'} /> }}
          pagination={{ pageSize: 100, showSizeChanger: false }}
          scroll={{ x: 520 + (m?.warehouses.length ?? 0) * 110 }}
          columns={[
            { title: 'SKU', dataIndex: 'sku', fixed: 'left', width: 120 },
            { title: 'Nama', dataIndex: 'name', fixed: 'left', width: 220, ellipsis: true },
            ...(m?.warehouses ?? []).map((w) => ({
              title: (
                <span title={w.name}>
                  {w.code}
                  {!w.isActive && <Tag style={{ marginLeft: 4 }}>nonaktif</Tag>}
                </span>
              ),
              key: w.id,
              align: 'right' as const,
              width: 110,
              render: (_: unknown, r: Matrix['rows'][number]) => {
                const v = Number(r.qty[w.id] ?? 0);
                return (
                  <span style={{ color: below(r, w.id) ? '#b91c1c' : v ? undefined : '#9ca3af', fontWeight: below(r, w.id) ? 600 : undefined }} title={r.min[w.id] ? `Minimum ${fmtQty(r.min[w.id])}` : undefined}>
                    {below(r, w.id) && <WarningOutlined style={{ marginRight: 4 }} />}
                    {fmtQty(v)}
                  </span>
                );
              },
            })),
            { title: 'Total', dataIndex: 'totalQty', align: 'right', width: 110, render: (v: string, r) => <b>{fmtQty(v)} <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>{r.baseUom}</Typography.Text></b> },
            { title: 'Nilai', dataIndex: 'value', align: 'right', width: 140, render: fmtMoney },
          ]}
          summary={() =>
            m ? (
              <Table.Summary.Row style={{ background: BRAND.colors.primarySoft, fontWeight: 600 }}>
                <Table.Summary.Cell index={0} colSpan={2}>
                  Nilai persediaan per gudang
                </Table.Summary.Cell>
                {m.warehouses.map((w, i) => (
                  <Table.Summary.Cell key={w.id} index={2 + i} align="right">
                    {fmtMoney(m.totals.byWarehouse[w.id])}
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={2 + m.warehouses.length} />
                <Table.Summary.Cell index={3 + m.warehouses.length} align="right">
                  {fmtMoney(m.totals.value)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
    </Card>
    </>
  );
}
