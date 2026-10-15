import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface Swap {
  id: string;
  number: string;
  date: string;
  reason: 'EXPIRED' | 'DAMAGED' | 'RECALL';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  customer?: { code: string; name: string };
  invoiceNumber?: string;
  costAmount: string;
  rejectReason: string | null;
  lines: { id: string; productId: string; qty: string; uom: string; lotNo: string | null }[];
}
interface InvoiceRow { id: string; number: string; customer?: { name: string }; kind?: string }
interface InvoiceDetail { id: string; lines: { id: string; qty: string; uom: string; returnedQty: string; product?: { sku: string; name: string } }[] }
const REASON = { EXPIRED: 'Kedaluwarsa', DAMAGED: 'Rusak', RECALL: 'Penarikan produk' };
const STATUS = { PENDING: { color: 'gold', text: 'Menunggu persetujuan' }, APPROVED: { color: 'green', text: 'Disetujui' }, REJECTED: { color: 'red', text: 'Ditolak' } };

/** Tukar-guling: barang bermasalah ditarik dan diganti barang yang sama dengan jumlah sama; stok baru bergerak setelah disetujui */
export default function SwapsPage() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['goods-swaps'], queryFn: () => get<Swap[]>('/goods-swaps') });
  const { data: invoices } = useQuery({ queryKey: ['invoices'], queryFn: () => get<InvoiceRow[]>('/invoices') });
  const [creating, setCreating] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string>();
  const { data: detail } = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => get<InvoiceDetail>(`/invoices/${invoiceId}`), enabled: !!invoiceId });
  const [form] = Form.useForm<{ invoiceId: string; reason: Swap['reason']; notes?: string; qty: Record<string, number | undefined>; lot: Record<string, string | undefined> }>();
  const [rejecting, setRejecting] = useState<Swap | null>(null);
  const [rejForm] = Form.useForm<{ reason: string }>();
  const create = useAction(
    (v: { invoiceId: string; reason: Swap['reason']; notes?: string; qty: Record<string, number | undefined>; lot: Record<string, string | undefined> }) =>
      post('/goods-swaps', { invoiceId: v.invoiceId, reason: v.reason, notes: v.notes, lines: Object.entries(v.qty ?? {}).filter(([, q]) => q && q > 0).map(([invoiceLineId, q]) => ({ invoiceLineId, qty: String(q), lotNo: v.lot?.[invoiceLineId] || undefined })) }),
    { success: 'Usulan tukar-guling dibuat', invalidate: ['goods-swaps'], onSuccess: () => setCreating(false) },
  );
  const approve = useAction((id: string) => post(`/goods-swaps/${id}/approve`), { success: 'Disetujui: stok pengganti keluar dan biaya dijurnal', invalidate: ['goods-swaps', 'stock', 'journals', 'reports', 'dashboard'] });
  const reject = useAction((v: { id: string; reason: string }) => post(`/goods-swaps/${v.id}/reject`, { reason: v.reason }), { success: 'Ditolak', invalidate: ['goods-swaps'], onSuccess: () => setRejecting(null) });
  return (
    <>
      <ListPage<Swap>
        title="Tukar-guling"
        actions={can('POST', '/goods-swaps') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setInvoiceId(undefined); setCreating(true); }}>Usulan tukar-guling</Button>}
        rows={data}
        loading={isLoading}
        views={[{ value: 'ALL', label: 'Semua', test: () => true }, { value: 'PENDING', label: 'Menunggu', test: (s) => s.status === 'PENDING' }]}
        below={<Alert type="info" showIcon style={{ marginBottom: 12 }} message="Barang rusak/kedaluwarsa/ditarik dari outlet diganti barang yang sama dengan jumlah yang sama, tanpa mengubah piutang. Barang lama dimusnahkan; biaya barang pengganti dicatat sebagai beban barang kedaluwarsa & retur rusak. Wajib mengacu faktur outlet (maks. 180 hari) dan disetujui orang lain dari pembuatnya." />}
        searchText={(s) => `${s.number} ${s.customer?.name ?? ''} ${s.invoiceNumber ?? ''}`}
        searchPlaceholder="Cari nomor, outlet, atau faktur"
        emptyText="Belum ada tukar-guling."
        columns={[
          { title: 'Nomor', dataIndex: 'number', render: (n: string, s: Swap) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(s.date)}</span></div> },
          { title: 'Outlet / faktur', render: (_: unknown, s: Swap) => <div>{s.customer?.name}<div style={{ fontSize: 12, color: '#64748b' }}>{s.invoiceNumber}</div></div> },
          { title: 'Alasan', render: (_: unknown, s: Swap) => REASON[s.reason] },
          { title: 'Barang', render: (_: unknown, s: Swap) => s.lines.map((l) => <div key={l.id} style={{ fontSize: 12 }}>{fmtQty(l.qty)} {l.uom}{l.lotNo ? ` · lot ${l.lotNo}` : ''}</div>) },
          { title: 'Biaya', align: 'right' as const, render: (_: unknown, s: Swap) => (s.status === 'APPROVED' ? fmtMoney(s.costAmount) : '-') },
          { title: 'Status', render: (_: unknown, s: Swap) => <Tag color={STATUS[s.status].color}>{STATUS[s.status].text}</Tag> },
          { title: '', render: (_: unknown, s: Swap) => s.status === 'PENDING' && (
            <Space>
              {can('POST', '/goods-swaps/:id/approve') && <Button size="small" type="primary" loading={approve.isPending} onClick={() => approve.mutate(s.id)}>Setujui</Button>}
              {can('POST', '/goods-swaps/:id/reject') && <Button size="small" danger onClick={() => { rejForm.resetFields(); setRejecting(s); }}>Tolak</Button>}
            </Space>
          ) },
        ]}
      />
      <Modal title="Usulan tukar-guling" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Ajukan" destroyOnHidden width={620}>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ reason: 'EXPIRED' }}>
          <Form.Item name="invoiceId" label="Faktur outlet" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" onChange={setInvoiceId} options={(invoices ?? []).filter((i) => i.kind !== 'SERVICE').map((i) => ({ value: i.id, label: `${i.number} · ${i.customer?.name ?? ''}` }))} /></Form.Item>
          <Form.Item name="reason" label="Alasan"><Select options={Object.entries(REASON).map(([value, label]) => ({ value, label }))} /></Form.Item>
          {detail?.lines.map((l) => (
            <Space key={l.id} align="baseline" wrap style={{ display: 'flex' }}>
              <span style={{ minWidth: 200, display: "inline-block" }}>{l.product?.sku} · {l.product?.name}<br /><span style={{ fontSize: 12, color: '#64748b' }}>dijual {fmtQty(l.qty)} {l.uom}</span></span>
              <Form.Item name={['qty', l.id]} label="Jumlah ditukar"><InputNumber min={0} max={Number(l.qty)} style={{ width: 120 }} /></Form.Item>
              <Form.Item name={['lot', l.id]} label="Lot lama"><Input style={{ width: 130 }} /></Form.Item>
            </Space>
          ))}
          <Form.Item name="notes" label="Catatan"><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Tolak tukar-guling" open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => rejForm.submit()} confirmLoading={reject.isPending} okText="Tolak" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={rejForm} layout="vertical" onFinish={(v) => reject.mutate({ id: rejecting!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
