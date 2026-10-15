import ResponsiveTable from '@/components/ResponsiveTable';
import { EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers, useProducts, useWarehouses } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface SummaryRow { userId: string; name: string; plannedStops: number; visits: number; effectiveCalls: number; farVisits: number; invoices: number; vanSales: string; collectionsPending: string; collectionsVerified: string; shortage: string; staleCollections: number; vanQty: string; vanValue: string }
interface Van { id: string; code: string; name: string; userId: string; userName: string; qty: string; value: string; skus: number }
interface Collection { id: string; number: string; date: string; salesName: string; customerName: string; invoiceNumber: string; amount: string; status: 'PENDING' | 'VERIFIED' | 'REJECTED'; receivedAmount: string | null; shortage: string; overdue: boolean; method: string }
interface RouteRow { id: string; name: string; salespersonId: string; salesName: string; weekday: number | null; isActive: boolean; stops: { customerId: string; seq: number; code: string; name: string }[] }
interface Visit { id: string; salesName: string; customerName: string; result: 'ORDER' | 'NO_ORDER' | 'CLOSED'; distanceM: number | null; farFromOutlet: boolean; checkedInAt: string; note: string | null }
const DAYS = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const RESULT = { ORDER: 'Ada pesanan', NO_ORDER: 'Tidak order', CLOSED: 'Tutup' };

/** Kanvas / van sales: mobil, penjualan dari mobil, setoran tagihan, rute & kunjungan */
export default function CanvassPage() {
  const { me } = useAuth();
  const can = useCan();
  const isSales = me?.role === 'SALES';
  const { data: summary } = useQuery({ queryKey: ['canvass-summary'], queryFn: () => get<{ date: string; rows: SummaryRow[] }>('/canvass/summary') });
  const totals = (summary?.rows ?? []).reduce((a, r) => ({ sales: a.sales + Number(r.vanSales), shortage: a.shortage + Number(r.shortage), pending: a.pending + Number(r.collectionsPending), far: a.far + r.farVisits }), { sales: 0, shortage: 0, pending: 0, far: 0 });
  return (
    <>
      <PageHeader title="Kanvas (van sales)" />
      <SummaryCards items={[
        { label: 'Penjualan mobil hari ini', value: fmtMoney(totals.sales) },
        { label: 'Setoran menunggu Keuangan', value: fmtMoney(totals.pending), tone: totals.pending > 0 ? 'warn' : 'good' },
        { label: 'Kekurangan setoran (total)', value: fmtMoney(totals.shortage), tone: totals.shortage > 0 ? 'bad' : 'good' },
        { label: 'Kunjungan jauh dari outlet', value: String(totals.far), tone: totals.far > 0 ? 'warn' : 'good', hint: 'lebih dari 300 m dari titik outlet' },
      ]} />
      <Tabs items={[
        { key: 'sum', label: 'Ringkasan hari ini', children: <SummaryTab rows={summary?.rows ?? []} /> },
        ...(isSales || can('POST', '/canvass/sales') ? [{ key: 'sale', label: 'Jual dari mobil', children: <SaleTab isSales={isSales} /> }] : []),
        { key: 'col', label: 'Setoran tagihan', children: <CollectionsTab /> },
        { key: 'van', label: 'Mobil', children: <VansTab /> },
        { key: 'route', label: 'Rute & kunjungan', children: <RoutesTab isSales={isSales} /> },
      ]} />
    </>
  );
}

function SummaryTab({ rows }: { rows: SummaryRow[] }) {
  return (
    <ResponsiveTable<SummaryRow> rowKey="userId" size="small" dataSource={rows} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada sales' }}
      columns={[
        { title: 'Sales', dataIndex: 'name' },
        { title: 'Kunjungan', render: (_: unknown, r: SummaryRow) => `${r.visits} / ${r.plannedStops} jadwal` },
        { title: 'Efektif (order)', dataIndex: 'effectiveCalls', align: 'right' as const },
        { title: 'Penjualan mobil', align: 'right' as const, render: (_: unknown, r: SummaryRow) => `${fmtMoney(r.vanSales)} (${r.invoices} faktur)` },
        { title: 'Setoran menunggu', align: 'right' as const, render: (_: unknown, r: SummaryRow) => <span>{fmtMoney(r.collectionsPending)}{r.staleCollections > 0 && <Tag color="red" style={{ marginLeft: 4 }}>{r.staleCollections} lewat 2 hari</Tag>}</span> },
        { title: 'Kekurangan setoran', align: 'right' as const, render: (_: unknown, r: SummaryRow) => (Number(r.shortage) > 0 ? <Typography.Text type="danger">{fmtMoney(r.shortage)}</Typography.Text> : '-') },
        { title: 'Stok mobil', align: 'right' as const, render: (_: unknown, r: SummaryRow) => `${fmtQty(r.vanQty)} · ${fmtMoney(r.vanValue)}` },
        { title: 'Jauh dari outlet', align: 'right' as const, render: (_: unknown, r: SummaryRow) => (r.farVisits > 0 ? <Tag color="orange">{r.farVisits}</Tag> : '-') },
      ]} />
  );
}

function SaleTab({ isSales }: { isSales: boolean }) {
  const { data: customers } = useCustomers();
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses({ all: true });
  const vans = (warehouses ?? []).filter((w) => w.kind === 'VAN');
  const [form] = Form.useForm<{ customerId: string; vanId?: string; customerPoNo?: string; lines: { productId?: string; qty?: number }[]; collect?: number }>();
  const sale = useAction(
    (v: { customerId: string; vanId?: string; customerPoNo?: string; lines: { productId?: string; qty?: number }[]; collect?: number }) =>
      post<{ invoiceNumber: string; total: string; collectionError?: string }>('/canvass/sales', { customerId: v.customerId, vanId: v.vanId, customerPoNo: v.customerPoNo, lines: v.lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId, qty: String(l.qty) })), collect: v.collect ? { amount: String(v.collect), method: 'CASH' } : undefined }),
    { success: (r) => (r.collectionError ? r.collectionError : `Faktur ${r.invoiceNumber} dibuat (${fmtMoney(r.total)})`), invalidate: ['canvass-summary', 'canvass-vans', 'canvass-collections', 'invoices', 'stock'], onSuccess: () => form.resetFields() },
  );
  return (
    <Card>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Harga dan potongan otomatis dari daftar harga outlet dan promo yang berlaku — sales tidak dapat mengubahnya. Uang yang diterima di tempat dicatat sebagai setoran dan baru menjadi pelunasan setelah Keuangan menerimanya." />
      <Form form={form} layout="vertical" initialValues={{ lines: [{}] }} onFinish={(v) => sale.mutate(v)}>
        <Form.Item name="customerId" label="Outlet" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
        <Form.Item name="customerPoNo" label="Nomor PO outlet (bila outlet mewajibkan)"><Input maxLength={60} style={{ maxWidth: 260 }} /></Form.Item>
        {!isSales && <Form.Item name="vanId" label="Mobil" rules={[{ required: true }]}><Select options={vans.map((v) => ({ value: v.id, label: `${v.code} · ${v.name}` }))} /></Form.Item>}
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                  <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih produk' }]}><Select showSearch optionFilterProp="label" style={{ width: 320 }} placeholder="Produk" options={(products ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
                  <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Jumlah' }]}><InputNumber min={0.0001} placeholder="Jumlah" style={{ width: 120 }} /></Form.Item>
                  {fields.length > 1 && <Button type="text" danger onClick={() => remove(f.name)}>Hapus</Button>}
                </Space>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>Tambah produk</Button>
            </>
          )}
        </Form.List>
        <Form.Item name="collect" label="Uang tunai diterima di tempat (opsional)" style={{ marginTop: 12 }}><InputNumber min={0} prefix="Rp" style={{ width: 220 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={sale.isPending}>Catat penjualan & buat faktur</Button>
      </Form>
    </Card>
  );
}

function CollectionsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['canvass-collections'], queryFn: () => get<Collection[]>('/canvass/collections') });
  const [verifying, setVerifying] = useState<Collection | null>(null);
  const [rejecting, setRejecting] = useState<Collection | null>(null);
  const [vf] = Form.useForm<{ received: number }>();
  const [rf] = Form.useForm<{ reason: string }>();
  const inv = ['canvass-collections', 'canvass-summary', 'invoices', 'cash-accounts', 'journals'];
  const verify = useAction((v: { id: string; received: number }) => post<{ shortage: string }>(`/canvass/collections/${v.id}/verify`, { receivedAmount: String(v.received) }), { success: (r) => (Number(r.shortage) > 0 ? `Diverifikasi — kekurangan ${fmtMoney(r.shortage)} dicatat atas nama sales` : 'Diverifikasi dan dilunasi'), invalidate: inv, onSuccess: () => setVerifying(null) });
  const reject = useAction((v: { id: string; reason: string }) => post(`/canvass/collections/${v.id}/reject`, { reason: v.reason }), { success: 'Setoran ditolak', invalidate: inv, onSuccess: () => setRejecting(null) });
  return (
    <>
      <ResponsiveTable<Collection> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 10 }} scroll={{ x: 820 }} locale={{ emptyText: 'Belum ada setoran' }}
        columns={[
          { title: 'Nomor', dataIndex: 'number', render: (n: string, c: Collection) => <div>{n}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(c.date)}</div></div> },
          { title: 'Sales', dataIndex: 'salesName' },
          { title: 'Outlet / faktur', render: (_: unknown, c: Collection) => <div>{c.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{c.invoiceNumber}</div></div> },
          { title: 'Dicatat sales', align: 'right' as const, render: (_: unknown, c: Collection) => fmtMoney(c.amount) },
          { title: 'Diterima Keuangan', align: 'right' as const, render: (_: unknown, c: Collection) => (c.receivedAmount === null ? '-' : fmtMoney(c.receivedAmount)) },
          { title: 'Status', render: (_: unknown, c: Collection) => c.status === 'PENDING' ? <Tag color={c.overdue ? 'red' : 'gold'}>{c.overdue ? 'Menunggu > 2 hari' : 'Menunggu'}</Tag> : c.status === 'VERIFIED' ? <Space><Tag color="green">Diverifikasi</Tag>{Number(c.shortage) > 0 && <Tag color="red">Kurang {fmtMoney(c.shortage)}</Tag>}</Space> : <Tag color="red">Ditolak</Tag> },
          { title: '', render: (_: unknown, c: Collection) => c.status === 'PENDING' && (
            <Space>
              {can('POST', '/canvass/collections/:id/verify') && <Button size="small" type="primary" onClick={() => { vf.setFieldsValue({ received: Number(c.amount) }); setVerifying(c); }}>Terima uang</Button>}
              {can('POST', '/canvass/collections/:id/reject') && <Button size="small" danger onClick={() => { rf.resetFields(); setRejecting(c); }}>Tolak</Button>}
            </Space>
          ) },
        ]} />
      <Modal title="Terima setoran" open={!!verifying} onCancel={() => setVerifying(null)} onOk={() => vf.submit()} confirmLoading={verify.isPending} okText="Verifikasi" destroyOnHidden>
        <p>{verifying?.salesName} mencatat {fmtMoney(verifying?.amount)} dari {verifying?.customerName}. Isi uang yang benar-benar Anda terima; kekurangan dicatat atas nama sales.</p>
        <Form form={vf} layout="vertical" onFinish={(v) => verify.mutate({ id: verifying!.id, received: v.received })}>
          <Form.Item name="received" label="Uang diterima" rules={[{ required: true }]}><InputNumber min={0} max={Number(verifying?.amount ?? 0)} prefix="Rp" style={{ width: 220 }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Tolak setoran" open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => rf.submit()} confirmLoading={reject.isPending} okText="Tolak" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={rf} layout="vertical" onFinish={(v) => reject.mutate({ id: rejecting!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function VansTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['canvass-vans'], queryFn: () => get<Van[]>('/canvass/vans') });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => get<{ id: string; name: string; role: string; isActive: boolean }[]>('/users'), enabled: can('POST', '/canvass/vans') });
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ van: Van; dir: 'load' | 'unload' } | null>(null);
  const [cf] = Form.useForm<{ userId: string }>();
  const [mf] = Form.useForm<{ warehouseId: string; lines: { productId?: string; qty?: number }[] }>();
  const create = useAction((v: { userId: string }) => post('/canvass/vans', v), { success: 'Mobil dibuat', invalidate: ['canvass-vans', 'warehouses'], onSuccess: () => setCreating(false) });
  const move = useAction((v: { warehouseId: string; lines: { productId?: string; qty?: number }[] }) => post(`/canvass/vans/${moving!.van.id}/${moving!.dir}`, { warehouseId: v.warehouseId, lines: v.lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId, qty: String(l.qty) })) }), { success: 'Stok dipindah', invalidate: ['canvass-vans', 'canvass-summary', 'stock', 'stock-moves'], onSuccess: () => setMoving(null) });
  return (
    <>
      <Space style={{ marginBottom: 8 }}>{can('POST', '/canvass/vans') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { cf.resetFields(); setCreating(true); }}>Mobil baru</Button>}</Space>
      <ResponsiveTable<Van> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} scroll={{ x: 640 }} locale={{ emptyText: 'Belum ada mobil kanvas' }}
        columns={[
          { title: 'Mobil', render: (_: unknown, v: Van) => <div>{v.name}<div style={{ fontSize: 12, color: '#64748b' }}>{v.code}</div></div> },
          { title: 'Sales', dataIndex: 'userName' },
          { title: 'Stok', align: 'right' as const, render: (_: unknown, v: Van) => `${fmtQty(v.qty)} (${v.skus} SKU)` },
          { title: 'Nilai (HPP)', align: 'right' as const, render: (_: unknown, v: Van) => fmtMoney(v.value) },
          { title: '', render: (_: unknown, v: Van) => can('POST', '/canvass/vans/:id/load') && <Space><Button size="small" onClick={() => { mf.resetFields(); mf.setFieldsValue({ lines: [{}] }); setMoving({ van: v, dir: 'load' }); }}>Muat</Button><Button size="small" onClick={() => { mf.resetFields(); mf.setFieldsValue({ lines: [{}] }); setMoving({ van: v, dir: 'unload' }); }}>Bongkar</Button></Space> },
        ]} />
      <Modal title="Mobil baru" open={creating} onCancel={() => setCreating(false)} onOk={() => cf.submit()} confirmLoading={create.isPending} okText="Buat" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="userId" label="Sales pemilik mobil" rules={[{ required: true }]}><Select options={(users ?? []).filter((u) => u.role === 'SALES' && u.isActive).map((u) => ({ value: u.id, label: u.name }))} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={moving ? `${moving.dir === 'load' ? 'Muat' : 'Bongkar'} ${moving.van.name}` : ''} open={!!moving} onCancel={() => setMoving(null)} onOk={() => mf.submit()} confirmLoading={move.isPending} okText="Pindahkan" destroyOnHidden width={620}>
        <Form form={mf} layout="vertical" onFinish={(v) => move.mutate(v)}>
          <Form.Item name="warehouseId" label={moving?.dir === 'load' ? 'Dari gudang' : 'Ke gudang'} rules={[{ required: true }]}><Select options={(warehouses ?? []).filter((w) => !w.kind || w.kind === 'MAIN').map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih produk' }]}><Select showSearch optionFilterProp="label" style={{ width: 340 }} placeholder="Produk" options={(products ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
                    <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Jumlah' }]}><InputNumber min={0.0001} placeholder="Jumlah" style={{ width: 120 }} /></Form.Item>
                    {fields.length > 1 && <Button type="text" danger onClick={() => remove(f.name)}>Hapus</Button>}
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add({})}>+ Tambah produk</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}

function RoutesTab({ isSales }: { isSales: boolean }) {
  const can = useCan();
  const { data: routes } = useQuery({ queryKey: ['canvass-routes'], queryFn: () => get<RouteRow[]>('/canvass/routes') });
  const { data: visits } = useQuery({ queryKey: ['canvass-visits'], queryFn: () => get<Visit[]>('/canvass/visits') });
  const { data: customers } = useCustomers();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => get<{ id: string; name: string; role: string; isActive: boolean }[]>('/users'), enabled: can('POST', '/canvass/routes') });
  const [editing, setEditing] = useState<RouteRow | 'new' | null>(null);
  const [rf] = Form.useForm<{ name: string; salespersonId: string; weekday?: number; customerIds: string[] }>();
  const [visiting, setVisiting] = useState(false);
  const [vf] = Form.useForm<{ customerId: string; result: Visit['result']; note?: string }>();
  const save = useAction((v: { name: string; salespersonId: string; weekday?: number; customerIds: string[] }) => (editing && editing !== 'new' ? put(`/canvass/routes/${editing.id}`, v) : post('/canvass/routes', v)), { success: 'Rute disimpan', invalidate: ['canvass-routes', 'canvass-summary'], onSuccess: () => setEditing(null) });
  const checkIn = useAction(
    async (v: { customerId: string; result: Visit['result']; note?: string }) => {
      const pos = await new Promise<GeolocationPosition | null>((res) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 8000 }) : res(null)));
      return post<{ farFromOutlet: boolean }>('/canvass/visits', { ...v, lat: pos?.coords.latitude, lng: pos?.coords.longitude });
    },
    { success: (r) => (r.farFromOutlet ? 'Kunjungan dicatat — lokasi jauh dari titik outlet (ditandai)' : 'Kunjungan dicatat'), invalidate: ['canvass-visits', 'canvass-summary'], onSuccess: () => setVisiting(false) },
  );
  return (
    <>
      <Space style={{ marginBottom: 8 }} wrap>
        {can('POST', '/canvass/routes') && <Button icon={<PlusOutlined />} onClick={() => { rf.resetFields(); setEditing('new'); }}>Rute baru</Button>}
        {isSales && <Button type="primary" icon={<EnvironmentOutlined />} onClick={() => { vf.resetFields(); setVisiting(true); }}>Check-in kunjungan</Button>}
      </Space>
      <ResponsiveTable<RouteRow> rowKey="id" size="small" dataSource={routes} pagination={false} scroll={{ x: 640 }} locale={{ emptyText: 'Belum ada rute' }}
        columns={[
          { title: 'Rute', render: (_: unknown, r: RouteRow) => <div>{r.name} {!r.isActive && <Tag>Nonaktif</Tag>}<div style={{ fontSize: 12, color: '#64748b' }}>{r.salesName} · {r.weekday ? DAYS[r.weekday] : 'tiap hari'}</div></div> },
          { title: 'Outlet (urutan)', render: (_: unknown, r: RouteRow) => r.stops.map((s) => s.name).join(' → ') || '-' },
          { title: '', render: (_: unknown, r: RouteRow) => can('PUT', '/canvass/routes/:id') && <Button size="small" onClick={() => { rf.setFieldsValue({ name: r.name, salespersonId: r.salespersonId, weekday: r.weekday ?? undefined, customerIds: r.stops.map((s) => s.customerId) }); setEditing(r); }}>Ubah</Button> },
        ]} />
      <Card title="Kunjungan hari ini" size="small" style={{ marginTop: 12 }}>
        <ResponsiveTable<Visit> rowKey="id" size="small" dataSource={visits} pagination={false} scroll={{ x: 600 }} locale={{ emptyText: 'Belum ada kunjungan' }}
          columns={[
            { title: 'Sales', dataIndex: 'salesName' },
            { title: 'Outlet', dataIndex: 'customerName' },
            { title: 'Hasil', render: (_: unknown, v: Visit) => RESULT[v.result] },
            { title: 'Jarak', render: (_: unknown, v: Visit) => (v.distanceM === null ? <span style={{ color: '#94a3b8' }}>tanpa koordinat</span> : <Tag color={v.farFromOutlet ? 'orange' : 'green'}>{v.distanceM} m</Tag>) },
            { title: 'Jam', render: (_: unknown, v: Visit) => new Date(v.checkedInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) },
          ]} />
      </Card>
      <Modal title={editing === 'new' ? 'Rute baru' : 'Ubah rute'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => rf.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden width={620}>
        <Form form={rf} layout="vertical" onFinish={(v) => save.mutate(v)} initialValues={{ customerIds: [] }}>
          <Form.Item name="name" label="Nama rute" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item name="salespersonId" label="Sales" rules={[{ required: true }]}><Select options={(users ?? []).filter((u) => u.role === 'SALES' && u.isActive).map((u) => ({ value: u.id, label: u.name }))} /></Form.Item>
          <Form.Item name="weekday" label="Hari (kosong = tiap hari)"><Select allowClear options={DAYS.slice(1).map((d, i) => ({ value: i + 1, label: d }))} /></Form.Item>
          <Form.Item name="customerIds" label="Outlet sesuai urutan kunjungan"><Select mode="multiple" showSearch optionFilterProp="label" options={(customers ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Check-in kunjungan" open={visiting} onCancel={() => setVisiting(false)} onOk={() => vf.submit()} confirmLoading={checkIn.isPending} okText="Catat" destroyOnHidden>
        <Form form={vf} layout="vertical" onFinish={(v) => checkIn.mutate(v)} initialValues={{ result: 'NO_ORDER' }}>
          <Form.Item name="customerId" label="Outlet" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="result" label="Hasil"><Select options={Object.entries(RESULT).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="note" label="Catatan"><Input /></Form.Item>
          <Typography.Text type="secondary">Lokasi perangkat dicatat (izinkan akses lokasi) dan dibandingkan dengan titik outlet.</Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
