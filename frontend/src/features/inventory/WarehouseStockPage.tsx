import { SaveOutlined, SearchOutlined, ShoppingCartOutlined, SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { BRAND, type Warehouse } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Empty, Input, InputNumber, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, put, qs } from '@/api/client';
import { useAction, useProducts, useWarehouses } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import InventoryMethodBadge from './InventoryMethodBadge';
import { fmtMoney, fmtQty } from '@/lib/format';
import { n, SheetBuilder, type SheetSpec } from '@/lib/xlsx/book';
import { t } from '@/lib/terms';

interface Matrix {
  warehouses: (Warehouse & { isActive: boolean })[];
  rows: { productId: string; sku: string; name: string; category: string | null; baseUom: string; qty: Record<string, string>; min: Record<string, string>; totalQty: string; value: string }[];
  totals: { value: string; byWarehouse: Record<string, string> };
}
interface LowRow {
  productId: string;
  sku: string;
  name: string;
  baseUom: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qty: string;
  minQty: string;
  shortage: string;
}
interface MinRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  baseUom: string;
  qty: string;
  minQty: string | null;
}

/** Rekap stok semua gudang, stok menipis, dan pengaturan stok minimum */
export default function WarehouseStockPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'matrix';
  return (
    <>
      <PageHeader title={t('Stok per gudang')} extra={<InventoryMethodBadge />} />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'matrix', label: t('Rekap semua gudang'), children: <MatrixTab /> },
          { key: 'low', label: 'Stok menipis', children: <LowTab /> },
          { key: 'min', label: 'Stok minimum', children: <MinTab /> },
        ]}
      />
    </>
  );
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
    const vals: Record<string, unknown> = { sku: r.sku, name: r.name, cat: r.category ?? '', uom: r.baseUom, value: n(r.value) };
    for (const w of whs) vals[`w${w.id}`] = n(r.qty[w.id] ?? '0');
    vals.total = whs.length ? s.verified(`SUM(${s.ref(`w${whs[0].id}`, row)}:${s.ref(`w${whs[whs.length - 1].id}`, row)})`, n(r.totalQty), whs.reduce((a, w) => a + Number(r.qty[w.id] ?? 0), 0)) : n(r.totalQty);
    s.row(vals as never);
  }
  s.totals('Jumlah', first, s.next - 1, ['value'], { style: 'grand', labelKey: 'name', cache: { value: n(m.totals.value) } });
  return [s.spec];
}

function MatrixTab() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { data: products } = useProducts();
  const [includeZero, setIncludeZero] = useState(false);
  const [category, setCategory] = useState<string>();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['matrix', includeZero, category], queryFn: () => get<Matrix>(`/inventory/matrix${qs({ includeZero: includeZero ? 'true' : undefined, category })}`) });
  const categories = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))] as string[];
  const m = q.data;
  const rows = (m?.rows ?? []).filter((r) => !search || `${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase()));
  const below = (r: Matrix['rows'][number], wid: string) => r.min[wid] != null && Number(r.qty[wid] ?? 0) < Number(r.min[wid]);
  return (
    <Card>
      <Space wrap style={{ marginBottom: 12 }} className="no-print">
        <Input prefix={<SearchOutlined />} placeholder="Cari SKU / nama" allowClear value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        <Select allowClear placeholder="Semua kategori" style={{ width: 180 }} value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
        <Checkbox checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)}>
          Tampilkan produk tanpa stok
        </Checkbox>
        <Button icon={<SwapOutlined />} onClick={() => navigate('/inventory/transfers?new=1')}>
          Transfer antar gudang
        </Button>
        <ExportButtons filename="rekap-stok-gudang" title={t('Rekap stok per gudang')} sheets={() => (m ? matrixSheet({ ...m, rows }, me?.tenantName) : null)} />
      </Space>
      <div className="print-area">
        <Table
          rowKey="productId"
          size="small"
          loading={q.isLoading}
          dataSource={rows}
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
  );
}

function LowTab() {
  const navigate = useNavigate();
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>();
  const q = useQuery({ queryKey: ['low-stock', warehouseId], queryFn: () => get<LowRow[]>(`/inventory/low-stock${qs({ warehouseId })}`) });
  return (
    <Card>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder={t('Semua gudang')} style={{ width: 240 }} value={warehouseId} onChange={setWarehouseId} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        <Button icon={<SwapOutlined />} onClick={() => navigate('/inventory/transfers?new=1')}>
          Transfer dari gudang lain
        </Button>
        <Button icon={<ShoppingCartOutlined />} onClick={() => navigate('/purchase-orders/new')}>
          Buat pesanan pembelian
        </Button>
      </Space>
      <Table
        rowKey={(r) => `${r.productId}-${r.warehouseId}`}
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty description="Tidak ada stok di bawah minimum. Atur stok minimum di tab sebelah." /> }}
        columns={[
          { title: t('Gudang'), render: (_, r) => `${r.warehouseCode} · ${r.warehouseName}` },
          { title: 'SKU', dataIndex: 'sku' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Stok', dataIndex: 'qty', align: 'right', render: (v, r) => <Typography.Text type="danger">{fmtQty(v)} {r.baseUom}</Typography.Text> },
          { title: 'Minimum', dataIndex: 'minQty', align: 'right', render: fmtQty },
          { title: 'Kurang', dataIndex: 'shortage', align: 'right', render: (v) => <b>{fmtQty(v)}</b> },
        ]}
      />
    </Card>
  );
}

function MinTab() {
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);
  const q = useQuery({ queryKey: ['minimums', warehouseId], queryFn: () => get<MinRow[]>(`/inventory/minimums?warehouseId=${warehouseId}`), enabled: !!warehouseId });
  useEffect(() => setEdits({}), [warehouseId]);
  const save = useAction(
    () => put(`/inventory/minimums`, { warehouseId, items: Object.entries(edits).map(([productId, v]) => ({ productId, minQty: v == null ? null : String(v) })) }),
    { success: 'Stok minimum disimpan', invalidate: ['minimums', 'low-stock', 'matrix', 'dashboard'], onSuccess: () => setEdits({}) },
  );
  const rows = useMemo(() => (q.data ?? []).filter((r) => !search || `${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  const changed = Object.keys(edits).length;
  return (
    <Card>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('Isi jumlah minimum per gudang. Jika stok turun di bawahnya, produk muncul di tab Stok menipis dan di Dashboard. Kosongkan untuk menghapus.')} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 240 }} value={warehouseId} onChange={setWarehouseId} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        <Input prefix={<SearchOutlined />} placeholder="Cari SKU / nama" allowClear value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        <Button type="primary" icon={<SaveOutlined />} disabled={!changed} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Simpan{changed ? ` (${changed})` : ''}
        </Button>
      </Space>
      <Table
        rowKey="productId"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 100, showSizeChanger: false }}
        scroll={{ x: 680 }}
        columns={[
          { title: 'SKU', dataIndex: 'sku', width: 130 },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kategori', dataIndex: 'category', width: 130 },
          { title: 'Stok sekarang', dataIndex: 'qty', align: 'right', width: 130, render: (v, r) => `${fmtQty(v)} ${r.baseUom}` },
          {
            title: 'Stok minimum',
            width: 150,
            render: (_, r) => (
              <InputNumber
                min={0}
                style={{ width: 130 }}
                value={r.productId in edits ? edits[r.productId] : r.minQty == null ? null : Number(r.minQty)}
                onChange={(v) => setEdits((e) => ({ ...e, [r.productId]: v == null || Number(v) === 0 ? null : Number(v) }))}
                placeholder="—"
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
