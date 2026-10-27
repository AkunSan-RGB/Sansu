import { READING_FLAG_LABELS, UTILITY_READING_LABELS, type ReadingFlag } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { READ_COLOR, Reading, thisMonth } from './shared';
import { usePaged } from '@/lib/usePaged';

const SOURCE_LABEL: Record<string, string> = { LAPANGAN: 'Lapangan', IMPORT: 'Impor', API: 'Alat meter' };

interface Due { id: string; number: string; meterNo: string | null; address: string; customerName: string; unit: string; previous: string }

// ---------- Catat meter ----------
function FlagTags({ flags }: { flags: ReadingFlag[] }) {
  return <>{flags.map((f) => <Tag key={f} color={f === 'METER_DIGANTI' ? 'blue' : 'orange'}>{READING_FLAG_LABELS[f]}</Tag>)}</>;
}

export function ReadingsTab() {
  const can = useCan();
  const [period, setPeriod] = useState(thisMonth());
  const due = usePaged<Due>(['utility', 'due-page'], '/utility/readings/due', { period }, { enabled: can('POST', '/utility/readings'), pageSize: 25 });
  const list = useQuery({ queryKey: ['utility', 'readings', period], queryFn: () => get<Reading[]>(`/utility/readings?period=${period}`) });
  const [photoOf, setPhotoOf] = useState<string | null>(null);
  const photo = useQuery({ queryKey: ['utility', 'photo', photoOf], queryFn: () => get<{ photo: string | null }>(`/utility/readings/${photoOf}/photo`), enabled: !!photoOf });
  const [entering, setEntering] = useState<Due | null>(null);
  const [estimating, setEstimating] = useState<Due | null>(null);
  const [noteEst, setNoteEst] = useState('');
  const [deciding, setDeciding] = useState<{ r: Reading; mode: 'verify' | 'reject' } | null>(null);
  const [ef] = Form.useForm();
  const [df] = Form.useForm<{ note?: string; reason?: string }>();
  const replaced = Form.useWatch('meterReplaced', ef);
  const enter = useAction((v: { connectionId: string; current: number; meterReplaced?: boolean; oldMeterFinal?: number; newMeterStart?: number; note?: string }) => post<Reading>('/utility/readings', { ...v, period, current: String(v.current), oldMeterFinal: v.oldMeterFinal == null ? undefined : String(v.oldMeterFinal), newMeterStart: v.newMeterStart == null ? undefined : String(v.newMeterStart) }), { success: 'Angka meter dicatat — menunggu verifikasi', invalidate: ['utility'], onSuccess: () => setEntering(null) });
  const estimate = useAction(() => post('/utility/readings/estimate', { connectionId: estimating!.id, period, note: noteEst.trim() || undefined }), { success: 'Pemakaian ditaksir dari rata-rata — otomatis dikoreksi pada pencatatan meter berikutnya', invalidate: ['utility'], onSuccess: () => { setEstimating(null); setNoteEst(''); } });
  const decide = useAction((v: { id: string; mode: 'verify' | 'reject'; note?: string; reason?: string }) => post(`/utility/readings/${v.id}/${v.mode}`, v.mode === 'verify' ? { note: v.note } : { reason: v.reason }), { success: 'Tersimpan', invalidate: ['utility'], onSuccess: () => setDeciding(null) });
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Periode</span>
        <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
      </Space>
      {can('POST', '/utility/readings') && (
        <>
          <Typography.Title level={5}>Belum dicatat ({due.total.toLocaleString('id-ID')})</Typography.Title>
          <ResponsiveTable<Due> rowKey="id" size="small" loading={due.isLoading} dataSource={due.rows} pagination={due.pagination} locale={{ emptyText: 'Semua sambungan sudah dicatat untuk periode ini' }}
            columns={[
              { title: 'Sambungan', dataIndex: 'number' },
              { title: 'Pelanggan', dataIndex: 'customerName' },
              { title: 'Alamat', dataIndex: 'address', ellipsis: true },
              { title: 'Meter', dataIndex: 'meterNo' },
              { title: 'Angka sebelumnya', render: (_: unknown, d: Due) => `${Number(d.previous)} ${d.unit}` },
              { render: (_: unknown, d: Due) => <Space><Button size="small" type="primary" onClick={() => { ef.resetFields(); setEntering(d); }}>Catat</Button>{can('POST', '/utility/readings/estimate') && <Button size="small" onClick={() => setEstimating(d)}>Taksir</Button>}</Space> },
            ]}
          />
        </>
      )}
      <Typography.Title level={5} style={{ marginTop: 20 }}>Pencatatan periode {period}</Typography.Title>
      <ResponsiveTable<Reading> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada pencatatan' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, r: Reading) => `${r.connectionNumber} · ${r.customerName}` },
          { title: 'Awal → akhir', render: (_: unknown, r: Reading) => `${Number(r.previous)} → ${Number(r.current)}` },
          { title: 'Pemakaian', render: (_: unknown, r: Reading) => <span><b>{Number(r.usage)}</b> {r.unit} <FlagTags flags={r.flags} />{r.source && r.source !== 'MANUAL' && <Tag>{SOURCE_LABEL[r.source] ?? r.source}</Tag>}{r.hasPhoto && <Button size="small" type="link" onClick={() => setPhotoOf(r.id)}>Foto</Button>}</span> },
          { title: 'Status', render: (_: unknown, r: Reading) => <Tag color={READ_COLOR[r.status]}>{UTILITY_READING_LABELS[r.status]}</Tag> },
          { title: 'Dicatat → diperiksa', render: (_: unknown, r: Reading) => `${r.enteredByName ?? '-'}${r.verifiedByName ? ` → ${r.verifiedByName}` : ''}` },
          {
            render: (_: unknown, r: Reading) =>
              r.status === 'ENTERED' ? (
                <Space wrap>
                  {can('POST', '/utility/readings/:id/verify') && <Button size="small" type="primary" onClick={() => { df.resetFields(); setDeciding({ r, mode: 'verify' }); }}>Verifikasi</Button>}
                  {can('POST', '/utility/readings/:id/reject') && <Button size="small" danger onClick={() => { df.resetFields(); setDeciding({ r, mode: 'reject' }); }}>Tolak</Button>}
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal title={estimating ? `Taksir pemakaian — ${estimating.number}` : ''} open={!!estimating} onCancel={() => setEstimating(null)} onOk={() => estimate.mutate(undefined)} confirmLoading={estimate.isPending} okText="Taksir" destroyOnHidden>
        <Typography.Paragraph>Untuk meter yang tidak bisa dibaca (tertutup, pagar terkunci). Pemakaian dihitung dari rata-rata sampai 3 periode nyata terakhir. Pada pencatatan meter berikutnya selisihnya dikoreksi otomatis. Maksimal 2 periode berturut-turut.</Typography.Paragraph>
        <Input placeholder="Alasan meter tidak terbaca" value={noteEst} onChange={(e) => setNoteEst(e.target.value)} maxLength={255} />
      </Modal>
      <Modal title="Foto meter" open={!!photoOf} onCancel={() => setPhotoOf(null)} footer={null} destroyOnHidden>
        {photo.data?.photo ? <img src={photo.data.photo} alt="Foto meter" style={{ maxWidth: '100%' }} /> : <Typography.Text type="secondary">{photo.isLoading ? 'Memuat…' : 'Tidak ada foto'}</Typography.Text>}
      </Modal>
      <Modal title={entering ? `Catat meter — ${entering.number}` : ''} open={!!entering} onCancel={() => setEntering(null)} onOk={() => ef.submit()} confirmLoading={enter.isPending} okText="Simpan" destroyOnHidden>
        {entering && <Typography.Paragraph type="secondary">{entering.customerName} · {entering.address}<br />Angka sebelumnya: <b>{Number(entering.previous)} {entering.unit}</b></Typography.Paragraph>}
        <Form form={ef} layout="vertical" onFinish={(v) => enter.mutate({ ...v, connectionId: entering!.id })}>
          <Form.Item name="current" label={replaced ? 'Angka meter BARU sekarang' : 'Angka meter sekarang'} rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="meterReplaced" valuePropName="checked"><Checkbox>Meter diganti pada periode ini</Checkbox></Form.Item>
          {replaced && (
            <>
              <Form.Item name="oldMeterFinal" label="Angka akhir meter LAMA" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
              <Form.Item name="newMeterStart" label="Angka awal meter BARU" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
            </>
          )}
          <Form.Item name="note" label="Catatan" rules={replaced ? [{ required: true, message: 'Tulis nomor meter baru dan alasan' }] : []}><Input.TextArea rows={2} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={deciding?.mode === 'verify' ? 'Verifikasi pencatatan' : 'Tolak pencatatan'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Simpan" okButtonProps={{ danger: deciding?.mode === 'reject' }} destroyOnHidden>
        {deciding && <Typography.Paragraph>{deciding.r.connectionNumber} · {deciding.r.customerName}: <b>{Number(deciding.r.usage)} {deciding.r.unit}</b> <FlagTags flags={deciding.r.flags} /></Typography.Paragraph>}
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate({ id: deciding!.r.id, mode: deciding!.mode, ...v })}>
          {deciding?.mode === 'verify' ? (
            <Form.Item name="note" label={deciding.r.flags.length ? 'Catatan pemeriksaan (wajib — angka ditandai janggal)' : 'Catatan (opsional)'} rules={deciding.r.flags.length ? [{ required: true, min: 5, message: 'Minimal 5 huruf' }] : []}><Input.TextArea rows={2} maxLength={255} placeholder="mis. sudah dicek ulang di lapangan / cocok dengan foto meter" /></Form.Item>
          ) : (
            <Form.Item name="reason" label="Alasan penolakan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={2} maxLength={255} /></Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
