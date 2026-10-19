import { ArrowDownOutlined, ArrowUpOutlined, CarOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Drawer, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate } from '@/lib/format';

type TripStatus = 'PLANNED' | 'ON_ROUTE' | 'COMPLETED' | 'CANCELLED';
interface Trip {
  id: string;
  number: string;
  date: string;
  vehicle: string | null;
  driverName: string | null;
  status: TripStatus;
  notes: string | null;
  cancelReason: string | null;
  stops: number;
  delivered: number;
  failed: number;
  pending: number;
}
interface Stop {
  id: string;
  sequence: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  receivedBy: string | null;
  failReason: string | null;
  note: string | null;
  deliveryNumber: string;
  customerName: string;
  address: string | null;
  phone: string | null;
  hasGeo: boolean;
}
interface TripDetail extends Omit<Trip, 'stops' | 'delivered' | 'failed' | 'pending'> {
  stops: Stop[];
}
interface Unscheduled {
  id: string;
  number: string;
  date: string;
  customerName: string;
  address: string | null;
}
interface Controls {
  unscheduledOlder: Unscheduled[];
  tripsNotCompleted: { id: string; number: string; date: string }[];
  failedNotRescheduled: { number: string; trip: string; reason: string | null }[];
}
const TRIP_STATUS: Record<TripStatus, { label: string; color: string }> = {
  PLANNED: { label: 'Direncanakan', color: 'blue' },
  ON_ROUTE: { label: 'Dalam perjalanan', color: 'gold' },
  COMPLETED: { label: 'Selesai', color: 'green' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};
const STOP_STATUS = { PENDING: { label: 'Menunggu', color: 'default' }, DELIVERED: { label: 'Terkirim', color: 'green' }, FAILED: { label: 'Gagal', color: 'red' } } as const;
const KEY = 'delivery-trips';

/** Rute pengiriman: satu kendaraan membawa beberapa surat jalan; bukti terima dicatat per stop */
export default function DeliveryTripsPage() {
  const can = useCan();
  const trips = useQuery({ queryKey: [KEY], queryFn: () => get<Trip[]>('/delivery-trips') });
  const unscheduled = useQuery({ queryKey: [KEY, 'unscheduled'], queryFn: () => get<Unscheduled[]>('/delivery-trips/unscheduled') });
  const controls = useQuery({ queryKey: [KEY, 'controls'], queryFn: () => get<Controls>('/delivery-trips/controls'), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: [KEY, 'detail', open], queryFn: () => get<TripDetail>(`/delivery-trips/${open}`), enabled: !!open });
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [form] = Form.useForm<{ date?: string; vehicle?: string; driverName?: string; notes?: string }>();
  const [result, setResult] = useState<{ stop: Stop; result: 'DELIVERED' | 'FAILED' } | null>(null);
  const [resForm] = Form.useForm<{ receivedBy?: string; failReason?: string; note?: string }>();
  const [cancelling, setCancelling] = useState(false);
  const [cancelForm] = Form.useForm<{ reason: string }>();

  const refresh = [KEY];
  const create = useAction((v: { date?: string; vehicle?: string; driverName?: string; notes?: string }) => post<{ id: string }>('/delivery-trips', { ...v, deliveryIds: picked }), {
    success: 'Rute dibuat',
    invalidate: refresh,
    onSuccess: (t) => {
      setCreating(false);
      setOpen((t as { id: string }).id);
    },
  });
  const act = (path: (id: string) => string, success: string) => useAction((id: string) => post(path(id)), { success, invalidate: refresh });
  const depart = act((id) => `/delivery-trips/${id}/depart`, 'Rute berangkat');
  const complete = act((id) => `/delivery-trips/${id}/complete`, 'Rute selesai');
  const optimize = act((id) => `/delivery-trips/${id}/optimize`, 'Stop diurutkan dari titik terdekat');
  const reorder = useAction((v: { id: string; stopIds: string[] }) => post(`/delivery-trips/${v.id}/reorder`, { stopIds: v.stopIds }), { invalidate: refresh });
  const removeStop = useAction((v: { id: string; stopId: string }) => post(`/delivery-trips/${v.id}/stops/${v.stopId}/remove`), { success: 'Stop dilepas', invalidate: refresh });
  const addStops = useAction((v: { id: string; ids: string[] }) => post(`/delivery-trips/${v.id}/stops`, { deliveryIds: v.ids }), { success: 'Stop ditambahkan', invalidate: refresh });
  const markStop = useAction((v: { id: string; stopId: string; body: object }) => post(`/delivery-trips/${v.id}/stops/${v.stopId}/result`, v.body), { success: 'Hasil dicatat', invalidate: refresh, onSuccess: () => setResult(null) });
  const cancel = useAction((v: { id: string; reason: string }) => post(`/delivery-trips/${v.id}/cancel`, { reason: v.reason }), { success: 'Rute dibatalkan', invalidate: refresh, onSuccess: () => { setCancelling(false); setOpen(null); } });

  const move = (stops: Stop[], i: number, dir: -1 | 1) => {
    const ids = stops.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate({ id: open!, stopIds: ids });
  };
  const d = detail.data;
  const planned = d?.status === 'PLANNED';
  const onRoute = d?.status === 'ON_ROUTE';
  const c = controls.data;
  const warnings = c ? c.unscheduledOlder.length + c.tripsNotCompleted.length + c.failedNotRescheduled.length : 0;

  return (
    <>
      <ListPage<Trip>
        title="Rute pengiriman"
        actions={can('POST', '/delivery-trips') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPicked([]); setCreating(true); }}>Rute baru</Button>}
        rows={trips.data}
        loading={trips.isLoading}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'ACTIVE', label: 'Berjalan', test: (t) => t.status === 'PLANNED' || t.status === 'ON_ROUTE' },
          { value: 'DONE', label: 'Selesai', test: (t) => t.status === 'COMPLETED' },
        ]}
        searchText={(t) => `${t.number} ${t.vehicle ?? ''} ${t.driverName ?? ''}`}
        searchPlaceholder="Cari nomor, kendaraan, atau pengemudi"
        emptyText="Belum ada rute pengiriman."
        onRowClick={(t) => setOpen(t.id)}
        below={
          <>
            {!!unscheduled.data?.length && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`${unscheduled.data.length} surat jalan belum masuk rute mana pun`} description="Buka 'Rute baru' untuk menjadwalkannya, atau tambahkan ke rute yang masih direncanakan." />}
            {warnings > 0 && c && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Perlu ditindaklanjuti"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {c.unscheduledOlder.length > 0 && <li>{c.unscheduledOlder.length} surat jalan dari hari sebelumnya belum dijadwalkan</li>}
                    {c.tripsNotCompleted.length > 0 && <li>Rute berangkat tetapi belum selesai: {c.tripsNotCompleted.map((t) => t.number).join(', ')}</li>}
                    {c.failedNotRescheduled.length > 0 && <li>Gagal kirim belum dijadwalkan ulang: {c.failedNotRescheduled.map((f) => `${f.number} (${f.reason ?? '-'})`).join(', ')}</li>}
                  </ul>
                }
              />
            )}
          </>
        }
        columns={[
          { title: 'Rute', dataIndex: 'number', render: (n: string, t: Trip) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(t.date)}</span></div> },
          { title: 'Kendaraan / pengemudi', render: (_: unknown, t: Trip) => <div>{t.vehicle ?? '-'}<div style={{ fontSize: 12, color: '#64748b' }}>{t.driverName ?? '-'}</div></div> },
          { title: 'Stop', render: (_: unknown, t: Trip) => <span>{t.delivered}/{t.stops} terkirim{t.failed > 0 && <Tag color="red" style={{ marginLeft: 6 }}>{t.failed} gagal</Tag>}</span> },
          { title: 'Status', render: (_: unknown, t: Trip) => <Tag color={TRIP_STATUS[t.status].color}>{TRIP_STATUS[t.status].label}</Tag> },
        ]}
      />

      <Modal title="Rute pengiriman baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Buat rute" destroyOnHidden width={640}>
        <Form form={form} name="trip-new" layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Space wrap>
            <Form.Item name="date" label="Tanggal"><Input type="date" /></Form.Item>
            <Form.Item name="vehicle" label="Kendaraan"><Input placeholder="B 1234 XY" maxLength={60} /></Form.Item>
            <Form.Item name="driverName" label="Pengemudi"><Input maxLength={100} /></Form.Item>
          </Space>
          <Form.Item name="notes" label="Catatan"><Input maxLength={300} /></Form.Item>
        </Form>
        <Typography.Text strong>Surat jalan yang dibawa (urutan dipilih = urutan stop)</Typography.Text>
        <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
          {(unscheduled.data ?? []).length === 0 && <Typography.Text type="secondary">Tidak ada surat jalan yang belum dijadwalkan.</Typography.Text>}
          {(unscheduled.data ?? []).map((u) => (
            <div key={u.id}>
              <Checkbox checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))}>
                {u.number} · {u.customerName} <span style={{ color: '#64748b', fontSize: 12 }}>{u.address ?? ''}</span>
              </Checkbox>
            </div>
          ))}
        </div>
      </Modal>

      <Drawer open={!!open} onClose={() => setOpen(null)} width={760} title={d ? `${d.number} · ${fmtDate(d.date)}` : 'Rute'} destroyOnHidden>
        {d && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={TRIP_STATUS[d.status].color}>{TRIP_STATUS[d.status].label}</Tag>
              <span><CarOutlined /> {d.vehicle ?? '-'} · {d.driverName ?? '-'}</span>
              {d.notes && <Typography.Text type="secondary">{d.notes}</Typography.Text>}
            </Space>
            {d.status === 'CANCELLED' && <Alert type="info" showIcon message={`Dibatalkan: ${d.cancelReason ?? '-'}`} />}
            <Space wrap>
              {planned && can('POST', '/delivery-trips/:id/optimize') && <Button loading={optimize.isPending} onClick={() => optimize.mutate(d.id)} disabled={d.stops.length < 2}>Urutkan dari titik terdekat</Button>}
              {planned && can('POST', '/delivery-trips/:id/depart') && <Button type="primary" loading={depart.isPending} onClick={() => depart.mutate(d.id)} disabled={!d.stops.length}>Berangkat</Button>}
              {onRoute && can('POST', '/delivery-trips/:id/complete') && <Button type="primary" loading={complete.isPending} onClick={() => complete.mutate(d.id)} disabled={d.stops.some((s) => s.status === 'PENDING')}>Selesaikan rute</Button>}
              {planned && can('POST', '/delivery-trips/:id/cancel') && <Button danger onClick={() => { setCancelling(true); }}>Batalkan rute</Button>}
            </Space>
            {planned && d.stops.length > 1 && !d.stops.some((s) => s.hasGeo) && <Alert type="info" showIcon message="Belum ada koordinat pelanggan di rute ini; isi lintang/bujur di data pelanggan agar bisa diurutkan otomatis." />}
            <Table<Stop>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={d.stops}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: '#', dataIndex: 'sequence', width: 44 },
                { title: 'Pelanggan', render: (_: unknown, s: Stop) => <div>{s.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{s.address ?? ''}{s.phone ? ` · ${s.phone}` : ''}</div></div> },
                { title: 'Surat jalan', dataIndex: 'deliveryNumber' },
                { title: 'Status', render: (_: unknown, s: Stop) => <div><Tag color={STOP_STATUS[s.status].color}>{STOP_STATUS[s.status].label}</Tag>{s.receivedBy && <div style={{ fontSize: 12 }}>Penerima: {s.receivedBy}</div>}{s.failReason && <div style={{ fontSize: 12 }}>{s.failReason}</div>}{s.note && <div style={{ fontSize: 12, color: '#64748b' }}>{s.note}</div>}</div> },
                {
                  title: '',
                  render: (_: unknown, s: Stop, i: number) =>
                    planned ? (
                      <Space>
                        <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0 || reorder.isPending} onClick={() => move(d.stops, i, -1)} aria-label="Naik" />
                        <Button size="small" icon={<ArrowDownOutlined />} disabled={i === d.stops.length - 1 || reorder.isPending} onClick={() => move(d.stops, i, 1)} aria-label="Turun" />
                        <Popconfirm title="Lepas stop ini dari rute?" onConfirm={() => removeStop.mutate({ id: d.id, stopId: s.id })}><Button size="small" danger>Lepas</Button></Popconfirm>
                      </Space>
                    ) : onRoute && s.status === 'PENDING' && can('POST', '/delivery-trips/:id/stops/:stopId/result') ? (
                      <Space>
                        <Button size="small" type="primary" onClick={() => { setResult({ stop: s, result: 'DELIVERED' }); }}>Terkirim</Button>
                        <Button size="small" danger onClick={() => { setResult({ stop: s, result: 'FAILED' }); }}>Gagal</Button>
                      </Space>
                    ) : null,
                },
              ]}
            />
            {planned && !!unscheduled.data?.length && (
              <>
                <Typography.Text strong>Tambah surat jalan</Typography.Text>
                <div style={{ maxHeight: 160, overflow: 'auto' }}>
                  {unscheduled.data.map((u) => (
                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                      <span>{u.number} · {u.customerName}</span>
                      <Button size="small" onClick={() => addStops.mutate({ id: d.id, ids: [u.id] })}>Tambah</Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Space>
        )}
      </Drawer>

      <Modal title={result?.result === 'DELIVERED' ? 'Catat terkirim (bukti terima)' : 'Catat gagal kirim'} open={!!result} onCancel={() => setResult(null)} onOk={() => resForm.submit()} confirmLoading={markStop.isPending} okText="Simpan" okButtonProps={{ danger: result?.result === 'FAILED' }} destroyOnHidden>
        <Form form={resForm} name="trip-result" layout="vertical" onFinish={(v) => markStop.mutate({ id: open!, stopId: result!.stop.id, body: { result: result!.result, ...v } })}>
          <Typography.Paragraph>{result?.stop.customerName} · {result?.stop.deliveryNumber}</Typography.Paragraph>
          {result?.result === 'DELIVERED' ? (
            <Form.Item name="receivedBy" label="Nama penerima" rules={[{ required: true, min: 2, message: 'Nama penerima wajib diisi' }]}><Input maxLength={120} /></Form.Item>
          ) : (
            <Form.Item name="failReason" label="Alasan gagal" rules={[{ required: true, min: 3, message: 'Alasan wajib diisi' }]}><Input maxLength={300} placeholder="mis. toko tutup, alamat tidak ditemukan" /></Form.Item>
          )}
          <Form.Item name="note" label="Catatan"><Input maxLength={300} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Batalkan rute" open={cancelling} onCancel={() => setCancelling(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} okText="Batalkan rute" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={cancelForm} name="trip-cancel" layout="vertical" onFinish={(v) => cancel.mutate({ id: open!, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 3 }]}><Input maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
