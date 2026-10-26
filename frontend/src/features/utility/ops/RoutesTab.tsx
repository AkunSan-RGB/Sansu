import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, Modal, Progress, Select, Space, Switch, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { StaffSelect } from './kit';

interface Route { id: string; code: string; name: string; reader_id: string | null; reader_name: string | null; collector_id: string | null; collector_name: string | null; zone: string | null; is_active: boolean; connections: number; metered: number; read: number; arrears: number; pct: number }
interface Stop { id: string; number: string; meter_no: string | null; address: string; customer: string; route_seq: number | null; status: string | null; usage: string | null; metered: boolean }
interface Free { id: string; number: string; address: string; customer: string; zone: string | null }
const period = () => dayjs().format('YYYY-MM');

/** Rute baca dan penagihan: membagi sambungan ke petugas baca meter dan kolektor, dengan progres pencatatan bulan ini */
export function RoutesTab() {
  const can = useCan();
  const q = useQuery({ queryKey: ['utility', 'routes'], queryFn: () => get<{ period: string; routes: Route[] }>(`/utility/routes?period=${period()}`) });
  const [edit, setEdit] = useState<Route | 'new' | null>(null);
  const [view, setView] = useState<Route | null>(null);
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => (edit && edit !== 'new' ? put(`/utility/routes/${edit.id}`, v) : post('/utility/routes', v)), { success: 'Rute disimpan', invalidate: ['utility'], onSuccess: () => setEdit(null) });
  const manage = can('POST', '/utility/routes');
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Rute membagi pekerjaan lapangan" description="Satu rute = sekelompok sambungan yang dibaca satu petugas dan ditagih satu kolektor. Petugas lapangan hanya melihat rute miliknya di menu Petugas lapangan dan Penagihan lapangan." />
      {manage && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { f.resetFields(); f.setFieldsValue({ isActive: true }); setEdit('new'); }}>Buat rute</Button>}
      <ResponsiveTable<Route> rowKey="id" size="small" loading={q.isLoading} dataSource={q.data?.routes} pagination={false}
        columns={[
          { title: 'Kode', dataIndex: 'code' }, { title: 'Nama rute', render: (_: unknown, r: Route) => <>{r.name}{r.zone && <div style={{ fontSize: 12, color: '#64748b' }}>{r.zone}</div>}</> },
          { title: 'Pembaca meter', render: (_: unknown, r: Route) => r.reader_name ?? '-' }, { title: 'Kolektor', render: (_: unknown, r: Route) => r.collector_name ?? '-' },
          { title: 'Sambungan', dataIndex: 'connections', align: 'right' as const },
          { title: `Meter terbaca ${q.data?.period ?? ''}`, render: (_: unknown, r: Route) => (r.metered ? <Progress size="small" percent={r.pct} format={() => `${r.read}/${r.metered}`} status={r.pct >= 100 ? 'success' : 'active'} /> : '-') },
          { title: 'Menunggak', align: 'right' as const, render: (_: unknown, r: Route) => (r.arrears ? <Tag color="orange">{r.arrears}</Tag> : 0) },
          { render: (_: unknown, r: Route) => <Space><Button size="small" onClick={() => setView(r)}>Isi rute</Button>{manage && <Button size="small" onClick={() => { f.setFieldsValue({ code: r.code, name: r.name, readerId: r.reader_id ?? undefined, collectorId: r.collector_id ?? undefined, zone: r.zone ?? undefined, isActive: r.is_active }); setEdit(r); }}>Ubah</Button>}</Space> },
        ]} />
      <Modal open={!!edit} title={edit === 'new' ? 'Buat rute' : 'Ubah rute'} okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={() => setEdit(null)} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
        <Form form={f} layout="vertical">
          <Space align="start"><Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input placeholder="R-01" style={{ width: 120 }} /></Form.Item><Form.Item name="name" label="Nama rute" rules={[{ required: true, min: 3 }]}><Input style={{ width: 280 }} /></Form.Item></Space>
          <Form.Item name="readerId" label="Petugas pembaca meter"><StaffSelect allowClear /></Form.Item>
          <Form.Item name="collectorId" label="Kolektor penagihan"><StaffSelect allowClear /></Form.Item>
          <Form.Item name="zone" label="Zona"><Input /></Form.Item>
          {edit !== 'new' && <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>
      <RouteDrawer route={view} onClose={() => setView(null)} manage={manage} />
    </>
  );
}

function RouteDrawer({ route, onClose, manage }: { route: Route | null; onClose: () => void; manage: boolean }) {
  const stops = useQuery({ queryKey: ['utility', 'routes', 'stops', route?.id], queryFn: () => get<{ stops: Stop[] }>(`/utility/routes/${route!.id}/stops?period=${period()}`), enabled: !!route });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const free = useQuery({ queryKey: ['utility', 'routes', 'free', search], queryFn: () => get<Free[]>(`/utility/routes/unassigned?q=${encodeURIComponent(search)}`), enabled: !!route && manage });
  const assign = useAction((v: { routeId?: string; connectionIds: string[] }) => post('/utility/routes/assign', v), { success: 'Rute diperbarui', invalidate: ['utility'], onSuccess: () => setPicked([]) });
  return (
    <Drawer open={!!route} onClose={onClose} width={620} title={route ? `${route.code} · ${route.name}` : 'Rute'}>
      <Table size="small" rowKey="id" loading={stops.isLoading} pagination={false} dataSource={stops.data?.stops} columns={[
        { title: '#', dataIndex: 'route_seq', width: 40 }, { title: 'Sambungan', render: (_: unknown, s: Stop) => <>{s.number}<div style={{ fontSize: 12, color: '#64748b' }}>{s.customer}</div></> }, { title: 'Alamat', dataIndex: 'address' },
        { title: `Meter ${period()}`, render: (_: unknown, s: Stop) => (!s.metered ? <Tag>Tarif flat</Tag> : s.status ? <Tag color="green">{s.usage} m³</Tag> : <Tag color="orange">Belum dibaca</Tag>) },
        { render: (_: unknown, s: Stop) => manage ? <Button size="small" danger type="link" onClick={() => assign.mutate({ connectionIds: [s.id] })}>Keluarkan</Button> : null },
      ]} />
      {manage && route && (
        <div style={{ marginTop: 20 }}>
          <b>Tambah sambungan yang belum punya rute</b>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Select mode="multiple" style={{ width: '100%' }} showSearch filterOption={false} onSearch={setSearch} value={picked} onChange={setPicked} placeholder="Cari nomor, nama, atau alamat" loading={free.isLoading}
              options={(free.data ?? []).map((c) => ({ value: c.id, label: `${c.number} — ${c.customer} — ${c.address}` }))} />
            <Button type="primary" disabled={!picked.length} loading={assign.isPending} onClick={() => assign.mutate({ routeId: route.id, connectionIds: picked })}>Masukkan</Button>
          </Space.Compact>
        </div>
      )}
    </Drawer>
  );
}
