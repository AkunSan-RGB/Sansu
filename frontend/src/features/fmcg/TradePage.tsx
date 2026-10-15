import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Term { id: string; customerId: string; customerName: string; name: string; kind: 'PCT_SALES' | 'FIXED_MONTHLY'; value: string; validFrom: string | null; validTo: string | null; isActive: boolean }
interface Accrual { id: string; number: string; period: string; customerId: string; customerName: string; termName: string; baseAmount: string; amount: string; settledAmount: string; remaining: string; status: 'ACCRUED' | 'SETTLED' | 'VOID' }
interface Claim { id: string; number: string; supplierName: string; period: string; claimedAmount: string; approvedAmount: string; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED'; principalRef: string | null }
const CLAIM = { DRAFT: { color: 'default', text: 'Draf' }, SUBMITTED: { color: 'gold', text: 'Diajukan' }, APPROVED: { color: 'blue', text: 'Disetujui prinsipal' }, PAID: { color: 'green', text: 'Diterima' }, REJECTED: { color: 'red', text: 'Ditolak' } };
const prevMonth = () => dayjs().subtract(1, 'month');

/** Modern trade: syarat dagang peritel (rebate/listing fee) dan klaim biaya promo ke prinsipal */
export default function TradePage() {
  return (
    <>
      <PageHeader title="Modern trade & klaim prinsipal" />
      <Tabs items={[
        { key: 'terms', label: 'Syarat dagang outlet', children: <TermsTab /> },
        { key: 'acc', label: 'Utang rebate & trade promo', children: <AccrualsTab /> },
        { key: 'claims', label: 'Klaim ke prinsipal', children: <ClaimsTab /> },
      ]} />
    </>
  );
}

function TermsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['trade-terms'], queryFn: () => get<Term[]>('/trade-terms') });
  const { data: customers } = useCustomers();
  const [editing, setEditing] = useState<Term | 'new' | null>(null);
  const [form] = Form.useForm<{ customerId: string; name: string; kind: Term['kind']; value: number; period?: [dayjs.Dayjs, dayjs.Dayjs]; isActive: boolean }>();
  const kind = Form.useWatch('kind', form);
  const save = useAction(
    (v: { customerId: string; name: string; kind: Term['kind']; value: number; period?: [dayjs.Dayjs, dayjs.Dayjs]; isActive: boolean }) => {
      const body = { customerId: v.customerId, name: v.name, kind: v.kind, value: String(v.value), validFrom: v.period?.[0]?.format('YYYY-MM-DD'), validTo: v.period?.[1]?.format('YYYY-MM-DD'), isActive: v.isActive };
      return editing && editing !== 'new' ? put(`/trade-terms/${editing.id}`, body) : post('/trade-terms', body);
    },
    { success: 'Syarat dagang disimpan', invalidate: ['trade-terms'], onSuccess: () => setEditing(null) },
  );
  const open = (t: Term | 'new') => {
    form.resetFields();
    if (t === 'new') form.setFieldsValue({ kind: 'PCT_SALES', isActive: true });
    else form.setFieldsValue({ customerId: t.customerId, name: t.name, kind: t.kind, value: Number(t.value), period: t.validFrom && t.validTo ? [dayjs(t.validFrom), dayjs(t.validTo)] : undefined, isActive: t.isActive });
    setEditing(t);
  };
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Peritel modern biasanya meminta rebate (persen dari penjualan neto) dan biaya tetap bulanan (listing fee, merchandising). Syarat dagang dihitung tiap akhir bulan menjadi utang rebate, lalu dilunasi dengan memotong tagihan atau dibayar. Hanya Pemilik/Admin yang mengubah syarat." />
      {can('POST', '/trade-terms') && <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => open('new')}>Syarat dagang baru</Button>}
      <Table<Term> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 10 }} scroll={{ x: 640 }} locale={{ emptyText: 'Belum ada syarat dagang' }}
        columns={[
          { title: 'Outlet', dataIndex: 'customerName' },
          { title: 'Syarat', render: (_: unknown, t: Term) => <span>{t.name} {!t.isActive && <Tag>Nonaktif</Tag>}</span> },
          { title: 'Nilai', align: 'right' as const, render: (_: unknown, t: Term) => (t.kind === 'PCT_SALES' ? `${Number(t.value)}% dari penjualan neto` : `${fmtMoney(t.value)} / bulan`) },
          { title: 'Berlaku', render: (_: unknown, t: Term) => (t.validFrom || t.validTo ? `${fmtDate(t.validFrom)} – ${fmtDate(t.validTo)}` : 'Tanpa batas') },
          { title: '', render: (_: unknown, t: Term) => can('PUT', '/trade-terms/:id') && <Button size="small" onClick={() => open(t)}>Ubah</Button> },
        ]} />
      <Modal title={editing === 'new' ? 'Syarat dagang baru' : 'Ubah syarat dagang'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="customerId" label="Outlet" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="name" label="Nama syarat" rules={[{ required: true, min: 2 }]}><Input placeholder="Rebate pencapaian / Listing fee" /></Form.Item>
          <Form.Item name="kind" label="Jenis"><Select options={[{ value: 'PCT_SALES', label: 'Persen dari penjualan neto' }, { value: 'FIXED_MONTHLY', label: 'Biaya tetap per bulan' }]} /></Form.Item>
          <Form.Item name="value" label={kind === 'FIXED_MONTHLY' ? 'Rupiah per bulan' : 'Persen'} rules={[{ required: true }]}><InputNumber min={0} max={kind === 'FIXED_MONTHLY' ? undefined : 100} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="period" label="Periode berlaku (kosong = tanpa batas)"><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Select options={[{ value: true, label: 'Aktif' }, { value: false, label: 'Nonaktif' }]} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function AccrualsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['trade-accruals'], queryFn: () => get<Accrual[]>('/trade-accruals') });
  const [month, setMonth] = useState(prevMonth().format('YYYY-MM'));
  const [settling, setSettling] = useState<Accrual | null>(null);
  const [sf] = Form.useForm<{ mode: 'DEDUCT' | 'PAY'; amount: number; invoiceId?: string }>();
  const mode = Form.useWatch('mode', sf);
  const { data: invoices } = useQuery({ queryKey: ['invoices'], queryFn: () => get<{ id: string; number: string; total: string; paidAmount: string; returnedAmount?: string; customerId: string }[]>('/invoices'), enabled: !!settling });
  const accrue = useAction(() => post<{ created: number; total: string }>('/trade-accruals/accrue', { period: month }), { success: (r) => (r.created ? `${r.created} utang rebate dijurnal (${fmtMoney(r.total)})` : 'Tidak ada yang baru untuk dijurnal'), invalidate: ['trade-accruals', 'journals', 'reports'] });
  const settle = useAction((v: { id: string; mode: 'DEDUCT' | 'PAY'; amount: number; invoiceId?: string }) => post(`/trade-accruals/${v.id}/settle`, { mode: v.mode, amount: String(v.amount), invoiceId: v.invoiceId }), { success: 'Dilunasi', invalidate: ['trade-accruals', 'invoices', 'journals', 'reports', 'cash-accounts'], onSuccess: () => setSettling(null) });
  const candidates = (invoices ?? []).filter((i) => i.customerId === settling?.customerId && Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount ?? 0) > 0);
  return (
    <>
      {can('POST', '/trade-accruals/accrue') && (
        <Space style={{ marginBottom: 8 }}>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 150 }} />
          <Popconfirm title={`Hitung syarat dagang ${month}?`} description="Dijurnal Dr Beban Trade Promo | Cr Utang Rebate. Satu syarat hanya sekali per bulan." okText="Hitung" cancelText="Batal" onConfirm={() => accrue.mutate(undefined)}><Button type="primary" loading={accrue.isPending}>Hitung syarat dagang bulan</Button></Popconfirm>
        </Space>
      )}
      <Table<Accrual> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: 'Belum ada utang rebate' }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Bulan', dataIndex: 'period' },
          { title: 'Outlet / syarat', render: (_: unknown, a: Accrual) => <div>{a.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{a.termName}</div></div> },
          { title: 'Dasar (neto)', align: 'right' as const, render: (_: unknown, a: Accrual) => fmtMoney(a.baseAmount) },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, a: Accrual) => fmtMoney(a.amount) },
          { title: 'Sisa', align: 'right' as const, render: (_: unknown, a: Accrual) => fmtMoney(a.remaining) },
          { title: 'Status', render: (_: unknown, a: Accrual) => <Tag color={a.status === 'SETTLED' ? 'green' : a.status === 'VOID' ? 'default' : 'gold'}>{a.status === 'SETTLED' ? 'Lunas' : a.status === 'VOID' ? 'Batal' : 'Belum lunas'}</Tag> },
          { title: '', render: (_: unknown, a: Accrual) => a.status === 'ACCRUED' && can('POST', '/trade-accruals/:id/settle') && <Button size="small" type="primary" onClick={() => { sf.resetFields(); sf.setFieldsValue({ mode: 'DEDUCT', amount: Number(a.remaining) }); setSettling(a); }}>Lunasi</Button> },
        ]} />
      <Modal title={`Lunasi ${settling?.number ?? ''}`} open={!!settling} onCancel={() => setSettling(null)} onOk={() => sf.submit()} confirmLoading={settle.isPending} okText="Lunasi" destroyOnHidden>
        <Form form={sf} layout="vertical" onFinish={(v) => settle.mutate({ id: settling!.id, ...v })}>
          <Form.Item name="mode" label="Cara"><Select options={[{ value: 'DEDUCT', label: 'Potong tagihan outlet (piutang berkurang)' }, { value: 'PAY', label: 'Bayar tunai/transfer ke outlet' }]} /></Form.Item>
          {mode === 'DEDUCT' && <Form.Item name="invoiceId" label="Faktur yang dipotong" rules={[{ required: true }]}><Select options={candidates.map((i) => ({ value: i.id, label: `${i.number} · sisa ${fmtMoney(Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount ?? 0))}` }))} /></Form.Item>}
          <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}><InputNumber min={1} max={Number(settling?.remaining ?? 0)} prefix="Rp" style={{ width: 220 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function ClaimsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['principal-claims'], queryFn: () => get<Claim[]>('/principal-claims') });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ id: string; code: string; name: string }[]>('/suppliers') });
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Claim | null>(null);
  const [cf] = Form.useForm<{ supplierId: string; month: string }>();
  const [df] = Form.useForm<{ approvedAmount: number; principalRef?: string }>();
  const inv = ['principal-claims', 'journals', 'reports', 'cash-accounts'];
  const gen = useAction((v: { supplierId: string; month: string }) => post('/principal-claims/generate', { supplierId: v.supplierId, period: v.month }), { success: 'Klaim dibuat dari baris promo bulan itu', invalidate: inv, onSuccess: () => setCreating(false) });
  const submit = useAction((id: string) => post(`/principal-claims/${id}/submit`), { success: 'Klaim diajukan', invalidate: inv });
  const decide = useAction((v: { id: string; approvedAmount: number; principalRef?: string }) => post(`/principal-claims/${v.id}/decide`, { approvedAmount: String(v.approvedAmount), principalRef: v.principalRef }), { success: 'Keputusan prinsipal dicatat', invalidate: inv, onSuccess: () => setDeciding(null) });
  const receive = useAction((id: string) => post(`/principal-claims/${id}/receive`), { success: 'Penerimaan klaim dicatat', invalidate: inv });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Isi “Prinsipal penanggung” dan persennya di promo. Setelah bulan berakhir, klaim dikumpulkan dari baris pesanan berpromo (potongan dan biaya bonus); tiap baris hanya bisa diklaim sekali. Disetujui prinsipal → piutang klaim; diterima → kas." />
      {can('POST', '/principal-claims/generate') && <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => { cf.resetFields(); cf.setFieldsValue({ month: prevMonth().format('YYYY-MM') }); setCreating(true); }}>Buat klaim bulanan</Button>}
      <Table<Claim> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: 'Belum ada klaim' }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Prinsipal', dataIndex: 'supplierName' },
          { title: 'Bulan', dataIndex: 'period' },
          { title: 'Klaim', align: 'right' as const, render: (_: unknown, c: Claim) => fmtMoney(c.claimedAmount) },
          { title: 'Disetujui', align: 'right' as const, render: (_: unknown, c: Claim) => (['APPROVED', 'PAID'].includes(c.status) ? fmtMoney(c.approvedAmount) : '-') },
          { title: 'Status', render: (_: unknown, c: Claim) => <Tag color={CLAIM[c.status].color}>{CLAIM[c.status].text}</Tag> },
          { title: '', render: (_: unknown, c: Claim) => (
            <Space>
              {c.status === 'DRAFT' && can('POST', '/principal-claims/:id/submit') && <Button size="small" onClick={() => submit.mutate(c.id)}>Ajukan</Button>}
              {c.status === 'SUBMITTED' && can('POST', '/principal-claims/:id/decide') && <Button size="small" type="primary" onClick={() => { df.setFieldsValue({ approvedAmount: Number(c.claimedAmount), principalRef: undefined }); setDeciding(c); }}>Catat keputusan prinsipal</Button>}
              {c.status === 'APPROVED' && can('POST', '/principal-claims/:id/receive') && <Popconfirm title="Catat uang klaim diterima?" okText="Terima" cancelText="Batal" onConfirm={() => receive.mutate(c.id)}><Button size="small" type="primary">Terima uang</Button></Popconfirm>}
            </Space>
          ) },
        ]} />
      <Modal title="Buat klaim bulanan" open={creating} onCancel={() => setCreating(false)} onOk={() => cf.submit()} confirmLoading={gen.isPending} okText="Buat" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => gen.mutate(v)}>
          <Form.Item name="supplierId" label="Prinsipal" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(suppliers ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Form.Item>
          <Form.Item name="month" label="Bulan" rules={[{ required: true }]}><Input type="month" style={{ width: 180 }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Keputusan prinsipal" open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Catat" destroyOnHidden>
        <p>Klaim {deciding?.number} sebesar {fmtMoney(deciding?.claimedAmount)}. Isi 0 bila ditolak seluruhnya (baris dilepas agar bisa diklaim ulang).</p>
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate({ id: deciding!.id, ...v })}>
          <Form.Item name="approvedAmount" label="Jumlah disetujui" rules={[{ required: true }]}><InputNumber min={0} max={Number(deciding?.claimedAmount ?? 0)} prefix="Rp" style={{ width: 220 }} /></Form.Item>
          <Form.Item name="principalRef" label="Nomor persetujuan / nota kredit prinsipal"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
