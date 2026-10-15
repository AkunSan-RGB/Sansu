import ResponsiveTable from '@/components/ResponsiveTable';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCustomers, useProducts, useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface Stock {
  warehouseId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  items: { productId: string; sku: string; name: string; uom: string; qty: string; cost: string }[];
  costValue: string;
  sellValue: string;
  lastShip: string | null;
  lastReport: string | null;
  pendingReports: number;
  daysSinceReport: number | null;
  stale: boolean;
  staleDays: number;
}
interface Doc {
  id: string;
  number: string;
  kind: 'SHIP' | 'REPORT' | 'RETURN';
  date: string;
  customerName: string;
  reference: string | null;
  status: 'DONE' | 'REPORTED' | 'INVOICED' | 'REJECTED';
  lines: { productId: string; uom: string; qty: string }[];
  notes: string | null;
  rejectReason: string | null;
}
const KIND = { SHIP: 'Kirim titipan', REPORT: 'Laporan penjualan outlet', RETURN: 'Tarik titipan' };
const STATUS: Record<Doc['status'], { color: string; text: string }> = { DONE: { color: 'green', text: 'Selesai' }, REPORTED: { color: 'gold', text: 'Menunggu ditagih' }, INVOICED: { color: 'blue', text: 'Sudah ditagih' }, REJECTED: { color: 'red', text: 'Ditolak' } };
type Mode = 'ship' | 'report' | 'return';
interface FormValues { customerId: string; warehouseId?: string; reference?: string; notes?: string; lines: { productId?: string; qty?: number }[] }

/** Konsinyasi: titipan di outlet tetap milik kita; penjualan baru diakui saat laporan outlet diperiksa dan ditagih */
export default function ConsignmentsPage() {
  const can = useCan();
  const { data: stock } = useQuery({ queryKey: ['consignments'], queryFn: () => get<Stock[]>('/consignments/stock') });
  const { data: docs, isLoading } = useQuery({ queryKey: ['consignment-docs'], queryFn: () => get<Doc[]>('/consignments/docs') });
  const { data: customers } = useCustomers();
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const [mode, setMode] = useState<Mode | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [rejecting, setRejecting] = useState<Doc | null>(null);
  const [rejForm] = Form.useForm<{ reason: string }>();
  const inv = ['consignments', 'consignment-docs', 'stock', 'stock-moves', 'invoices', 'sales-orders', 'dashboard'];
  const submit = useAction(
    (v: FormValues) => {
      const lines = v.lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId!, qty: String(l.qty) }));
      if (mode === 'ship') return post('/consignments/ship', { customerId: v.customerId, fromWarehouseId: v.warehouseId, notes: v.notes, lines });
      if (mode === 'return') return post('/consignments/return', { customerId: v.customerId, toWarehouseId: v.warehouseId, notes: v.notes, lines });
      return post('/consignments/reports', { customerId: v.customerId, reference: v.reference, notes: v.notes, lines });
    },
    { success: 'Tersimpan', invalidate: inv, onSuccess: () => setMode(null) },
  );
  const invoice = useAction((id: string) => post<{ invoiceNumber: string }>(`/consignments/reports/${id}/invoice`), { success: (r) => `Faktur ${r.invoiceNumber} dibuat`, invalidate: [...inv, 'reports'] });
  const reject = useAction((v: { id: string; reason: string }) => post(`/consignments/reports/${v.id}/reject`, { reason: v.reason }), { success: 'Laporan ditolak', invalidate: inv, onSuccess: () => setRejecting(null) });
  const open = (m: Mode) => { form.resetFields(); form.setFieldsValue({ lines: [{}] }); setMode(m); };
  const mains = (warehouses ?? []).filter((w) => !w.kind || w.kind === 'MAIN');
  const outlets = (customers ?? []).filter((c) => c.isActive);
  const TITLE = { ship: 'Kirim titipan ke outlet', report: 'Catat laporan penjualan outlet', return: 'Tarik sisa titipan' };
  return (
    <>
      <PageHeader title="Konsinyasi" extra={
        <Space wrap>
          {can('POST', '/consignments/ship') && <Button icon={<PlusOutlined />} onClick={() => open('ship')}>Kirim titipan</Button>}
          {can('POST', '/consignments/reports') && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('report')}>Laporan penjualan outlet</Button>}
          {can('POST', '/consignments/return') && <Button onClick={() => open('return')}>Tarik titipan</Button>}
        </Space>
      } />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Barang titipan tetap milik kita dan tetap tercatat di persediaan (gudang konsinyasi outlet). Pendapatan baru diakui saat laporan penjualan dari outlet diperiksa lalu ditagih oleh Keuangan/Admin (orang berbeda dari pencatat laporan). Nomor laporan outlet tidak boleh dipakai dua kali." />
      <Card title="Stok titipan di outlet" style={{ marginBottom: 12 }}>
        <Table<Stock> rowKey="warehouseId" size="small" pagination={false} dataSource={stock} scroll={{ x: 700 }} locale={{ emptyText: 'Belum ada barang titipan' }}
          expandable={{ expandedRowRender: (s) => <Table size="small" rowKey="productId" pagination={false} dataSource={s.items} columns={[{ title: 'Produk', render: (_: unknown, i: Stock['items'][number]) => `${i.sku} · ${i.name}` }, { title: 'Jumlah', align: 'right' as const, render: (_: unknown, i: Stock['items'][number]) => `${fmtQty(i.qty)} ${i.uom}` }, { title: 'Nilai (HPP)', align: 'right' as const, render: (_: unknown, i: Stock['items'][number]) => fmtMoney(i.cost) }]} /> }}
          columns={[
            { title: 'Outlet', render: (_: unknown, s: Stock) => <div><Typography.Text strong>{s.customerName}</Typography.Text><div style={{ fontSize: 12, color: '#64748b' }}>{s.customerCode}</div></div> },
            { title: 'Nilai titipan (HPP)', align: 'right' as const, render: (_: unknown, s: Stock) => fmtMoney(s.costValue) },
            { title: 'Dikirim terakhir', render: (_: unknown, s: Stock) => fmtDate(s.lastShip) },
            { title: 'Dilaporkan terakhir', render: (_: unknown, s: Stock) => fmtDate(s.lastReport) },
            { title: 'Status', render: (_: unknown, s: Stock) => <Space>{s.stale ? <Tag color="red">Macet {s.daysSinceReport} hari tanpa laporan</Tag> : <Tag color="green">Lancar</Tag>}{s.pendingReports > 0 && <Tag color="gold">{s.pendingReports} laporan menunggu</Tag>}</Space> },
          ]} />
      </Card>
      <Card title="Dokumen konsinyasi">
        <ResponsiveTable<Doc> rowKey="id" size="small" loading={isLoading} dataSource={docs} pagination={{ pageSize: 10 }} scroll={{ x: 760 }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Jenis', render: (_: unknown, d: Doc) => KIND[d.kind] },
            { title: 'Tanggal', render: (_: unknown, d: Doc) => fmtDate(d.date) },
            { title: 'Outlet', dataIndex: 'customerName' },
            { title: 'No. laporan outlet', render: (_: unknown, d: Doc) => d.reference ?? '-' },
            { title: 'Status', render: (_: unknown, d: Doc) => <Tag color={STATUS[d.status].color}>{STATUS[d.status].text}</Tag> },
            { title: '', render: (_: unknown, d: Doc) => d.status === 'REPORTED' && (
              <Space>
                {can('POST', '/consignments/reports/:id/invoice') && <Popconfirm title="Tagih laporan ini?" description="Faktur dibuat dari stok titipan outlet dengan harga daftar harga outlet." okText="Tagih" cancelText="Batal" onConfirm={() => invoice.mutate(d.id)}><Button size="small" type="primary" loading={invoice.isPending}>Tagih</Button></Popconfirm>}
                {can('POST', '/consignments/reports/:id/reject') && <Button size="small" danger onClick={() => { rejForm.resetFields(); setRejecting(d); }}>Tolak</Button>}
              </Space>
            ) },
          ]} />
      </Card>
      <Modal title={mode ? TITLE[mode] : ''} open={!!mode} onCancel={() => setMode(null)} onOk={() => form.submit()} confirmLoading={submit.isPending} okText="Simpan" destroyOnHidden width={620}>
        <Form form={form} layout="vertical" onFinish={(v) => submit.mutate(v)}>
          <Form.Item name="customerId" label="Outlet" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={outlets.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          {mode !== 'report' && <Form.Item name="warehouseId" label={mode === 'ship' ? 'Dari gudang' : 'Ke gudang'} rules={[{ required: true }]}><Select options={mains.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Form.Item>}
          {mode === 'report' && <Form.Item name="reference" label="Nomor laporan penjualan dari outlet" rules={[{ required: true, min: 3 }]} extra="Unik per outlet; mencegah laporan yang sama ditagih dua kali"><Input /></Form.Item>}
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih produk' }]}><Select showSearch optionFilterProp="label" style={{ width: 340 }} placeholder="Produk" options={(products ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
                    <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Jumlah' }]}><InputNumber min={0.0001} placeholder="Jumlah (satuan dasar)" style={{ width: 170 }} /></Form.Item>
                    {fields.length > 1 && <Button type="text" danger onClick={() => remove(f.name)}>Hapus</Button>}
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add({})}>+ Tambah produk</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Catatan" style={{ marginTop: 12 }}><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Tolak laporan outlet" open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => rejForm.submit()} confirmLoading={reject.isPending} okText="Tolak" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={rejForm} layout="vertical" onFinish={(v) => reject.mutate({ id: rejecting!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
