/** Rak gudang: master rak, isi tiap rak, pindah antar rak, pencarian "barang ini ada di rak mana", riwayat, dan pemeriksaan konsistensi */
import { PlusOutlined, PrinterOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { ControlsTab, ImportBinsModal, LabelsTab, QuickMoveTab } from './BinTools';
import { useHasRole } from '@/lib/roles';
import type { SalesOrder } from '@sansu/shared';

const KEY = 'bins';
const UNASSIGNED_CODE = 'BELUM-DITEMPATKAN';

interface Wh { id: string; code: string; name: string; binsEnabled: boolean; binCount: number }
interface Bin { id: string; code: string; zone: string | null; name: string | null; kind: string; isActive: boolean; qty: string; products: number }
interface Row { binId: string; binCode: string; binKind: string; zone: string | null; warehouseId: string; warehouseCode: string; productId: string; sku: string; name: string; uom: string; lotId: string | null; lotNo: string | null; expiryDate: string | null; qty: string }
interface Hist { id: string; createdAt: string; kind: string; qty: string; sku: string; name: string; lotNo: string | null; fromCode: string | null; toCode: string | null; refType: string | null; note: string | null; by: string | null }
interface PickLine { productId: string; sku: string; name: string; uom: string; binId: string; binCode: string; zone: string | null; binKind: string; lotId: string | null; lotNo: string | null; expiryDate: string | null; qty: string; available: string }
interface PickPlan { warehouse: { code: string; name: string }; order: { number: string } | null; lines: PickLine[]; shortages: { productId: string; sku: string; name: string; needed: string; available: string }[]; unplaced: number }
interface Check { enabled: boolean; ok: boolean; productMismatches: { sku: string; name: string; balance: string; binned: string }[]; lotMismatches: { sku: string; name: string; lotNo: string | null; balance: string; binned: string }[]; unassigned: { products: number; qty: string } }

const KIND: Record<string, { label: string; color?: string }> = {
  STORAGE: { label: 'Simpan', color: 'blue' },
  STAGING: { label: 'Penyiapan', color: 'cyan' },
  DAMAGED: { label: 'Rusak', color: 'red' },
  QUARANTINE: { label: 'Karantina', color: 'orange' },
  UNASSIGNED: { label: 'Belum ditempatkan', color: 'gold' },
};
const MOVE_KIND: Record<string, string> = { SEED: 'Stok awal', RECEIVE: 'Masuk', ISSUE: 'Keluar', MOVE: 'Pindah rak' };

export default function BinsPage() {
  const can = useCan();
  const [wid, setWid] = useState<string | undefined>();
  const [tab, setTab] = useState('bins');
  const [binFilter, setBinFilter] = useState<string | undefined>();
  const whs = useQuery({ queryKey: [KEY, 'warehouses'], queryFn: () => get<Wh[]>('/inventory/bins/warehouses') });
  useEffect(() => {
    if (!wid && whs.data?.length) setWid((whs.data.find((w) => w.binsEnabled) ?? whs.data[0]).id);
  }, [whs.data, wid]);
  const wh = whs.data?.find((w) => w.id === wid);
  const detail = useQuery({ queryKey: [KEY, 'list', wid], queryFn: () => get<{ bins: Bin[] }>(`/inventory/bins${qs({ warehouseId: wid })}`), enabled: !!wid && !!wh?.binsEnabled });
  const bins = detail.data?.bins ?? [];
  const activate = useAction(() => post('/inventory/bins/activate', { warehouseId: wid }), { success: 'Lokasi rak diaktifkan', invalidate: [KEY] });
  const deactivate = useAction(() => post('/inventory/bins/deactivate', { warehouseId: wid }), { success: 'Lokasi rak dinonaktifkan', invalidate: [KEY] });
  const unassigned = bins.find((b) => b.kind === 'UNASSIGNED');
  const placed = bins.filter((b) => b.kind !== 'UNASSIGNED');
  const canControls = useHasRole(['ADMIN', 'FINANCE', 'ACCOUNTANT']);

  return (
    <>
      <PageHeader title="Rak gudang" />
      <Space wrap style={{ marginBottom: 16 }}>
        <Select style={{ minWidth: 260 }} placeholder="Pilih gudang" value={wid} onChange={(v) => { setWid(v); setBinFilter(undefined); }} loading={whs.isLoading}
          options={(whs.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}${w.binsEnabled ? ' (rak aktif)' : ''}` }))} />
        {wh?.binsEnabled && can('POST', '/inventory/bins/deactivate') && (
          <Popconfirm title="Nonaktifkan lokasi rak gudang ini?" description={`Semua stok harus sudah di ${UNASSIGNED_CODE}. Stok gudang tidak berubah.`} okText="Nonaktifkan" onConfirm={() => deactivate.mutate(undefined)}>
            <Button danger loading={deactivate.isPending}>Nonaktifkan rak</Button>
          </Popconfirm>
        )}
      </Space>

      {!wh && !whs.isLoading && <Empty description="Belum ada gudang" />}
      {wh && !wh.binsEnabled && (
        <Alert
          type="info"
          showIcon
          message={`Lokasi rak belum aktif di ${wh.name}`}
          description={
            <>
              <p style={{ margin: '4px 0' }}>Setelah diaktifkan, stok gudang ini juga dicatat per rak dan per lot. Stok yang ada sekarang masuk ke rak sistem <b>{UNASSIGNED_CODE}</b>, lalu ditata ke rak-rak Anda. Jumlah stok, HPP, dan jurnal tidak berubah; rak hanya mencatat letak barang.</p>
              <p style={{ margin: '4px 0' }}>Pakai untuk gudang besar dengan banyak jenis barang. Toko kecil atau dapur biasanya cukup per gudang.</p>
              {can('POST', '/inventory/bins/activate') ? (
                <Popconfirm title={`Aktifkan lokasi rak di ${wh.name}?`} okText="Aktifkan" onConfirm={() => activate.mutate(undefined)}>
                  <Button type="primary" loading={activate.isPending}>Aktifkan lokasi rak</Button>
                </Popconfirm>
              ) : (
                <Typography.Text type="secondary">Minta Admin atau Keuangan untuk mengaktifkannya.</Typography.Text>
              )}
            </>
          }
        />
      )}

      {wh?.binsEnabled && wid && (
        <>
          <SummaryCards
            items={[
              { label: 'Rak aktif', value: String(placed.filter((b) => b.isActive).length) },
              { label: 'Belum ditempatkan', value: `${unassigned?.products ?? 0} barang`, hint: unassigned ? `${fmtQty(unassigned.qty)} satuan` : undefined },
              { label: 'Rak terisi', value: String(placed.filter((b) => Number(b.qty) > 0).length) },
            ]}
          />
          {Number(unassigned?.qty ?? 0) > 0 && (
            <Alert style={{ marginBottom: 16 }} type="warning" showIcon message={`Masih ada ${unassigned!.products} barang di ${UNASSIGNED_CODE}`} description="Barang yang baru masuk atau stok awal belum diberi rak. Buka tab Isi rak, pilih barangnya, lalu pindahkan ke rak." />
          )}
          <Tabs
            activeKey={tab}
            onChange={setTab}
            destroyOnHidden
            items={[
              { key: 'bins', label: 'Daftar rak', children: <BinsTab wid={wid} bins={bins} onOpen={(id) => { setBinFilter(id); setTab('stock'); }} /> },
              { key: 'quick', label: 'Pindah cepat', children: <QuickMoveTab wid={wid} warehouse={{ code: wh.code, name: wh.name }} bins={bins} /> },
              { key: 'stock', label: 'Isi rak', children: <StockTab wid={wid} bins={bins} binId={binFilter} setBinId={setBinFilter} /> },
              { key: 'pick', label: 'Daftar ambil', children: <PickTab wid={wid} warehouseLabel={`${wh.code} · ${wh.name}`} /> },
              { key: 'find', label: 'Cari barang', children: <FindTab /> },
              { key: 'history', label: 'Riwayat', children: <HistoryTab wid={wid} /> },
              { key: 'label', label: 'Label rak', children: <LabelsTab bins={bins} warehouse={{ code: wh.code, name: wh.name }} /> },
              ...(canControls ? [{ key: 'controls', label: 'Kontrol', children: <ControlsTab wid={wid} /> }] : []),
              { key: 'check', label: 'Pemeriksaan', children: <CheckTab wid={wid} /> },
            ]}
          />
        </>
      )}
    </>
  );
}

function BinsTab({ wid, bins, onOpen }: { wid: string; bins: Bin[]; onOpen: (id: string) => void }) {
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const toggle = useAction((v: { id: string; isActive: boolean }) => patch(`/inventory/bins/${v.id}`, { isActive: v.isActive }), { success: 'Rak diperbarui', invalidate: [KEY] });
  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        {can('POST', '/inventory/bins') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Tambah rak</Button>}
        {can('POST', '/inventory/bins/import') && <Button onClick={() => setImporting(true)}>Impor dari berkas</Button>}
      </Space>
      <ResponsiveTable<Bin>
        rowKey="id"
        size="small"
        dataSource={bins}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        mobileTitle={0}
        columns={[
          { title: 'Kode rak', dataIndex: 'code', render: (v: string, r) => <Space><a onClick={() => onOpen(r.id)}>{v}</a>{!r.isActive && <Tag>Nonaktif</Tag>}</Space> },
          { title: 'Zona', dataIndex: 'zone', render: (v) => v ?? '-' },
          { title: 'Jenis', dataIndex: 'kind', render: (v: string) => <Tag color={KIND[v]?.color}>{KIND[v]?.label ?? v}</Tag> },
          { title: 'Barang', dataIndex: 'products', align: 'right' },
          { title: 'Jumlah', dataIndex: 'qty', align: 'right', render: (v: string) => fmtQty(v) },
          {
            title: '',
            key: 'act',
            render: (_: unknown, r) =>
              r.kind !== 'UNASSIGNED' && can('PATCH', '/inventory/bins/:id') ? (
                <Button size="small" onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}>{r.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
              ) : null,
          },
        ]}
      />
      <AddBinsModal open={adding} wid={wid} onClose={() => setAdding(false)} />
      <ImportBinsModal open={importing} wid={wid} onClose={() => setImporting(false)} />
    </>
  );
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function AddBinsModal({ open, wid, onClose }: { open: boolean; wid: string; onClose: () => void }) {
  const [form] = Form.useForm();
  const create = useAction((v: { codes: string[]; kind: string; zone?: string }) => post('/inventory/bins', { warehouseId: wid, ...v }), {
    success: 'Rak ditambahkan',
    invalidate: [KEY],
    onSuccess: () => { form.resetFields(); onClose(); },
  });
  const generate = () => {
    const v = form.getFieldsValue();
    const aisles = String(v.aisles ?? '').split(/[,\s]+/).filter(Boolean);
    const from = Number(v.from ?? 1);
    const to = Number(v.to ?? 1);
    const l1 = Number(v.levelFrom ?? 0);
    const l2 = Number(v.levelTo ?? 0);
    if (!aisles.length || to < from || (l2 && l2 < l1)) return;
    const lines: string[] = [];
    for (const a of aisles) for (let i = from; i <= to; i++) {
      if (l2) for (let l = l1 || 1; l <= l2; l++) lines.push(`${a}-${pad(i, 2)}-${pad(l, 2)}`);
      else lines.push(`${a}-${pad(i, 2)}`);
    }
    form.setFieldsValue({ codesText: [...(String(v.codesText ?? '').trim() ? [String(v.codesText).trim()] : []), ...lines].join('\n') });
  };
  return (
    <Modal title="Tambah rak" open={open} onCancel={onClose} okText="Simpan" confirmLoading={create.isPending} width={560}
      onOk={() => form.validateFields().then((v) => create.mutate({ codes: String(v.codesText).split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean), kind: v.kind, zone: v.zone || undefined }))}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'STORAGE', from: 1, to: 10, levelFrom: 1, levelTo: 3 }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Isi daftar kode sendiri, atau buat deret otomatis lalu periksa hasilnya." />
        <Space wrap align="end" style={{ marginBottom: 8 }}>
          <Form.Item label="Lorong (pisah koma)" name="aisles" style={{ margin: 0 }}><Input placeholder="A, B" style={{ width: 130 }} /></Form.Item>
          <Form.Item label="Nomor dari" name="from" style={{ margin: 0 }}><InputNumber min={1} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="sampai" name="to" style={{ margin: 0 }}><InputNumber min={1} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="Level dari" name="levelFrom" style={{ margin: 0 }}><InputNumber min={0} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="sampai" name="levelTo" style={{ margin: 0 }}><InputNumber min={0} style={{ width: 80 }} /></Form.Item>
          <Button onClick={generate}>Buat deret</Button>
        </Space>
        <Form.Item label="Kode rak (satu per baris, maks 200)" name="codesText" rules={[{ required: true, message: 'Isi minimal satu kode rak' }]}>
          <Input.TextArea rows={6} placeholder={'A-01-01\nA-01-02'} />
        </Form.Item>
        <Space wrap>
          <Form.Item label="Jenis" name="kind" style={{ margin: 0 }}>
            <Select style={{ width: 200 }} options={['STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE'].map((k) => ({ value: k, label: KIND[k].label }))} />
          </Form.Item>
          <Form.Item label="Zona (opsional)" name="zone" style={{ margin: 0 }}><Input style={{ width: 160 }} maxLength={30} /></Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

function StockTab({ wid, bins, binId, setBinId }: { wid: string; bins: Bin[]; binId?: string; setBinId: (v?: string) => void }) {
  const can = useCan();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [moving, setMoving] = useState<Row[] | null>(null);
  const rows = useQuery({ queryKey: [KEY, 'stock', wid, binId, q], queryFn: () => get<{ rows: Row[]; truncated: boolean }>(`/inventory/bins/stock${qs({ warehouseId: wid, binId, q: q.trim() || undefined })}`) });
  const data = rows.data?.rows ?? [];
  const rowKey = (r: Row) => `${r.binId}|${r.productId}|${r.lotId ?? ''}`;
  const canMove = can('POST', '/inventory/bins/move');
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Semua rak" style={{ minWidth: 200 }} value={binId} onChange={(v) => { setBinId(v); setSel([]); }}
          options={bins.map((b) => ({ value: b.id, label: `${b.code}${b.kind === 'UNASSIGNED' ? '' : ` · ${KIND[b.kind]?.label}`}` }))} showSearch optionFilterProp="label" />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Cari kode / nama / barcode" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
        {canMove && <Button icon={<SwapOutlined />} disabled={!sel.length} onClick={() => setMoving(data.filter((r) => sel.includes(rowKey(r))))}>Pindahkan terpilih ({sel.length})</Button>}
      </Space>
      {rows.data?.truncated && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Hanya 500 baris pertama. Persempit dengan memilih rak atau mencari barang." />}
      <ResponsiveTable<Row>
        rowKey={rowKey}
        size="small"
        loading={rows.isLoading}
        dataSource={data}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        rowSelection={canMove ? { selectedRowKeys: sel, onChange: (k) => setSel(k as string[]) } : undefined}
        mobileTitle={1}
        columns={[
          { title: 'Rak', dataIndex: 'binCode', render: (v: string, r) => <Space size={4}>{v}{r.binKind !== 'STORAGE' && <Tag color={KIND[r.binKind]?.color}>{KIND[r.binKind]?.label}</Tag>}</Space> },
          { title: 'Barang', key: 'p', render: (_: unknown, r) => `${r.sku} · ${r.name}` },
          { title: 'Lot', dataIndex: 'lotNo', render: (v) => v ?? '-' },
          { title: 'Kedaluwarsa', dataIndex: 'expiryDate', render: (v: string | null) => (v ? fmtDate(v) : '-') },
          { title: 'Jumlah', dataIndex: 'qty', align: 'right', render: (v: string, r) => `${fmtQty(v)} ${r.uom}` },
          { title: '', key: 'a', render: (_: unknown, r) => (canMove ? <Button size="small" onClick={() => setMoving([r])}>Pindah</Button> : null) },
        ]}
      />
      <MoveModal wid={wid} bins={bins} rows={moving} onClose={() => { setMoving(null); setSel([]); }} />
    </>
  );
}

function MoveModal({ wid, bins, rows, onClose }: { wid: string; bins: Bin[]; rows: Row[] | null; onClose: () => void }) {
  const [to, setTo] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const key = (r: Row) => `${r.binId}|${r.productId}|${r.lotId ?? ''}`;
  useEffect(() => { setTo(undefined); setNote(''); setQtys({}); }, [rows]);
  const move = useAction(
    (lines: { productId: string; lotId?: string; fromBinId: string; toBinId: string; qty: string }[]) => post('/inventory/bins/move', { warehouseId: wid, lines, note: note.trim() || undefined }),
    { success: 'Stok dipindahkan antar rak', invalidate: [KEY], onSuccess: onClose },
  );
  const targets = useMemo(() => bins.filter((b) => b.isActive), [bins]);
  if (!rows) return null;
  const submit = () => {
    if (!to) return;
    move.mutate(rows.filter((r) => r.binId !== to).map((r) => ({ productId: r.productId, lotId: r.lotId ?? undefined, fromBinId: r.binId, toBinId: to, qty: String(qtys[key(r)] ?? Number(r.qty)) })));
  };
  return (
    <Modal open title="Pindahkan stok antar rak" onCancel={onClose} okText="Pindahkan" onOk={submit} okButtonProps={{ disabled: !to }} confirmLoading={move.isPending} width={640}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select showSearch optionFilterProp="label" placeholder="Rak tujuan" style={{ width: '100%' }} value={to} onChange={setTo}
          options={targets.map((b) => ({ value: b.id, label: `${b.code}${b.kind === 'UNASSIGNED' ? '' : ` · ${KIND[b.kind]?.label}`}` }))} />
        <Table
          size="small"
          rowKey={key}
          pagination={false}
          dataSource={rows}
          scroll={{ y: 260 }}
          columns={[
            { title: 'Dari', dataIndex: 'binCode', width: 120 },
            { title: 'Barang', key: 'p', render: (_: unknown, r: Row) => `${r.sku}${r.lotNo ? ` · lot ${r.lotNo}` : ''}` },
            { title: 'Jumlah dipindah', key: 'q', width: 150, render: (_: unknown, r: Row) => <InputNumber min={0.0001} max={Number(r.qty)} value={qtys[key(r)] ?? Number(r.qty)} onChange={(v) => setQtys({ ...qtys, [key(r)]: Number(v) })} addonAfter={`/ ${fmtQty(r.qty)}`} style={{ width: 150 }} /> },
          ]}
        />
        <Input placeholder="Catatan (opsional, mis. kemasan sobek)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        <Typography.Text type="secondary">Memindahkan rak tidak mengubah jumlah stok gudang, HPP, maupun jurnal. Mengeluarkan stok dari rak rusak/karantina hanya boleh oleh Pemilik atau Admin.</Typography.Text>
      </Space>
    </Modal>
  );
}

/** Daftar ambil: dari pesanan penjualan yang belum terkirim, atau diketik manual; urut jalan petugas, lot paling cepat kedaluwarsa lebih dulu */
function PickTab({ wid, warehouseLabel }: { wid: string; warehouseLabel: string }) {
  const [mode, setMode] = useState<'order' | 'manual'>('order');
  const [orderId, setOrderId] = useState<string | undefined>();
  const [items, setItems] = useState<{ productId?: string; qty?: number }[]>([{}]);
  const [manualKey, setManualKey] = useState('');
  const orders = useQuery({ queryKey: ['sales-orders', 'all'], queryFn: () => get<SalesOrder[]>('/sales-orders'), enabled: mode === 'order' });
  const { data: products } = useProducts();
  const open = (orders.data ?? []).filter((o) => o.status === 'CONFIRMED' && (!o.warehouse?.id || o.warehouse.id === wid));
  const manual = items.filter((i) => i.productId && i.qty && i.qty > 0).map((i) => `${i.productId}:${i.qty}`).join(',');
  const key = mode === 'order' ? (orderId ? `salesOrderId=${orderId}` : '') : manualKey;
  const plan = useQuery({
    queryKey: [KEY, 'pick', wid, key],
    queryFn: () => get<PickPlan>(`/inventory/bins/pick-plan?${mode === 'order' ? key : `warehouseId=${wid}&items=${manualKey.replace(/^items=/, '')}`}`),
    enabled: !!key,
    retry: false,
  });
  const lines = plan.data?.lines ?? [];
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Segmented value={mode} onChange={(v) => setMode(v as 'order' | 'manual')} options={[{ value: 'order', label: 'Dari pesanan penjualan' }, { value: 'manual', label: 'Ketik sendiri' }]} />
      {mode === 'order' ? (
        <Select showSearch optionFilterProp="label" allowClear placeholder="Pilih pesanan yang belum dikirim" style={{ width: 420, maxWidth: '100%' }} value={orderId} onChange={setOrderId} loading={orders.isLoading}
          options={open.map((o) => ({ value: o.id, label: `${o.number} · ${o.customer.name}` }))} />
      ) : (
        <>
          {items.map((it, i) => (
            <Space key={i} wrap>
              <Select showSearch optionFilterProp="label" placeholder="Barang" style={{ width: 320, maxWidth: '100%' }} value={it.productId} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, productId: v } : x)))}
                options={(products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} />
              <InputNumber min={0.0001} placeholder="Jumlah" value={it.qty} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(v) } : x)))} />
              {items.length > 1 && <Button size="small" onClick={() => setItems(items.filter((_, j) => j !== i))}>Hapus</Button>}
            </Space>
          ))}
          <Space>
            <Button size="small" onClick={() => setItems([...items, {}])}>Tambah barang</Button>
            <Button type="primary" size="small" disabled={!manual} onClick={() => setManualKey(manual)}>Buat daftar ambil</Button>
          </Space>
        </>
      )}
      {plan.isError && <Alert type="error" showIcon message={(plan.error as Error).message} />}
      {plan.data && (
        <>
          {plan.data.shortages.length > 0 && (
            <Alert type="warning" showIcon message="Stok yang bisa diambil tidak cukup" description={plan.data.shortages.map((s) => `${s.sku}: butuh ${fmtQty(s.needed)}, tersedia ${fmtQty(s.available)}`).join(' · ') + '. Stok di rak rusak/karantina tidak dihitung.'} />
          )}
          {plan.data.unplaced > 0 && <Alert type="info" showIcon message={`${plan.data.unplaced} baris diambil dari ${UNASSIGNED_CODE}: barangnya belum ditata, cari di area penerimaan.`} />}
          <Button icon={<PrinterOutlined />} style={{ width: 'fit-content' }} onClick={() => printDoc('Daftar ambil')}>Cetak daftar ambil</Button>
          <div className="print-doc">
            <Typography.Title level={4} style={{ margin: '8px 0' }}>Daftar ambil{plan.data.order ? ` · ${plan.data.order.number}` : ''}</Typography.Title>
            <Typography.Text type="secondary">{warehouseLabel} · urut jalan: zona, rak · lot paling cepat kedaluwarsa lebih dulu</Typography.Text>
            <ResponsiveTable<PickLine>
              rowKey={(r) => `${r.binId}|${r.productId}|${r.lotId ?? ''}`}
              size="small"
              style={{ marginTop: 8 }}
              pagination={false}
              dataSource={lines}
              mobileTitle={0}
              columns={[
                { title: 'Rak', dataIndex: 'binCode', render: (v: string, r) => <Space size={4}><b>{v}</b>{r.zone && <Tag>{r.zone}</Tag>}{r.binKind === 'UNASSIGNED' && <Tag color="gold">belum ditata</Tag>}</Space> },
                { title: 'Barang', key: 'p', render: (_: unknown, r) => `${r.sku} · ${r.name}` },
                { title: 'Lot', dataIndex: 'lotNo', render: (v) => v ?? '-' },
                { title: 'Kedaluwarsa', dataIndex: 'expiryDate', render: (v: string | null) => (v ? fmtDate(v) : '-') },
                { title: 'Ambil', dataIndex: 'qty', align: 'right', render: (v: string, r) => <b>{fmtQty(v)} {r.uom}</b> },
                { title: 'Ada di rak', dataIndex: 'available', align: 'right', render: (v: string) => fmtQty(v) },
                { title: '✓', key: 'chk', width: 40, render: () => '☐' },
              ]}
            />
          </div>
        </>
      )}
    </Space>
  );
}

function FindTab() {
  const [q, setQ] = useState('');
  const term = q.trim();
  const res = useQuery({ queryKey: [KEY, 'find', term], queryFn: () => get<{ rows: Row[] }>(`/inventory/bins/stock${qs({ q: term })}`), enabled: term.length >= 2 });
  return (
    <>
      <Input.Search allowClear autoFocus placeholder="Ketik kode, nama, atau barcode barang (min. 2 huruf)" style={{ maxWidth: 420, marginBottom: 12 }} value={q} onChange={(e) => setQ(e.target.value)} />
      {term.length < 2 ? (
        <Typography.Text type="secondary">Cari untuk melihat barang itu ada di gudang dan rak mana, termasuk lotnya.</Typography.Text>
      ) : (
        <ResponsiveTable<Row>
          rowKey={(r) => `${r.binId}|${r.productId}|${r.lotId ?? ''}`}
          size="small"
          loading={res.isLoading}
          dataSource={res.data?.rows ?? []}
          locale={{ emptyText: 'Tidak ditemukan di gudang yang memakai rak' }}
          mobileTitle={1}
          columns={[
            { title: 'Barang', key: 'p', render: (_: unknown, r) => `${r.sku} · ${r.name}` },
            { title: 'Gudang', dataIndex: 'warehouseCode' },
            { title: 'Rak', dataIndex: 'binCode', render: (v: string, r) => <Space size={4}>{v}{r.binKind === 'UNASSIGNED' && <Tag color="gold">belum ditata</Tag>}</Space> },
            { title: 'Lot', dataIndex: 'lotNo', render: (v) => v ?? '-' },
            { title: 'Kedaluwarsa', dataIndex: 'expiryDate', render: (v: string | null) => (v ? fmtDate(v) : '-') },
            { title: 'Jumlah', dataIndex: 'qty', align: 'right', render: (v: string, r) => `${fmtQty(v)} ${r.uom}` },
          ]}
        />
      )}
    </>
  );
}

function HistoryTab({ wid }: { wid: string }) {
  const h = useQuery({ queryKey: [KEY, 'history', wid], queryFn: () => get<Hist[]>(`/inventory/bins/history${qs({ warehouseId: wid })}`) });
  return (
    <ResponsiveTable<Hist>
      rowKey="id"
      size="small"
      loading={h.isLoading}
      dataSource={h.data ?? []}
      pagination={{ pageSize: 50, hideOnSinglePage: true }}
      mobileTitle={0}
      columns={[
        { title: 'Waktu', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString('id-ID') },
        { title: 'Jenis', dataIndex: 'kind', render: (v: string) => MOVE_KIND[v] ?? v },
        { title: 'Barang', key: 'p', render: (_: unknown, r) => `${r.sku} · ${r.name}${r.lotNo ? ` (lot ${r.lotNo})` : ''}` },
        { title: 'Dari', dataIndex: 'fromCode', render: (v) => v ?? '-' },
        { title: 'Ke', dataIndex: 'toCode', render: (v) => v ?? '-' },
        { title: 'Jumlah', dataIndex: 'qty', align: 'right', render: (v: string) => fmtQty(v) },
        { title: 'Oleh', dataIndex: 'by', render: (v) => v ?? 'Sistem' },
        { title: 'Catatan', dataIndex: 'note', render: (v) => v ?? '' },
      ]}
    />
  );
}

function CheckTab({ wid }: { wid: string }) {
  const c = useQuery({ queryKey: [KEY, 'check', wid], queryFn: () => get<Check>(`/inventory/bins/check${qs({ warehouseId: wid })}`) });
  if (c.isError) return <Alert type="info" showIcon message="Pemeriksaan hanya untuk Admin, Keuangan, Akuntan, dan Gudang." />;
  const d = c.data;
  if (!d) return null;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {d.ok ? (
        <Alert type="success" showIcon message="Cocok: jumlah di semua rak sama dengan stok gudang, per barang dan per lot." />
      ) : (
        <Alert type="error" showIcon message="Ada selisih antara stok rak dan stok gudang" description="Stok gudang tetap benar (dasar HPP dan jurnal). Selisih ini hanya pada pencatatan letak. Hubungi dukungan bila berulang." />
      )}
      {d.productMismatches.length > 0 && (
        <Table size="small" pagination={false} rowKey={(r) => r.sku} dataSource={d.productMismatches} title={() => 'Selisih per barang'}
          columns={[{ title: 'Barang', render: (_: unknown, r) => `${r.sku} · ${r.name}` }, { title: 'Stok gudang', dataIndex: 'balance', align: 'right', render: fmtQty }, { title: 'Jumlah di rak', dataIndex: 'binned', align: 'right', render: fmtQty }]} />
      )}
      {d.lotMismatches.length > 0 && (
        <Table size="small" pagination={false} rowKey={(r) => `${r.sku}${r.lotNo}`} dataSource={d.lotMismatches} title={() => 'Selisih per lot'}
          columns={[{ title: 'Barang', render: (_: unknown, r) => `${r.sku} · ${r.name}` }, { title: 'Lot', dataIndex: 'lotNo', render: (v) => v ?? '-' }, { title: 'Stok lot', dataIndex: 'balance', align: 'right', render: fmtQty }, { title: 'Jumlah di rak', dataIndex: 'binned', align: 'right', render: fmtQty }]} />
      )}
    </Space>
  );
}
