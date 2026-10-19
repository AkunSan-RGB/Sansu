import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { ApiError, get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtMoney } from '@/lib/format';

export interface WorkCenter { id: string; code: string; name: string; kind: string; laborRate: string; overheadRate: string; capacityHours: string; isActive: boolean }
export const useWorkCenters = () => useQuery({ queryKey: ['work-centers'], queryFn: () => get<WorkCenter[]>('/production/work-centers'), staleTime: 30_000 });

/* -------------------------------------------------------------- operasi pada resep */
interface BomOp { id: string; sequence: number; name: string; workCenterId: string; workCenterCode: string; minutesPerBatch: string }

export function BomOperationsEditor({ bomId }: { bomId: string }) {
  const can = useCan();
  const wcs = useWorkCenters();
  const ops = useQuery({ queryKey: ['bom-ops', bomId], queryFn: () => get<BomOp[]>(`/production/boms/${bomId}/operations`) });
  const [f] = Form.useForm<{ operations: { name: string; workCenterId: string; minutesPerBatch: number }[] }>();
  const [editing, setEditing] = useState(false);
  const save = useAction((v: { operations: { name: string; workCenterId: string; minutesPerBatch: number }[] }) => put(`/production/boms/${bomId}/operations`, { operations: v.operations ?? [] }), { invalidate: ['bom-ops'], success: 'Operasi disimpan', onSuccess: () => setEditing(false) });
  return (
    <div style={{ marginTop: 16 }}>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>Operasi (pusat kerja)</Typography.Title>
        {can('PUT', '/production/boms/:id/operations') && !editing && <Button size="small" onClick={() => { f.setFieldsValue({ operations: (ops.data ?? []).map((o) => ({ name: o.name, workCenterId: o.workCenterId, minutesPerBatch: Number(o.minutesPerBatch) })) }); setEditing(true); }}>Ubah</Button>}
      </Space>
      {!editing ? (
        <Table<BomOp> size="small" rowKey="id" pagination={false} dataSource={ops.data} locale={{ emptyText: 'Belum ada operasi — biaya upah & overhead memakai standar resep' }}
          columns={[{ title: '#', dataIndex: 'sequence', width: 40 }, { title: 'Operasi', dataIndex: 'name' }, { title: 'Pusat kerja', render: (_: unknown, o: BomOp) => o.workCenterCode }, { title: 'Menit / batch', render: (_: unknown, o: BomOp) => Number(o.minutesPerBatch) }]} />
      ) : (
        <Form form={f} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.List name="operations">
            {(fields, { add, remove }) => (
              <>
                {fields.map((fl, i) => (
                  <Space key={fl.key} align="baseline" wrap>
                    <span>{i + 1}.</span>
                    <Form.Item name={[fl.name, 'name']} rules={[{ required: true, min: 2 }]}><Input placeholder="Nama operasi" style={{ width: 200 }} /></Form.Item>
                    <Form.Item name={[fl.name, 'workCenterId']} rules={[{ required: true }]}><Select placeholder="Pusat kerja" style={{ width: 200 }} options={(wcs.data ?? []).filter((w) => w.isActive).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Form.Item>
                    <Form.Item name={[fl.name, 'minutesPerBatch']} rules={[{ required: true }]}><InputNumber min={1} placeholder="Menit/batch" style={{ width: 120 }} /></Form.Item>
                    <Button danger size="small" onClick={() => remove(fl.name)}>Hapus</Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add()}>Tambah operasi</Button>
              </>
            )}
          </Form.List>
          <Space style={{ marginTop: 12 }}><Button type="primary" htmlType="submit" loading={save.isPending}>Simpan</Button><Button onClick={() => setEditing(false)}>Batal</Button></Space>
          <Alert style={{ marginTop: 8 }} type="info" showIcon message="Bila resep punya operasi, biaya upah dan overhead perintah produksi dihitung dari jam aktual × tarif pusat kerja (tidak diketik)." />
        </Form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- operasi pada perintah produksi */
interface OrderOp { id: string; sequence: number; name: string; workCenterId: string; workCenterCode: string; plannedMinutes: string; actualMinutes: string | null; status: 'PENDING' | 'RUNNING' | 'DONE' | 'CANCELLED'; scheduledStart: string | null; scheduledEnd: string | null; laborCost: string; overheadCost: string; note: string | null }
const OP: Record<OrderOp['status'], { label: string; color: string }> = { PENDING: { label: 'Menunggu', color: 'default' }, RUNNING: { label: 'Berjalan', color: 'processing' }, DONE: { label: 'Selesai', color: 'green' }, CANCELLED: { label: 'Batal', color: 'default' } };

export function OrderOperations({ orderId }: { orderId: string }) {
  const can = useCan();
  const ops = useQuery({ queryKey: ['order-ops', orderId], queryFn: () => get<OrderOp[]>(`/production/orders/${orderId}/operations`), refetchInterval: 30_000 });
  const [sched, setSched] = useState<OrderOp | null>(null);
  const [fin, setFin] = useState<OrderOp | null>(null);
  const [corr, setCorr] = useState<OrderOp | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [sf] = Form.useForm<{ range: [dayjs.Dayjs, dayjs.Dayjs]; offShiftReason?: string }>();
  const [offShift, setOffShift] = useState(false);
  const canOverride = useCan()('POST', '/production/operations/:id/correct');
  const [ff] = Form.useForm<{ actualMinutes?: number; note?: string }>();
  const [cf] = Form.useForm<{ actualMinutes: number; reason: string }>();
  const KEYS = ['order-ops', 'production'];
  const schedule = useAction(async (v: { range: [dayjs.Dayjs, dayjs.Dayjs]; offShiftReason?: string }) => {
    setConflicts([]);
    try { return await post(`/production/operations/${sched!.id}/schedule`, { startsAt: v.range[0].toISOString(), endsAt: v.range[1].toISOString(), offShiftReason: v.offShiftReason?.trim() || undefined }); } catch (e) {
      if (e instanceof ApiError && e.status === 400 && /luar shift/i.test(e.message)) setOffShift(true);
      if (e instanceof ApiError && e.status === 409) { const d = e.data as { conflicts?: { type: string; title: string; startsAt: string; endsAt: string }[] } | undefined; setConflicts((d?.conflicts ?? []).map((c) => `${c.type === 'MESIN_MATI' ? 'Mesin mati' : 'Operasi'}: ${c.title} (${dayjs(c.startsAt).format('D MMM HH:mm')}–${dayjs(c.endsAt).format('HH:mm')})`)); }
      throw e;
    }
  }, { invalidate: KEYS, success: 'Operasi dijadwalkan', onSuccess: () => setSched(null) });
  const unsched = useAction((id: string) => post(`/production/operations/${id}/unschedule`), { invalidate: KEYS });
  const start = useAction((id: string) => post(`/production/operations/${id}/start`), { invalidate: KEYS, success: 'Operasi dimulai' });
  const finish = useAction((v: { actualMinutes?: number; note?: string }) => post(`/production/operations/${fin!.id}/finish`, v), { invalidate: KEYS, success: 'Operasi selesai', onSuccess: () => setFin(null) });
  const correct = useAction((v: { actualMinutes: number; reason: string }) => post(`/production/operations/${corr!.id}/correct`, v), { invalidate: KEYS, success: 'Dikoreksi', onSuccess: () => setCorr(null) });
  const list = ops.data ?? [];
  if (!list.length) return null;
  const labor = list.reduce((a, o) => a + Number(o.laborCost), 0);
  const overhead = list.reduce((a, o) => a + Number(o.overheadCost), 0);
  const manage = can('POST', '/production/operations/:id/start');
  return (
    <div style={{ marginTop: 16 }}>
      <Typography.Title level={5}>Operasi</Typography.Title>
      <Table<OrderOp> size="small" rowKey="id" pagination={false} dataSource={list} scroll={{ x: 760 }}
        columns={[
          { title: '#', dataIndex: 'sequence', width: 36 }, { title: 'Operasi', render: (_: unknown, o: OrderOp) => <div>{o.name}<div style={{ fontSize: 12, color: '#64748b' }}>{o.workCenterCode}</div></div> },
          { title: 'Rencana / aktual (menit)', render: (_: unknown, o: OrderOp) => `${Number(o.plannedMinutes)} / ${o.actualMinutes ? Number(o.actualMinutes) : '-'}` },
          { title: 'Jadwal', render: (_: unknown, o: OrderOp) => (o.scheduledStart ? `${dayjs(o.scheduledStart).format('D MMM HH:mm')}–${dayjs(o.scheduledEnd).format('HH:mm')}` : '-') },
          { title: 'Biaya', render: (_: unknown, o: OrderOp) => (o.status === 'DONE' ? fmtMoney(Number(o.laborCost) + Number(o.overheadCost)) : '-') },
          { title: 'Status', render: (_: unknown, o: OrderOp) => <Tag color={OP[o.status].color}>{OP[o.status].label}</Tag> },
          { render: (_: unknown, o: OrderOp) => manage && (
            <Space wrap>
              {o.status === 'PENDING' && <Button size="small" onClick={() => { sf.setFieldsValue({ range: o.scheduledStart ? [dayjs(o.scheduledStart), dayjs(o.scheduledEnd)] : undefined, offShiftReason: undefined }); setConflicts([]); setOffShift(false); setSched(o); }}>Jadwalkan</Button>}
              {o.status === 'PENDING' && o.scheduledStart && <Button size="small" onClick={() => unsched.mutate(o.id)}>Lepas jadwal</Button>}
              {o.status === 'PENDING' && <Button size="small" type="primary" onClick={() => start.mutate(o.id)}>Mulai</Button>}
              {o.status === 'RUNNING' && <Button size="small" type="primary" onClick={() => { ff.resetFields(); setFin(o); }}>Selesai</Button>}
              {o.status === 'DONE' && can('POST', '/production/operations/:id/correct') && <Button size="small" onClick={() => { cf.setFieldsValue({ actualMinutes: Number(o.actualMinutes), reason: '' }); setCorr(o); }}>Koreksi</Button>}
            </Space>
          ) },
        ]} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>Biaya operasi selesai: upah {fmtMoney(labor)} + overhead {fmtMoney(overhead)}. Biaya konversi perintah ini dihitung dari operasi.</Typography.Paragraph>
      <Modal title={`Jadwalkan ${sched?.name ?? ''}`} open={!!sched} onCancel={() => setSched(null)} onOk={() => sf.submit()} confirmLoading={schedule.isPending} okText="Jadwalkan" destroyOnHidden>
        {conflicts.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Bentrok" description={conflicts.join('; ')} />}
        <Form form={sf} layout="vertical" onFinish={(v) => schedule.mutate(v)}>
          <Form.Item name="range" label="Waktu di pusat kerja" rules={[{ required: true }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="D MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
          {offShift && (canOverride
            ? <Form.Item name="offShiftReason" label="Alasan di luar shift (hanya Admin; ditandai di kontrol)" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
            : <Alert type="warning" showIcon message="Di luar shift pusat kerja ini. Pilih waktu di dalam satu shift, atau minta Admin menjadwalkannya." />)}
        </Form>
      </Modal>
      <Modal title={`Selesaikan ${fin?.name ?? ''}`} open={!!fin} onCancel={() => setFin(null)} onOk={() => ff.submit()} confirmLoading={finish.isPending} okText="Selesai" destroyOnHidden>
        <Form form={ff} layout="vertical" onFinish={(v) => finish.mutate(v)}>
          <Form.Item name="actualMinutes" label={`Menit aktual (rencana ${fin ? Number(fin.plannedMinutes) : ''}; kosong = sejak dimulai)`}><InputNumber min={1} max={1440} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="note" label="Catatan (wajib bila > 150% rencana)"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Koreksi menit aktual" open={!!corr} onCancel={() => setCorr(null)} onOk={() => cf.submit()} confirmLoading={correct.isPending} okText="Simpan" destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Biaya operasi dihitung ulang; tercatat di jejak audit." />
        <Form form={cf} layout="vertical" onFinish={(v) => correct.mutate(v)}>
          <Form.Item name="actualMinutes" label="Menit aktual" rules={[{ required: true }]}><InputNumber min={1} max={1440} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
