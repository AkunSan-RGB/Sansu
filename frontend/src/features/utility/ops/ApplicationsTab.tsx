import { APPLICATION_FLOW, APPLICATION_STATUS_LABELS, type ApplicationStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Descriptions, Drawer, Form, Input, InputNumber, Modal, Radio, Select, Space, Steps, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Tariff } from '../utility/shared';
import { ReasonModal, StaffSelect, Stats } from './kit';

interface App {
  id: string; number: string; applicant_name: string; phone: string | null; id_number: string | null; address: string; tariff_id: string | null; tariff_name: string | null; customer_id: string | null; requested_on: string; status: ApplicationStatus;
  survey_note: string | null; pipe_length: string | null; feasible: boolean | null; invoice_number: string | null; invoice_total: string | null; invoice_open: string | null; paid: boolean; installer_name: string | null; meter_serial: string | null;
  connection_number: string | null; connection_id: string | null; closed_reason: string | null; install_note: string | null;
}
const COLOR: Record<ApplicationStatus, string> = { PERMOHONAN: 'gold', SURVEI: 'blue', MENUNGGU_BAYAR: 'orange', DIBAYAR: 'cyan', PEMASANGAN: 'purple', AKTIF: 'green', DITOLAK: 'red', BATAL: 'default' };
/** Status yang ditampilkan: tagihan lunas = siap dipasang, walau status tersimpan masih menunggu bayar */
const shown = (a: App): ApplicationStatus => (a.status === 'MENUNGGU_BAYAR' && a.paid ? 'DIBAYAR' : a.status);

/** Permohonan sambungan baru: permohonan → survei → tagihan biaya sambung → dibayar di loket → pemasangan → aktif (menjadi sambungan sungguhan) */
export function ApplicationsTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['utility', 'applications', status], queryFn: () => get<App[]>(`/utility/applications${status ? `?status=${status}` : ''}`) });
  const counts = useQuery({ queryKey: ['utility', 'applications', 'counts'], queryFn: () => get<Record<string, number>>('/utility/applications/counts') });
  const c = counts.data ?? {};
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Alur sambungan baru" description="Pelayanan mencatat permohonan → petugas lapangan survei → pelayanan menerbitkan tagihan biaya sambung → pemohon membayar di loket → petugas memasang meter → Keuangan/Admin mengaktifkan (bukan petugas pemasangnya). Setelah aktif, sambungan masuk daftar pelanggan." />
      <Stats items={[
        { title: 'Menunggu survei', value: c.PERMOHONAN ?? 0, warn: (c.PERMOHONAN ?? 0) > 0, onClick: () => setStatus('PERMOHONAN') },
        { title: 'Layak, belum ditagih', value: c.SURVEI ?? 0, onClick: () => setStatus('SURVEI') },
        { title: 'Menunggu bayar / pasang', value: c.MENUNGGU_BAYAR ?? 0, onClick: () => setStatus('MENUNGGU_BAYAR') },
        { title: 'Siap diaktifkan', value: c.PEMASANGAN ?? 0, onClick: () => setStatus('PEMASANGAN') },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...APPLICATION_FLOW.concat(['DITOLAK']).filter((s) => s !== 'DIBAYAR').map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] }))]} />
        {can('POST', '/utility/applications') && <Button type="primary" onClick={() => setCreating(true)}>Catat permohonan</Button>}
      </Space>
      <ResponsiveTable<App> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} onRow={(a) => ({ onClick: () => setOpenId(a.id), style: { cursor: 'pointer' } })} onMobileClick={(a) => setOpenId(a.id)}
        columns={[
          { title: 'Nomor', dataIndex: 'number' }, { title: 'Pemohon', dataIndex: 'applicant_name' }, { title: 'Alamat', dataIndex: 'address' },
          { title: 'Golongan', render: (_: unknown, a: App) => a.tariff_name ?? '-' },
          { title: 'Tanggal', render: (_: unknown, a: App) => fmtDate(a.requested_on) },
          { title: 'Tahap', render: (_: unknown, a: App) => <Tag color={COLOR[shown(a)]}>{shown(a) === 'DIBAYAR' ? 'Dibayar — siap dipasang' : APPLICATION_STATUS_LABELS[shown(a)]}</Tag> },
        ]} />
      <CreateApplication open={creating} onClose={() => setCreating(false)} />
      <AppDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function CreateApplication({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const tariffs = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const save = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/applications', v), { success: (r) => `Permohonan ${r.number} dicatat`, invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Catat permohonan sambungan baru" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical">
        <Form.Item name="applicantName" label="Nama pemohon" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
        <Space align="start"><Form.Item name="phone" label="Telepon"><Input /></Form.Item><Form.Item name="idNumber" label="No. KTP"><Input style={{ width: 230 }} /></Form.Item></Space>
        <Form.Item name="address" label="Alamat pemasangan" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="tariffId" label="Golongan yang diinginkan" extra="Dapat diubah saat survei"><Select allowClear options={(tariffs.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} /></Form.Item>
      </Form>
    </Modal>
  );
}

function AppDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['utility', 'applications', 'one', id], queryFn: () => get<App>(`/utility/applications/${id}`), enabled: !!id });
  const a = q.data;
  const [mode, setMode] = useState<null | 'survey' | 'quote' | 'install' | 'activate' | 'close'>(null);
  const [f] = Form.useForm();
  const tariffs = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const charges = useQuery({ queryKey: ['utility', 'charges'], queryFn: () => get<{ id: string; name: string; defaultPrice: string; revenueKey: string; isActive: boolean }[]>('/utility/charges') });
  const run = useAction((v: { path: string; body: object }) => post(`/utility/applications/${id}/${v.path}`, v.body), { success: 'Tersimpan', invalidate: ['utility'], onSuccess: () => { f.resetFields(); setMode(null); } });
  const submit = (path: string, map?: (v: Record<string, unknown>) => object) => f.validateFields().then((v) => run.mutate({ path, body: map ? map(v) : v }));
  const flowIdx = a ? APPLICATION_FLOW.indexOf(shown(a)) : 0;
  const st = a ? shown(a) : 'PERMOHONAN';
  return (
    <Drawer open={!!id} onClose={onClose} width={560} title={a ? `${a.number} · ${a.applicant_name}` : 'Permohonan'} loading={q.isLoading}>
      {a && (
        <>
          {['DITOLAK', 'BATAL'].includes(a.status) ? <Alert type="error" showIcon message={APPLICATION_STATUS_LABELS[a.status]} description={a.closed_reason ?? a.survey_note ?? undefined} style={{ marginBottom: 12 }} /> : <Steps size="small" current={flowIdx} responsive={false} style={{ marginBottom: 16 }} items={APPLICATION_FLOW.map((s) => ({ title: APPLICATION_STATUS_LABELS[s].replace('Menunggu bayar', 'Tagihan').replace('Dibayar', 'Lunas').replace('Pemasangan', 'Pasang') }))} />}
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Pemohon">{a.applicant_name}{a.phone ? ` · ${a.phone}` : ''}{a.id_number ? ` · KTP ${a.id_number}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Alamat">{a.address}</Descriptions.Item>
            <Descriptions.Item label="Golongan">{a.tariff_name ?? '-'}</Descriptions.Item>
            {a.feasible != null && <Descriptions.Item label="Hasil survei">{a.feasible ? 'Layak' : 'Tidak layak'}{a.pipe_length ? ` · pipa ${a.pipe_length} m` : ''}<div>{a.survey_note}</div></Descriptions.Item>}
            {a.invoice_number && <Descriptions.Item label="Tagihan biaya sambung">{a.invoice_number} · {fmtMoney(a.invoice_total)} · {a.paid ? <Tag color="green">Lunas</Tag> : <Tag color="orange">Sisa {fmtMoney(a.invoice_open)}</Tag>}</Descriptions.Item>}
            {a.installer_name && <Descriptions.Item label="Pemasangan">{a.installer_name} · meter {a.meter_serial}</Descriptions.Item>}
            {a.connection_number && <Descriptions.Item label="Sambungan">{a.connection_number}</Descriptions.Item>}
          </Descriptions>
          <Space wrap style={{ margin: '12px 0' }}>
            {a.status === 'PERMOHONAN' && can('POST', '/utility/applications/:id/survey') && <Button type="primary" onClick={() => { f.setFieldsValue({ feasible: true, tariffId: a.tariff_id ?? undefined }); setMode('survey'); }}>Isi hasil survei</Button>}
            {a.status === 'SURVEI' && can('POST', '/utility/applications/:id/quote') && <Button type="primary" onClick={() => { f.resetFields(); setMode('quote'); }}>Terbitkan tagihan biaya sambung</Button>}
            {a.status === 'MENUNGGU_BAYAR' && !a.paid && <Button onClick={() => navigate('/utility/loket')}>Bayar di loket</Button>}
            {a.status === 'MENUNGGU_BAYAR' && a.paid && can('POST', '/utility/applications/:id/install') && <Button type="primary" onClick={() => { f.resetFields(); setMode('install'); }}>Jadwalkan pemasangan</Button>}
            {a.status === 'PEMASANGAN' && can('POST', '/utility/applications/:id/activate') && <Button type="primary" onClick={() => { f.setFieldsValue({ initialReading: 0 }); setMode('activate'); }}>Aktifkan sambungan</Button>}
            {!['AKTIF', 'DITOLAK', 'BATAL'].includes(a.status) && can('POST', '/utility/applications/:id/close') && <Button danger onClick={() => setMode('close')}>Tutup permohonan</Button>}
          </Space>
          {st === 'AKTIF' && <Alert type="success" showIcon message="Sambungan sudah aktif dan tampil di daftar pelanggan" />}
        </>
      )}
      <Modal open={mode === 'survey'} title="Hasil survei" okText="Simpan" cancelText="Batal" confirmLoading={run.isPending} destroyOnHidden onCancel={() => setMode(null)} onOk={() => submit('survey', (v) => ({ ...v, pipeLength: v.pipeLength != null ? String(v.pipeLength) : undefined }))}>
        <Form form={f} layout="vertical">
          <Form.Item name="feasible" valuePropName="checked"><Checkbox>Lokasi layak dipasang</Checkbox></Form.Item>
          <Form.Item name="tariffId" label="Golongan tarif"><Select allowClear options={(tariffs.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} /></Form.Item>
          <Form.Item name="pipeLength" label="Panjang pipa dibutuhkan (m)"><InputNumber min={0} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="note" label="Catatan survei" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={mode === 'quote'} title="Tagihan biaya sambung" okText="Terbitkan" cancelText="Batal" confirmLoading={run.isPending} destroyOnHidden onCancel={() => setMode(null)} onOk={() => submit('quote', (v) => ({ chargeId: v.chargeId, price: v.price != null ? String(v.price) : undefined }))}>
        <Form form={f} layout="vertical">
          <Form.Item name="chargeId" label="Jenis layanan" extra="Kosong = layanan Sambung baru bawaan"><Select allowClear options={(charges.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.name} — ${fmtMoney(c.defaultPrice)}` }))} /></Form.Item>
          <Form.Item name="price" label="Harga (kosong = harga bawaan)"><InputNumber min={0} style={{ width: 200 }} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={mode === 'install'} title="Jadwalkan pemasangan" okText="Simpan" cancelText="Batal" confirmLoading={run.isPending} destroyOnHidden onCancel={() => setMode(null)} onOk={() => submit('install')}>
        <Form form={f} layout="vertical">
          <Form.Item name="installerId" label="Petugas pemasang" rules={[{ required: true }]}><StaffSelect /></Form.Item>
          <Form.Item name="meterSerial" label="Nomor seri meter" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="note" label="Catatan"><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal open={mode === 'activate'} title="Aktifkan sambungan" okText="Aktifkan" cancelText="Batal" confirmLoading={run.isPending} destroyOnHidden onCancel={() => setMode(null)} onOk={() => submit('activate', (v) => ({ ...v, initialReading: String(v.initialReading ?? 0) }))}>
        <Form form={f} layout="vertical">
          <Form.Item name="initialReading" label="Angka awal meter"><InputNumber min={0} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="zone" label="Zona"><Input /></Form.Item>
        </Form>
      </Modal>
      <ReasonModal open={mode === 'close'} title="Tutup permohonan" label="Alasan" danger okText="Tutup permohonan" loading={run.isPending} onCancel={() => setMode(null)} onSubmit={(t) => run.mutate({ path: 'close', body: { reason: t } })} />
    </Drawer>
  );
}
