import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Progress, Space, Switch, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, post, put } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtMoney, fmtQty, today } from '@/lib/format';
import { ProjectDetail } from './shared';

interface BoqItem { id: string; lineNo: number; code: string | null; description: string; unit: string; qty: string; unitPrice: string; value: string; completedQty: string; completedValue: string; pct: number }
interface BoqView { items: BoqItem[]; total: string; completedValue: string; pct: number; contractValue: string; difference: string }
type Row = { id?: string; code?: string; description?: string; unit?: string; qty?: number; unitPrice?: number };

/** BoQ / RAB: item pekerjaan, volume, harga satuan; volume selesai per item menjadi dasar persentase kemajuan pekerjaan */
export function BoqCard({ project: p }: { project: ProjectDetail }) {
  const can = useCan();
  const q = useQuery({ queryKey: ['projects', p.id, 'boq'], queryFn: () => get<BoqView>(`/services/projects/${p.id}/boq`) });
  const [edit, setEdit] = useState(false);
  const [prog, setProg] = useState(false);
  const [form] = Form.useForm<{ items: Row[]; syncContract?: boolean }>();
  const [pform] = Form.useForm<{ date: string; notes?: string; done: Record<string, number | null> }>();
  const boq = q.data;
  useEffect(() => {
    if (edit && boq) form.setFieldsValue({ items: boq.items.length ? boq.items.map((i) => ({ id: i.id, code: i.code ?? undefined, description: i.description, unit: i.unit, qty: Number(i.qty), unitPrice: Number(i.unitPrice) })) : [{}], syncContract: false });
  }, [edit, boq, form]);
  const save = useAction(
    (v: { items: Row[]; syncContract?: boolean }) =>
      put<BoqView>(`/services/projects/${p.id}/boq`, { syncContract: !!v.syncContract, items: v.items.map((i) => ({ id: i.id, code: i.code || undefined, description: i.description, unit: i.unit, qty: String(i.qty), unitPrice: String(i.unitPrice) })) }),
    { success: 'BoQ disimpan', invalidate: ['projects'], onSuccess: () => setEdit(false) },
  );
  const progress = useAction(
    (v: { date: string; notes?: string; done: Record<string, number | null> }) =>
      post(`/services/projects/${p.id}/boq/progress`, { date: v.date, notes: v.notes, items: Object.entries(v.done).filter(([, q2]) => q2 != null).map(([itemId, q2]) => ({ itemId, completedQty: String(q2) })) }),
    { success: 'Kemajuan dicatat dari volume BoQ', invalidate: ['projects', ...LEDGER_KEYS], onSuccess: () => setProg(false) },
  );
  const canEdit = can('PUT', '/services/projects/:id/boq') && p.status === 'ACTIVE';
  const canProg = can('POST', '/services/projects/:id/boq/progress') && p.status === 'ACTIVE' && !!boq?.items.length;
  return (
    <Card
      title="BoQ / RAB"
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          {canProg && <Button onClick={() => { pform.setFieldsValue({ date: today(), done: Object.fromEntries((boq?.items ?? []).map((i) => [i.id, Number(i.completedQty)])) }); setProg(true); }}>Catat volume selesai</Button>}
          {canEdit && <Button type="primary" onClick={() => setEdit(true)}>{boq?.items.length ? 'Ubah BoQ' : 'Isi BoQ'}</Button>}
        </Space>
      }
    >
      {!boq?.items.length ? (
        <Typography.Text type="secondary">Belum ada BoQ. Isi item pekerjaan dengan volume dan harga satuan; volume selesai per item kemudian menghitung persentase kemajuan otomatis.</Typography.Text>
      ) : (
        <>
          <Space size="large" wrap style={{ marginBottom: 8 }}>
            <span>Total BoQ <b>{fmtMoney(boq.total)}</b></span>
            <span>Nilai selesai <b>{fmtMoney(boq.completedValue)}</b> ({boq.pct}%)</span>
            <span>Nilai kontrak {fmtMoney(boq.contractValue)}</span>
          </Space>
          {Number(boq.difference) !== 0 && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`Nilai kontrak ${Number(boq.difference) > 0 ? 'lebih besar' : 'lebih kecil'} ${fmtMoney(Math.abs(Number(boq.difference)))} dari total BoQ`} description="Samakan lewat Ubah BoQ › Samakan nilai kontrak, atau ubah nilai kontrak lewat addendum." />}
          <Table<BoqItem>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={boq.items}
            scroll={{ x: 900 }}
            columns={[
              { title: 'Kode', dataIndex: 'code', width: 80, render: (v: string | null) => v ?? '' },
              { title: 'Pekerjaan', dataIndex: 'description' },
              { title: 'Volume', align: 'right', render: (_, i) => `${fmtQty(i.qty)} ${i.unit}` },
              { title: 'Harga satuan', dataIndex: 'unitPrice', align: 'right', render: fmtMoney },
              { title: 'Nilai', dataIndex: 'value', align: 'right', render: fmtMoney },
              { title: 'Selesai', align: 'right', render: (_, i) => `${fmtQty(i.completedQty)} ${i.unit}` },
              { title: 'Progres', width: 140, render: (_, i) => <Progress percent={i.pct} size="small" /> },
            ]}
          />
        </>
      )}
      <Modal title="BoQ / RAB" width={900} open={edit} onCancel={() => setEdit(false)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'id']} hidden><Input /></Form.Item>
                    <Form.Item name={[f.name, 'code']}><Input placeholder="Kode" style={{ width: 80 }} /></Form.Item>
                    <Form.Item name={[f.name, 'description']} rules={[{ required: true, message: 'Isi pekerjaan' }]}><Input placeholder="Uraian pekerjaan" style={{ width: 280 }} /></Form.Item>
                    <Form.Item name={[f.name, 'unit']} rules={[{ required: true, message: 'Satuan' }]}><Input placeholder="Satuan" style={{ width: 80 }} /></Form.Item>
                    <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Volume' }]}><InputNumber min={0.0001} placeholder="Volume" style={{ width: 110 }} /></Form.Item>
                    <Form.Item name={[f.name, 'unitPrice']} rules={[{ required: true, message: 'Harga' }]}><InputNumber min={0} placeholder="Harga satuan" prefix="Rp" style={{ width: 160 }} /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({})}>Tambah item</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="syncContract" label="Samakan nilai kontrak dengan total BoQ" valuePropName="checked" style={{ marginTop: 16 }}><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Catat volume selesai" width={700} open={prog} onCancel={() => setProg(false)} onOk={() => pform.submit()} confirmLoading={progress.isPending} okText="Catat kemajuan" destroyOnHidden>
        <Typography.Paragraph type="secondary">Isi volume selesai KUMULATIF per item (tidak boleh turun). Persentase proyek dihitung dari nilai item yang selesai lalu dicatat sebagai kemajuan pekerjaan (pendapatan diakui sesuai persentase).</Typography.Paragraph>
        <Form form={pform} layout="vertical" onFinish={(v) => progress.mutate(v)}>
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          {(boq?.items ?? []).map((i) => (
            <Form.Item key={i.id} name={['done', i.id]} label={`${i.code ? `${i.code} · ` : ''}${i.description} (volume ${fmtQty(i.qty)} ${i.unit})`}>
              <InputNumber min={Number(i.completedQty)} max={Number(i.qty)} style={{ width: 200 }} addonAfter={i.unit} />
            </Form.Item>
          ))}
          <Form.Item name="notes" label="Catatan (opsional)"><Input maxLength={300} placeholder="Mis. opname lapangan tgl ..." /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
