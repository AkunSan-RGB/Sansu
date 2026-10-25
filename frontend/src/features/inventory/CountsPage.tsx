import { AuditOutlined, CheckCircleOutlined, PrinterOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Progress, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '@/api/client';
import { useAction, useProducts, useWarehouses } from '@/api/queries';
import ListPage from '@/components/ListPage';
import QueryState from '@/components/QueryState';
import { cell, DocHeader, head, PrintSheet, Signatures } from '@/components/print/Letterhead';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { t } from '@/lib/terms';
import { BinFormItem } from './BinSelect';

type Status = 'DRAFT' | 'POSTED' | 'CANCELLED';
const STATUS: Record<Status, [string, string]> = { DRAFT: ['Sedang dihitung', 'blue'], POSTED: ['Selesai', 'green'], CANCELLED: ['Dibatalkan', 'default'] };
interface CountRow {
  id: string;
  number: string;
  date: string;
  status: Status;
  category: string | null;
  binCode?: string | null;
  warehouseCode: string;
  warehouseName: string;
  lines: number;
  counted: number;
  adjustmentNumber: string | null;
}
interface CountLine {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  baseUom: string;
  systemQty: string;
  currentQty: string;
  avgCost: string;
  countedQty: string | null;
  postedSystemQty: string | null;
  difference: string | null;
}
interface CountDetail {
  id: string;
  number: string;
  date: string;
  status: Status;
  category: string | null;
  binCode?: string | null;
  notes: string | null;
  adjustmentNumber: string | null;
  warehouse: { code: string; name: string };
  /** Opname buta: stok sistem disembunyikan dari penghitung selama opname berjalan */
  blindCount?: boolean;
  lines: CountLine[];
}
const KEYS = ['counts', 'stock', 'stock-moves', 'matrix', 'low-stock', 'journals', 'dashboard', 'reports', 'statements'];

/** Daftar stock opname */
export default function CountsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['counts'], queryFn: () => get<CountRow[]>('/inventory/counts') });
  const create = useAction((v: { warehouseId: string; date: string; category?: string; binId?: string }) => post<{ id: string; number: string; lines: number }>('/inventory/counts', v), {
    success: (r) => `Lembar hitung ${r.number} dibuat (${r.lines} produk)`,
    invalidate: ['counts'],
    onSuccess: (r) => navigate(`/inventory/counts/${r.id}`),
  });
  const categories = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))] as string[];
  return (
    <>
      <ListPage<CountRow>
        title="Stock opname"
        actions={
          can('POST', '/inventory/counts') && (
            <Button type="primary" icon={<AuditOutlined />} onClick={() => setOpen(true)}>
              Mulai stock opname
            </Button>
          )
        }
        rows={list.data}
        loading={list.isLoading}
        summary={(rows) => {
          const going = rows.filter((r) => r.status === 'DRAFT');
          const done = rows.filter((r) => r.status === 'POSTED');
          return [
            { label: 'Sedang dihitung', value: String(going.length), hint: 'belum dibukukan', tone: going.length ? 'warn' : 'neutral' },
            { label: 'Selesai', value: String(done.length), hint: 'selisih sudah dibukukan', tone: done.length ? 'good' : 'neutral' },
            { label: 'Semua opname', value: String(rows.length), hint: 'termasuk yang dibatalkan' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'DRAFT', label: 'Sedang dihitung', test: (r) => r.status === 'DRAFT' },
          { value: 'POSTED', label: 'Selesai', test: (r) => r.status === 'POSTED' },
          { value: 'CANCELLED', label: 'Dibatalkan', test: (r) => r.status === 'CANCELLED' },
        ]}
        searchText={(r) => `${r.number} ${r.warehouseCode} ${r.warehouseName} ${r.category ?? ''} ${r.binCode ?? ''}`}
        searchPlaceholder="Cari nomor atau gudang"
        emptyText="Belum ada stock opname"
        onRowClick={(r) => navigate(`/inventory/counts/${r.id}`)}
        scrollX={820}
        below={
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Alur stock opname"
            description={t('1) Mulai & cetak lembar hitung · 2) Hitung barang di gudang · 3) Isi jumlah fisik (bisa bertahap, tersimpan) · 4) Bukukan selisih: SANSU membandingkan dengan stok sistem saat itu, lalu membuat penyesuaian stok & jurnal selisih persediaan otomatis.')}
          />
        }
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: t('Gudang'), render: (_, r) => `${r.warehouseCode} · ${r.warehouseName}` },
          { title: 'Cakupan', render: (_, r) => (r.binCode ? `Rak ${r.binCode}` : r.category ?? 'Semua') },
          { title: 'Progres', render: (_, r) => <Progress percent={r.lines ? Math.round((r.counted / r.lines) * 100) : 0} size="small" format={() => `${r.counted}/${r.lines}`} style={{ width: 160 }} /> },
          { title: 'Status', dataIndex: 'status', render: (s: Status) => <Tag color={STATUS[s][1]}>{STATUS[s][0]}</Tag> },
          { title: 'Penyesuaian', dataIndex: 'adjustmentNumber', render: (v) => v ?? '-' },
        ]}
      />
      <Modal open={open} title="Mulai stock opname" footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <Form layout="vertical" initialValues={{ date: today(), warehouseId: warehouses?.[0]?.id }} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="warehouseId" label={t('Gudang')} rules={[{ required: true }]}>
            <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal opname" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.warehouseId !== b.warehouseId}>
            {({ getFieldValue }) => (
              <BinFormItem warehouseId={getFieldValue('warehouseId')} name="binId" extra="Gudang yang memakai rak bisa dihitung per rak: lembar hanya berisi isi rak itu, dan selisih mengoreksi tepat rak itu." placeholder="Seluruh gudang" />
            )}
          </Form.Item>
          <Form.Item name="category" label={t('Kategori produk (opsional)')} extra={t('Kosongkan untuk menghitung semua produk. Untuk gudang besar, opname bisa dibagi per kategori.')}>
            <Select allowClear options={categories.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={create.isPending}>
            Buat lembar hitung
          </Button>
        </Form>
      </Modal>
    </>
  );
}

/** Lembar hitung: isi jumlah fisik, simpan, bukukan selisih */
export function CountDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['counts', id], queryFn: () => get<CountDetail>(`/inventory/counts/${id}`) });
  return <QueryState q={q}>{(c) => <CountSheet c={c} />}</QueryState>;
}

function CountSheet({ c }: { c: CountDetail }) {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const editable = c.status === 'DRAFT';
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'TODO' | 'DIFF'>('ALL');
  useEffect(() => {
    setValues(Object.fromEntries(c.lines.map((l) => [l.productId, l.countedQty == null ? null : Number(l.countedQty)])));
    setDirty(false);
    setNotes(c.notes ?? '');
  }, [c]);

  const save = useAction(() => put(`/inventory/counts/${c.id}`, { notes, lines: c.lines.map((l) => ({ productId: l.productId, countedQty: values[l.productId] == null ? null : String(values[l.productId]) })) }), {
    success: 'Hasil hitung disimpan',
    invalidate: ['counts'],
    onSuccess: () => setDirty(false),
  });
  const { me } = useAuth();
  const can = useCan();
  const canEditCount = can('PUT', '/inventory/counts/:id');
  const postCount = useAction(
    async () => {
      if (dirty) await put(`/inventory/counts/${c.id}`, { notes, lines: c.lines.map((l) => ({ productId: l.productId, countedQty: values[l.productId] == null ? null : String(values[l.productId]) })) });
      return post<{ adjusted: number; adjustmentNumber: string | null; valueIn: string; valueOut: string }>(`/inventory/counts/${c.id}/post`);
    },
    {
      success: (r) => (r.adjustmentNumber ? `Selisih dibukukan: ${r.adjusted} produk, penyesuaian ${r.adjustmentNumber}` : 'Stock opname selesai — tidak ada selisih'),
      invalidate: KEYS,
    },
  );
  const cancel = useAction(() => post(`/inventory/counts/${c.id}/cancel`), { success: 'Stock opname dibatalkan', invalidate: ['counts'], onSuccess: () => navigate('/inventory/counts') });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return c.lines
      .map((l) => {
        const counted = editable ? values[l.productId] ?? null : l.countedQty == null ? null : Number(l.countedQty);
        const base = editable ? Number(l.currentQty) : Number(l.postedSystemQty ?? l.systemQty);
        const diff = counted == null ? null : editable ? counted - base : Number(l.difference ?? 0);
        return { ...l, counted, base, diff };
      })
      .filter((l) => (!s || l.sku.toLowerCase().includes(s) || l.name.toLowerCase().includes(s)) && (filter === 'ALL' || (filter === 'TODO' ? l.counted == null : l.diff != null && Math.abs(l.diff) > 0.00001)));
  }, [c.lines, values, search, filter, editable]);

  const blind = !!c.blindCount;
  const all = c.lines.length;
  const done = Object.values(values).filter((v) => v != null).length;
  const diffs = c.lines.map((l) => {
    const counted = editable ? values[l.productId] : l.countedQty == null ? null : Number(l.countedQty);
    if (counted == null) return 0;
    const d = editable ? counted - Number(l.currentQty) : Number(l.difference ?? 0);
    return d * Number(l.avgCost);
  });
  const plus = diffs.filter((d) => d > 0).reduce((a, b) => a + b, 0);
  const minus = diffs.filter((d) => d < 0).reduce((a, b) => a + b, 0);

  const cols: ColumnsType<(typeof rows)[number]> = [
              { title: 'SKU', dataIndex: 'sku', width: 120 },
              { title: 'Nama', dataIndex: 'name' },
              { title: 'Satuan', dataIndex: 'baseUom', width: 70 },
              { key: 'base', title: editable ? 'Stok sistem' : 'Stok sistem saat dibukukan', dataIndex: 'base', align: 'right', width: 130, render: (v: number) => fmtQty(v) },
              {
                title: 'Jumlah fisik',
                width: 150,
                align: 'right',
                render: (_, l) =>
                  editable && canEditCount ? (
                    <InputNumber
                      min={0}
                      value={values[l.productId] ?? null}
                      onChange={(v) => {
                        setValues((s) => ({ ...s, [l.productId]: v == null ? null : Number(v) }));
                        setDirty(true);
                      }}
                      style={{ width: 120 }}
                      placeholder="—"
                    />
                  ) : l.counted == null ? (
                    <Typography.Text type="secondary">tidak dihitung</Typography.Text>
                  ) : (
                    fmtQty(l.counted)
                  ),
              },
              {
                key: 'diff',
                title: 'Selisih',
                dataIndex: 'diff',
                align: 'right',
                width: 110,
                render: (d: number | null) => (d == null ? '' : <Typography.Text type={d > 0 ? 'success' : d < 0 ? 'danger' : undefined}>{d > 0 ? '+' : ''}{fmtQty(d)}</Typography.Text>),
              },
              { key: 'diffValue', title: 'Nilai selisih', align: 'right', width: 130, render: (_, l) => (l.diff ? fmtMoney(l.diff * Number(l.avgCost)) : '') },
  ];

  const confirmPost = () =>
    modal.confirm({
      title: `Bukukan selisih stock opname ${c.number}?`,
      content: (
        <>
          {done} dari {all} produk sudah dihitung. Produk yang belum diisi tidak disesuaikan.
          <br />
          Perkiraan selisih: lebih {fmtMoney(plus)}, kurang {fmtMoney(Math.abs(minus))}. Setelah dibukukan lembar ini tidak bisa diubah.
        </>
      ),
      okText: 'Bukukan',
      cancelText: 'Batal',
      onOk: () => postCount.mutateAsync(undefined),
    });

  return (
    <>
      <PageHeader
        title={
          <Space>
            Stock opname {c.number}
            <Tag color={STATUS[c.status][1]}>{STATUS[c.status][0]}</Tag>
          </Space>
        }
        extra={
          <Space wrap className="no-print">
            <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Lembar hitung ${c.number}`)}>
              Cetak lembar hitung
            </Button>
            {editable && (
              <>
                {can('POST', '/inventory/counts/:id/cancel') && (
                <Button danger onClick={() => modal.confirm({ title: 'Batalkan stock opname ini?', okText: 'Batalkan', cancelText: 'Tidak', onOk: () => cancel.mutateAsync(undefined) })}>
                  Batalkan
                </Button>
                )}
                {canEditCount && (
                <Button icon={<SaveOutlined />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                  Simpan
                </Button>
                )}
                {/* pemisahan fungsi: yang menghitung (Gudang) tidak membukukan selisihnya; Keuangan/Admin/Pemilik yang membukukan */}
                {me?.role === 'WAREHOUSE' ? (
                  <Tag color="blue">Selisih dibukukan oleh Keuangan/Admin</Tag>
                ) : can('POST', '/inventory/counts/:id/post') && (
                  <Button type="primary" icon={<CheckCircleOutlined />} disabled={!done} loading={postCount.isPending} onClick={confirmPost}>
                    Bukukan selisih
                  </Button>
                )}
              </>
            )}
          </Space>
        }
      />
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small" className="no-print">
          <Space size={32} wrap>
            <Statistic title={t('Gudang')} value={`${c.warehouse.code} · ${c.warehouse.name}`} valueStyle={{ fontSize: 16 }} />
            <Statistic title="Tanggal" value={fmtDate(c.date)} valueStyle={{ fontSize: 16 }} />
            <Statistic title="Sudah dihitung" value={`${done} / ${all}`} valueStyle={{ fontSize: 16 }} />
            <Statistic title="Selisih lebih" value={fmtMoney(plus)} valueStyle={{ fontSize: 16, color: '#15803d' }} />
            <Statistic title="Selisih kurang" value={fmtMoney(Math.abs(minus))} valueStyle={{ fontSize: 16, color: '#b91c1c' }} />
            {c.adjustmentNumber && <Statistic title="Penyesuaian" value={c.adjustmentNumber} valueStyle={{ fontSize: 16 }} />}
          </Space>
        </Card>
        <Card className="no-print">
          <Space wrap style={{ marginBottom: 12 }}>
            <Input prefix={<SearchOutlined />} placeholder="Cari SKU / nama" allowClear value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
            <Segmented
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              options={[
                { value: 'ALL', label: 'Semua' },
                { value: 'TODO', label: 'Belum dihitung' },
                { value: 'DIFF', label: 'Ada selisih' },
              ]}
            />
            {editable && canEditCount && !blind && (
              <Button
                onClick={() => {
                  setValues((v) => Object.fromEntries(c.lines.map((l) => [l.productId, v[l.productId] ?? Number(l.currentQty)])));
                  setDirty(true);
                }}
              >
                Isi yang kosong = stok sistem
              </Button>
            )}
          </Space>
          {editable && canEditCount && (
            <Input.TextArea
              rows={2}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="Alasan selisih (wajib bila selisih bernilai besar)"
              style={{ marginBottom: 12 }}
            />
          )}
          <Table
            rowKey="productId"
            size="small"
            dataSource={rows}
            pagination={{ pageSize: 100, showSizeChanger: false }}
            scroll={{ x: 860 }}
            columns={cols.filter((col) => !(blind && ['base', 'diff', 'diffValue'].includes(String(col.key))))}
          />
        </Card>
      </Space>
      {/* Lembar hitung untuk dicetak & diisi tangan */}
      <div style={{ display: 'none' }}>
        <PrintSheet>
          <DocHeader
            title="LEMBAR HITUNG STOK"
            meta={[
              ['Nomor', c.number],
              ['Tanggal', fmtDate(c.date)],
              ['Gudang', `${c.warehouse.code} · ${c.warehouse.name}`],
              ...(c.binCode ? ([['Rak', c.binCode]] as [string, string][]) : []),
              ...(c.category ? ([['Kategori', c.category]] as [string, string][]) : []),
            ]}
          />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={head}>No</th>
                <th style={head}>SKU</th>
                <th style={head}>Nama barang</th>
                <th style={head}>Satuan</th>
                <th style={{ ...head, width: 110 }}>Jumlah fisik</th>
                <th style={{ ...head, width: 140 }}>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l, i) => (
                <tr key={l.productId}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>{l.sku}</td>
                  <td style={cell}>{l.name}</td>
                  <td style={cell}>{l.baseUom}</td>
                  <td style={{ ...cell, borderBottom: '1px solid #94a3b8' }}>{!editable && l.countedQty != null ? fmtQty(l.countedQty) : ''}</td>
                  <td style={{ ...cell, borderBottom: '1px solid #94a3b8' }} />
                </tr>
              ))}
            </tbody>
          </table>
          <Signatures labels={[['Penghitung'], ['Pemeriksa'], ['Kepala gudang']]} />
        </PrintSheet>
      </div>
    </>
  );
}
