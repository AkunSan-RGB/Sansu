/** Uang muka pemasok (DP pembelian): dibayar sebelum barang/faktur datang → diperhitungkan ke faktur atau dikembalikan */
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useSuppliers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import CashAccountSelect from '@/components/CashAccountSelect';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, rupiahInput, today } from '@/lib/format';
import { useHasRole } from '@/lib/roles';

const KEY = 'supplier-advances';
const INVALIDATE = [KEY, 'purchase-invoices', 'purchase-invoice', 'purchase-orders', ...LEDGER_KEYS];
const STALE_DAYS = 60;

interface Advance {
  id: string; number: string; date: string; supplierId: string; supplierCode: string; supplierName: string;
  purchaseOrderId: string | null; purchaseOrderNumber: string | null; method: string; amount: string; appliedAmount: string; refundedAmount: string;
  remaining: string; status: 'OPEN' | 'CLOSED' | 'VOID'; description: string | null; createdByName: string | null; ageDays: number;
}
interface Movement { id: string; kind: 'APPLY' | 'REFUND'; number: string; date: string; amount: string; note: string | null; invoiceNumber: string | null; supplierInvoiceNo: string | null; createdByName: string | null }
interface Summary { total: string; suppliers: { supplierId: string; supplierCode: string; supplierName: string; open: string; count: number; oldest: string | null; openInvoices: string }[] }
interface Control { key: string; title: string; severity: string; items: Record<string, unknown>[] }

const STATUS_TAG: Record<string, { label: string; color?: string }> = { OPEN: { label: 'Ada sisa', color: 'gold' }, CLOSED: { label: 'Habis' }, VOID: { label: 'Dibatalkan', color: 'red' } };
const SEV: Record<string, string> = { high: 'red', medium: 'orange' };
const COL: Record<string, string> = { number: 'No.', supplier: 'Pemasok', date: 'Tanggal', remaining: 'Sisa', days: 'Hari', po: 'Pesanan', openInvoices: 'Faktur terbuka' };

export default function SupplierAdvancesPage() {
  const can = useCan();
  const showControls = useHasRole(['ADMIN', 'FINANCE', 'ACCOUNTANT']);
  const [openOnly, setOpenOnly] = useState(true);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const list = useQuery({ queryKey: [KEY, 'list'], queryFn: () => get<Advance[]>('/supplier-advances') });
  const summary = useQuery({ queryKey: [KEY, 'summary'], queryFn: () => get<Summary>('/supplier-advances/summary') });
  const controls = useQuery({ queryKey: [KEY, 'controls'], queryFn: () => get<Control[]>('/supplier-advances/controls'), enabled: showControls });
  const all = list.data ?? [];
  const shown = all.filter((a) => !openOnly || a.status === 'OPEN');
  const findings = (controls.data ?? []).reduce((n, c) => n + c.items.length, 0);
  const stale = all.filter((a) => a.status === 'OPEN' && a.ageDays > STALE_DAYS).length;
  return (
    <>
      <PageHeader
        title="Uang muka pemasok"
        extra={can('POST', '/supplier-advances') ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Bayar uang muka</Button> : undefined}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Uang muka adalah uang keluar sebelum barang datang"
        description="Dicatat sebagai aset (Uang Muka Pembelian), bukan biaya. Saat faktur datang, perhitungkan ke faktur itu; bila pemasok mengembalikan, catat pengembaliannya. PPN masukan diakui pada faktur pembelian. DP tanpa pesanan pembelian atau di atas 30% nilai pesanan oleh staf menunggu persetujuan Pemilik/Admin."
      />
      <SummaryCards
        items={[
          { label: 'Saldo uang muka terbuka', value: fmtMoney(summary.data?.total ?? 0), hint: `${summary.data?.suppliers.length ?? 0} pemasok`, tone: Number(summary.data?.total ?? 0) > 0 ? 'warn' : 'neutral' },
          { label: 'Uang muka yang masih ada sisa', value: String(all.filter((a) => a.status === 'OPEN').length) },
          { label: `Belum dipakai > ${STALE_DAYS} hari`, value: String(stale), tone: stale ? 'bad' : 'good' },
          ...(showControls ? [{ label: 'Temuan kontrol', value: String(findings), tone: findings ? ('warn' as const) : ('good' as const) }] : []),
        ]}
      />
      <Tabs
        items={[
          {
            key: 'daftar',
            label: 'Daftar',
            children: (
              <Card>
                <Space style={{ marginBottom: 12 }}>
                  <Segmented value={openOnly ? 'OPEN' : 'ALL'} onChange={(v) => setOpenOnly(v === 'OPEN')} options={[{ value: 'OPEN', label: 'Masih ada sisa' }, { value: 'ALL', label: `Semua (${all.length})` }]} />
                </Space>
                <ResponsiveTable<Advance>
                  rowKey="id"
                  size="small"
                  loading={list.isLoading}
                  dataSource={shown}
                  scroll={{ x: 900 }}
                  locale={{ emptyText: <Empty description="Belum ada uang muka" /> }}
                  onRow={(r) => ({ onClick: () => setDetailId(r.id), style: { cursor: 'pointer' } })}
                  columns={[
                    { title: 'No.', dataIndex: 'number' },
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                    { title: 'Pemasok', render: (_, r) => r.supplierName },
                    { title: 'Pesanan', render: (_, r) => r.purchaseOrderNumber ?? <Typography.Text type="secondary">tanpa pesanan</Typography.Text> },
                    { title: 'Dibayar', dataIndex: 'amount', align: 'right', render: fmtMoney },
                    { title: 'Sisa', dataIndex: 'remaining', align: 'right', render: (v: string, r) => (r.status === 'OPEN' ? <b>{fmtMoney(v)}</b> : '-') },
                    { title: 'Umur', dataIndex: 'ageDays', align: 'right', render: (v: number, r) => (r.status === 'OPEN' ? <Tag color={v > STALE_DAYS ? 'red' : undefined}>{v} hari</Tag> : '-') },
                    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={STATUS_TAG[v]?.color}>{STATUS_TAG[v]?.label ?? v}</Tag> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'pemasok',
            label: 'Saldo per pemasok',
            children: (
              <Card>
                <Table
                  rowKey="supplierId"
                  size="small"
                  pagination={false}
                  loading={summary.isLoading}
                  dataSource={summary.data?.suppliers}
                  locale={{ emptyText: 'Tidak ada uang muka terbuka' }}
                  columns={[
                    { title: 'Pemasok', render: (_, s) => `${s.supplierCode} · ${s.supplierName}` },
                    { title: 'Jumlah DP', dataIndex: 'count', align: 'right' },
                    { title: 'Tertua', dataIndex: 'oldest', render: (v: string | null) => (v ? fmtDate(v) : '-') },
                    { title: 'Saldo uang muka', dataIndex: 'open', align: 'right', render: (v: string) => <b>{fmtMoney(v)}</b> },
                    { title: 'Faktur terbuka pemasok ini', dataIndex: 'openInvoices', align: 'right', render: (v: string) => (Number(v) > 0 ? <Typography.Text type="warning">{fmtMoney(v)}</Typography.Text> : '-') },
                  ]}
                />
              </Card>
            ),
          },
          ...(showControls
            ? [
                {
                  key: 'kontrol',
                  label: `Kontrol${findings ? ` (${findings})` : ''}`,
                  children: <ControlsView data={controls.data} loading={controls.isLoading} />,
                },
              ]
            : []),
        ]}
      />
      <CreateModal open={creating} onClose={() => setCreating(false)} />
      <DetailDrawer id={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}

function ControlsView({ data, loading }: { data?: Control[]; loading: boolean }) {
  if (loading) return null;
  const items = (data ?? []).filter((c) => c.items.length);
  if (!items.length) return <Alert type="success" showIcon message="Tidak ada temuan saat ini." />;
  return (
    <>
      {items.map((c) => (
        <Card key={c.key} size="small" style={{ marginBottom: 12 }} title={<span><Tag color={SEV[c.severity]}>{c.items.length}</Tag> {c.title}</span>}>
          <Table
            size="small"
            pagination={{ pageSize: 5 }}
            rowKey={(r) => JSON.stringify(r)}
            dataSource={c.items}
            columns={Object.keys(c.items[0]).map((k) => ({
              title: COL[k] ?? k,
              dataIndex: k,
              render: (v: unknown) => (k === 'remaining' || k === 'openInvoices' ? fmtMoney(String(v)) : k === 'date' ? fmtDate(String(v)) : String(v ?? '-')),
            }))}
          />
        </Card>
      ))}
    </>
  );
}

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const suppliers = useSuppliers();
  const supplierId = Form.useWatch('supplierId', form) as string | undefined;
  const pos = useQuery({
    queryKey: ['purchase-orders', 'confirmed', supplierId],
    queryFn: () => get<{ id: string; number: string; total: string; currency: string }[]>(`/purchase-orders?supplierId=${supplierId}&status=CONFIRMED`),
    enabled: open && !!supplierId,
  });
  const method = Form.useWatch('method', form) ?? 'TRANSFER';
  const save = useAction(
    (v: { supplierId: string; purchaseOrderId?: string; amount: number; date: string; method: string; cashAccountId?: string; description?: string }) =>
      post<{ number: string; journalNumber: string }>('/supplier-advances', { ...v, amount: String(v.amount) }),
    { success: (r) => `Uang muka ${r.number} dicatat · jurnal ${r.journalNumber}`, invalidate: INVALIDATE, onSuccess: () => { form.resetFields(); onClose(); } },
  );
  return (
    <Modal title="Bayar uang muka ke pemasok" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Catat uang muka" confirmLoading={save.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ date: today(), method: 'TRANSFER' }} onFinish={(v) => save.mutate(v)}>
        <Form.Item name="supplierId" label="Pemasok" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" onChange={() => form.setFieldValue('purchaseOrderId', undefined)} options={(suppliers.data ?? []).filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
        </Form.Item>
        <Form.Item name="purchaseOrderId" label="Pesanan pembelian (dianjurkan)" extra="Hanya pesanan yang sudah dikonfirmasi dan belum difakturkan. Tanpa pesanan, uang muka staf menunggu persetujuan.">
          <Select allowClear disabled={!supplierId} placeholder={supplierId ? 'Pilih pesanan' : 'Pilih pemasok dulu'} loading={pos.isLoading} options={(pos.data ?? []).filter((p) => p.currency === 'IDR').map((p) => ({ value: p.id, label: `${p.number} · ${fmtMoney(p.total)}` }))} />
        </Form.Item>
        <Form.Item name="amount" label="Jumlah" rules={[{ required: true, type: 'number', min: 1, message: 'Isi jumlah' }]}>
          <InputNumber {...rupiahInput} min={1} style={{ width: 240 }} prefix="Rp" />
        </Form.Item>
        <Space wrap>
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}><Input type="date" max={today()} style={{ width: 170 }} /></Form.Item>
          <Form.Item name="method" label="Dibayar"><Segmented options={[{ value: 'TRANSFER', label: 'Transfer' }, { value: 'CASH', label: 'Tunai' }]} /></Form.Item>
        </Space>
        <Form.Item name="cashAccountId" label="Dari rekening/kas" extra={`Kosong = ${method === 'CASH' ? 'Kas' : 'Bank'} utama`}><CashAccountSelect allowClear /></Form.Item>
        <Form.Item name="description" label="Keterangan"><Input maxLength={255} /></Form.Item>
      </Form>
    </Modal>
  );
}

function DetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const q = useQuery({ queryKey: [KEY, 'detail', id], queryFn: () => get<Advance & { movements: Movement[] }>(`/supplier-advances/${id}`), enabled: !!id });
  const a = q.data;
  const [mode, setMode] = useState<'apply' | 'refund' | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const voidIt = useAction((v: { reason: string }) => post(`/supplier-advances/${id}/void`, v), { success: 'Uang muka dibatalkan; jurnal dibalik', invalidate: INVALIDATE, onSuccess: onClose });
  const canMove = a?.status === 'OPEN';
  return (
    <Drawer title={a ? `${a.number} — ${a.supplierName}` : ''} open={!!id} onClose={onClose} width={Math.min(640, window.innerWidth)} destroyOnHidden>
      {a && (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Tanggal">{fmtDate(a.date)}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={STATUS_TAG[a.status]?.color}>{STATUS_TAG[a.status]?.label}</Tag></Descriptions.Item>
            <Descriptions.Item label="Pesanan">{a.purchaseOrderNumber ?? 'tanpa pesanan'}</Descriptions.Item>
            <Descriptions.Item label="Dicatat oleh">{a.createdByName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Dibayar">{fmtMoney(a.amount)}</Descriptions.Item>
            <Descriptions.Item label="Sisa"><b>{fmtMoney(a.remaining)}</b></Descriptions.Item>
            <Descriptions.Item label="Dipakai">{fmtMoney(a.appliedAmount)}</Descriptions.Item>
            <Descriptions.Item label="Dikembalikan">{fmtMoney(a.refundedAmount)}</Descriptions.Item>
            {a.description && <Descriptions.Item label="Keterangan" span={2}>{a.description}</Descriptions.Item>}
          </Descriptions>
          {canMove && (
            <Space wrap style={{ marginBottom: 16 }}>
              {can('POST', '/supplier-advances/:id/apply') && <Button type="primary" onClick={() => setMode('apply')}>Perhitungkan ke faktur</Button>}
              {can('POST', '/supplier-advances/:id/refund') && <Button onClick={() => setMode('refund')}>Pemasok mengembalikan</Button>}
              {can('POST', '/supplier-advances/:id/void') && Number(a.appliedAmount) === 0 && Number(a.refundedAmount) === 0 && (
                <Popconfirm
                  title="Batalkan uang muka ini?"
                  description={<Input placeholder="Alasan (min. 5 huruf)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />}
                  okText="Batalkan"
                  okButtonProps={{ danger: true, disabled: voidReason.trim().length < 5, loading: voidIt.isPending }}
                  onConfirm={() => voidIt.mutate({ reason: voidReason.trim() })}
                >
                  <Button danger>Batalkan</Button>
                </Popconfirm>
              )}
            </Space>
          )}
          <Typography.Title level={5}>Riwayat pemakaian</Typography.Title>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={a.movements}
            locale={{ emptyText: 'Belum dipakai atau dikembalikan' }}
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
              { title: 'Jenis', dataIndex: 'kind', render: (v: string) => (v === 'APPLY' ? <Tag color="blue">Dipakai ke faktur</Tag> : <Tag color="green">Dikembalikan</Tag>) },
              { title: 'Keterangan', render: (_, m: Movement) => (m.kind === 'APPLY' ? `${m.invoiceNumber}${m.supplierInvoiceNo ? ` (${m.supplierInvoiceNo})` : ''}` : m.note) },
              { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
            ]}
          />
          <ApplyModal advance={mode === 'apply' ? a : null} onClose={() => setMode(null)} />
          <RefundModal advance={mode === 'refund' ? a : null} onClose={() => setMode(null)} />
        </>
      )}
    </Drawer>
  );
}

interface PInvoice { id: string; number: string; supplierInvoiceNo: string; total: string; paidAmount: string; returnedAmount: string; status: string; currency: string; purchaseOrderId?: string | null; dueDate: string }

function ApplyModal({ advance, onClose }: { advance: Advance | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const invoices = useQuery({
    queryKey: ['purchase-invoices', 'by-supplier', advance?.supplierId],
    queryFn: () => get<PInvoice[]>(`/purchase-invoices?supplierId=${advance!.supplierId}`),
    enabled: !!advance,
  });
  const open = (invoices.data ?? [])
    .filter((i) => i.status !== 'PAID' && i.currency === 'IDR' && (!advance?.purchaseOrderId || i.purchaseOrderId === advance.purchaseOrderId))
    .map((i) => ({ ...i, outstanding: Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount) }))
    .filter((i) => i.outstanding > 0);
  const invId = Form.useWatch('purchaseInvoiceId', form) as string | undefined;
  const maxAmt = Math.min(Number(advance?.remaining ?? 0), open.find((i) => i.id === invId)?.outstanding ?? Number(advance?.remaining ?? 0));
  const save = useAction(
    (v: { purchaseInvoiceId: string; amount: number; date: string }) => post<{ invoice: string; remaining: string }>(`/supplier-advances/${advance!.id}/apply`, { ...v, amount: String(v.amount) }),
    { success: (r) => `Dipakai ke faktur ${r.invoice} · sisa uang muka ${fmtMoney(r.remaining)}`, invalidate: INVALIDATE, onSuccess: () => { form.resetFields(); onClose(); } },
  );
  return (
    <Modal title="Perhitungkan uang muka ke faktur" open={!!advance} onCancel={onClose} onOk={() => form.submit()} okText="Perhitungkan" confirmLoading={save.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ date: today() }} onFinish={(v) => save.mutate(v)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Sisa uang muka ${fmtMoney(advance?.remaining ?? 0)}${advance?.purchaseOrderNumber ? ` · hanya untuk faktur dari ${advance.purchaseOrderNumber}` : ''}`} />
        <Form.Item name="purchaseInvoiceId" label="Faktur pembelian (belum lunas)" rules={[{ required: true }]}>
          <Select loading={invoices.isLoading} placeholder={open.length ? 'Pilih faktur' : 'Tidak ada faktur terbuka untuk pemasok ini'} options={open.map((i) => ({ value: i.id, label: `${i.number} · ${i.supplierInvoiceNo} · sisa ${fmtMoney(i.outstanding)}` }))} onChange={(v) => form.setFieldValue('amount', Math.min(Number(advance?.remaining ?? 0), open.find((i) => i.id === v)?.outstanding ?? 0))} />
        </Form.Item>
        <Form.Item name="amount" label="Jumlah dipakai" rules={[{ required: true, type: 'number', min: 1, max: maxAmt || undefined, message: `1 s.d. ${fmtMoney(maxAmt)}` }]}>
          <InputNumber {...rupiahInput} min={1} max={maxAmt || undefined} style={{ width: 240 }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="date" label="Tanggal"><Input type="date" max={today()} min={advance?.date} style={{ width: 170 }} /></Form.Item>
      </Form>
    </Modal>
  );
}

function RefundModal({ advance, onClose }: { advance: Advance | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const save = useAction(
    (v: { amount: number; date: string; cashAccountId?: string; note: string }) => post<{ remaining: string }>(`/supplier-advances/${advance!.id}/refund`, { ...v, amount: String(v.amount) }),
    { success: (r) => `Pengembalian dicatat · sisa uang muka ${fmtMoney(r.remaining)}`, invalidate: INVALIDATE, onSuccess: () => { form.resetFields(); onClose(); } },
  );
  return (
    <Modal title="Pemasok mengembalikan uang muka" open={!!advance} onCancel={onClose} onOk={() => form.submit()} okText="Catat pengembalian" confirmLoading={save.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ date: today() }} onFinish={(v) => save.mutate(v)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Sisa uang muka ${fmtMoney(advance?.remaining ?? 0)}. Uang masuk ke rekening/kas yang dipilih.`} />
        <Form.Item name="amount" label="Jumlah dikembalikan" rules={[{ required: true, type: 'number', min: 1, max: Number(advance?.remaining ?? 0) || undefined }]}>
          <InputNumber {...rupiahInput} min={1} max={Number(advance?.remaining ?? 0) || undefined} style={{ width: 240 }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="cashAccountId" label="Diterima di rekening/kas" extra="Kosong = rekening yang dipakai membayar uang muka"><CashAccountSelect allowClear /></Form.Item>
        <Form.Item name="date" label="Tanggal"><Input type="date" max={today()} min={advance?.date} style={{ width: 170 }} /></Form.Item>
        <Form.Item name="note" label="Alasan / bukti pengembalian" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={2} maxLength={255} /></Form.Item>
      </Form>
    </Modal>
  );
}
