import { DEPOSIT_MOVEMENT_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ConnectionSelect, Stats } from './kit';

interface Dep { id: string; number: string; customer_id: string; customer_name: string; connection_number: string | null; amount: string; remaining: string; received_on: string; method: string; note: string | null; movements?: { id: string; date: string; kind: string; amount: string; invoice_number: string | null; user_name: string | null; note: string | null }[] }
const METHODS = [{ value: 'CASH', label: 'Tunai' }, { value: 'TRANSFER', label: 'Transfer' }];

/** Deposit/jaminan sambungan: uang titipan pelanggan (utang), bisa dipakai melunasi tunggakan atau dikembalikan saat sambungan ditutup */
export function DepositsTab() {
  const can = useCan();
  const [openOnly, setOpenOnly] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['utility', 'deposits', openOnly], queryFn: () => get<Dep[]>(`/utility/deposits?open=${openOnly}`) });
  const sum = useQuery({ queryKey: ['utility', 'deposits', 'summary'], queryFn: () => get<{ held: number; count: number }>('/utility/deposits/summary') });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Jaminan bukan pendapatan" description="Uang jaminan dicatat sebagai utang kepada pelanggan. Bila pelanggan menunggak, jaminan dapat dipakai melunasi tagihan (dikerjakan orang lain dari penerimanya); saat sambungan ditutup, sisanya dikembalikan setelah tunggakan beres." />
      <Stats items={[{ title: 'Jaminan ditahan', value: fmtMoney(sum.data?.held ?? 0), hint: `${sum.data?.count ?? 0} jaminan masih berisi` }]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Hanya yang masih berisi <Switch checked={openOnly} onChange={setOpenOnly} /></span>
        {can('POST', '/utility/deposits') && <Button type="primary" onClick={() => setCreating(true)}>Terima jaminan</Button>}
      </Space>
      <ResponsiveTable<Dep> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} onRow={(d) => ({ onClick: () => setOpenId(d.id), style: { cursor: 'pointer' } })} onMobileClick={(d) => setOpenId(d.id)}
        columns={[
          { title: 'Nomor', dataIndex: 'number' }, { title: 'Diterima', render: (_: unknown, d: Dep) => fmtDate(d.received_on) },
          { title: 'Pelanggan', render: (_: unknown, d: Dep) => <>{d.customer_name}{d.connection_number && <div style={{ fontSize: 12, color: '#64748b' }}>{d.connection_number}</div>}</> },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, d: Dep) => fmtMoney(d.amount) },
          { title: 'Sisa', align: 'right' as const, render: (_: unknown, d: Dep) => (Number(d.remaining) > 0 ? <b>{fmtMoney(d.remaining)}</b> : <Tag>Habis</Tag>) },
          { title: 'Cara', render: (_: unknown, d: Dep) => METHODS.find((m) => m.value === d.method)?.label ?? d.method },
        ]} />
      <ReceiveDeposit open={creating} onClose={() => setCreating(false)} />
      <DepositDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ReceiveDeposit({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const customers = useCustomers();
  const customerId = Form.useWatch('customerId', f) as string | undefined;
  const rules = useQuery({ queryKey: ['utility', 'rules'], queryFn: () => get<{ cashless: boolean }>('/utility/rules'), enabled: open });
  const save = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/deposits', { ...v, amount: String(v.amount) }), { success: (r) => `Jaminan ${r.number} diterima`, invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  const cashless = rules.data?.cashless;
  return (
    <Modal open={open} title="Terima jaminan sambungan" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ method: cashless ? 'TRANSFER' : 'CASH' }}>
        <Form.Item name="customerId" label="Pelanggan" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>
        <Form.Item name="connectionId" label="Untuk sambungan (opsional)"><ConnectionSelect allowClear filter={(c) => !customerId || c.customerName === (customers.data ?? []).find((x) => x.id === customerId)?.name} /></Form.Item>
        <Space align="start">
          <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="method" label="Cara terima"><Select style={{ width: 160 }} options={cashless ? METHODS.filter((m) => m.value === 'TRANSFER') : METHODS} /></Form.Item>
        </Space>
        <Form.Item name="note" label="Catatan"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

function DepositDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const q = useQuery({ queryKey: ['utility', 'deposits', 'one', id], queryFn: () => get<Dep>(`/utility/deposits/${id}`), enabled: !!id });
  const d = q.data;
  const [mode, setMode] = useState<null | 'offset' | 'refund'>(null);
  const [f] = Form.useForm();
  const [search, setSearch] = useState('');
  const invs = useQuery({ queryKey: ['utility', 'deposits', 'inv', search, d?.customer_name], queryFn: () => get<{ id: string; number: string; customer: string; open: string }[]>(`/utility/adjustments/invoices?q=${encodeURIComponent(search || d!.customer_name)}`), enabled: mode === 'offset' && !!d });
  const done = () => { f.resetFields(); setMode(null); };
  const offset = useAction((v: { invoiceId: string; amount?: number }) => post(`/utility/deposits/${id}/offset`, { invoiceId: v.invoiceId, amount: v.amount != null ? String(v.amount) : undefined }), { success: 'Jaminan dipakai melunasi tagihan', invalidate: ['utility', 'invoices'], onSuccess: done });
  const refund = useAction((v: { amount?: number; method?: string; note?: string }) => post(`/utility/deposits/${id}/refund`, { ...v, amount: v.amount != null ? String(v.amount) : undefined }), { success: 'Jaminan dikembalikan', invalidate: ['utility'], onSuccess: done });
  return (
    <Drawer open={!!id} onClose={onClose} width={520} title={d ? `Jaminan ${d.number}` : 'Jaminan'} loading={q.isLoading}>
      {d && (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Pelanggan">{d.customer_name} {d.connection_number && `· ${d.connection_number}`}</Descriptions.Item>
            <Descriptions.Item label="Diterima">{fmtDate(d.received_on)} · {fmtMoney(d.amount)}</Descriptions.Item>
            <Descriptions.Item label="Sisa jaminan"><b>{fmtMoney(d.remaining)}</b></Descriptions.Item>
          </Descriptions>
          {Number(d.remaining) > 0 && (
            <Space style={{ margin: '12px 0' }}>
              {can('POST', '/utility/deposits/:id/offset') && <Button onClick={() => setMode('offset')}>Pakai melunasi tunggakan</Button>}
              {can('POST', '/utility/deposits/:id/refund') && <Button onClick={() => { f.setFieldsValue({ amount: Number(d.remaining) }); setMode('refund'); }}>Kembalikan ke pelanggan</Button>}
            </Space>
          )}
          <Table size="small" rowKey="id" pagination={false} dataSource={d.movements} columns={[
            { title: 'Tanggal', render: (_: unknown, m: NonNullable<Dep['movements']>[number]) => fmtDate(m.date) },
            { title: 'Kejadian', render: (_: unknown, m: NonNullable<Dep['movements']>[number]) => <>{DEPOSIT_MOVEMENT_LABELS[m.kind as keyof typeof DEPOSIT_MOVEMENT_LABELS]}{m.invoice_number && <div style={{ fontSize: 12, color: '#64748b' }}>{m.invoice_number}</div>}</> },
            { title: 'Jumlah', align: 'right' as const, render: (_: unknown, m: NonNullable<Dep['movements']>[number]) => fmtMoney(m.amount) },
            { title: 'Oleh', dataIndex: 'user_name' },
          ]} />
        </>
      )}
      <Modal open={mode === 'offset'} title="Pakai jaminan melunasi tagihan" okText="Pakai" cancelText="Batal" confirmLoading={offset.isPending} destroyOnHidden onCancel={done} onOk={() => f.validateFields().then((v) => offset.mutate(v))}>
        <Form form={f} layout="vertical">
          <Form.Item name="invoiceId" label="Tagihan" rules={[{ required: true }]}><Select showSearch filterOption={false} onSearch={setSearch} options={(invs.data ?? []).map((i) => ({ value: i.id, label: `${i.number} — ${i.customer} — sisa ${fmtMoney(i.open)}` }))} /></Form.Item>
          <Form.Item name="amount" label="Jumlah (kosong = sebanyak yang bisa)"><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={mode === 'refund'} title="Kembalikan jaminan" okText="Kembalikan" cancelText="Batal" confirmLoading={refund.isPending} destroyOnHidden onCancel={done} onOk={() => f.validateFields().then((v) => refund.mutate(v))}>
        <Form form={f} layout="vertical">
          <Form.Item name="amount" label="Jumlah"><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="method" label="Cara"><Select allowClear options={METHODS} /></Form.Item>
          <Form.Item name="note" label="Catatan"><Input /></Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
