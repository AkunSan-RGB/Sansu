import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction, useSuppliers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import QueryState from '@/components/QueryState';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PurchaseRequestStatusTag } from './PurchaseRequestsPage';
import type { PurchaseRequest } from './requestTypes';

const KEYS = ['purchase-requests', 'purchase-orders', 'reminders'];

export default function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const can = useCan();
  const { data: suppliers } = useSuppliers();
  const approver = !!me && ['OWNER', 'ADMIN'].includes(me.role);
  const q = useQuery({ queryKey: ['purchase-requests', 'detail', id], queryFn: () => get<PurchaseRequest>(`/purchase-requests/${id}`) });
  const r = q.data;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [converting, setConverting] = useState(false);
  const [over, setOver] = useState<Record<string, { supplierId?: string; price?: number }>>({});
  const act = (path: string, success: string, body: object = {}) => useAction(() => post(`/purchase-requests/${id}/${path}`, body), { success, invalidate: KEYS });
  const submit = act('submit', 'Permintaan diajukan');
  const approve = act('approve', 'Permintaan disetujui');
  const cancel = act('cancel', 'Permintaan dibatalkan');
  const reject = useAction(() => post(`/purchase-requests/${id}/reject`, { note: reason }), { success: 'Permintaan ditolak', invalidate: KEYS, onSuccess: () => setRejecting(false) });
  const convert = useAction(
    () =>
      post(`/purchase-requests/${id}/convert`, {
        lines: Object.entries(over).map(([lineId, v]) => ({ lineId, supplierId: v.supplierId, price: v.price != null ? String(v.price) : undefined })),
      }),
    { success: 'PO draft dibuat per supplier', invalidate: KEYS, onSuccess: () => setConverting(false) },
  );
  const open = r?.lines.filter((l) => !l.order) ?? [];
  return (
    <>
      <PageHeader
        title={r ? `Permintaan pembelian ${r.number}` : 'Permintaan pembelian'}
        extra={
          r && (
            <Space wrap>
              {r.status === 'DRAFT' && can('POST', '/purchase-requests/:id/submit') && (
                <Button type="primary" loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
                  Ajukan
                </Button>
              )}
              {r.status === 'SUBMITTED' && approver && can('POST', '/purchase-requests/:id/approve') && (
                <Button type="primary" loading={approve.isPending} onClick={() => approve.mutate(undefined)}>
                  Setujui
                </Button>
              )}
              {r.status === 'SUBMITTED' && approver && can('POST', '/purchase-requests/:id/reject') && (
                <Button danger onClick={() => setRejecting(true)}>
                  Tolak
                </Button>
              )}
              {r.status === 'APPROVED' && can('POST', '/purchase-requests/:id/convert') && (
                <Button type="primary" onClick={() => setConverting(true)}>
                  Buat PO
                </Button>
              )}
              {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status) && can('POST', '/purchase-requests/:id/cancel') && !r.lines.some((l) => l.order) && (
                <Popconfirm title="Batalkan permintaan ini?" onConfirm={() => cancel.mutate(undefined)}>
                  <Button>Batalkan</Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      />
      <QueryState q={q}>
        {(r) => (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {r.status === 'SUBMITTED' && !approver && <Alert type="info" showIcon message="Menunggu persetujuan pemilik / admin. Mereka sudah diberi tahu (lonceng dan email bila diaktifkan)." />}
            {r.status === 'APPROVED' && <Alert type="success" showIcon message={r.autoApproved ? 'Disetujui otomatis (nilai di bawah batas). Bagian pembelian bisa langsung membuat PO.' : 'Disetujui. Bagian pembelian bisa langsung membuat PO.'} />}
            {r.status === 'REJECTED' && <Alert type="error" showIcon message={`Ditolak: ${r.decisionNote ?? '-'}`} />}
            <Card>
              <Descriptions column={{ xs: 1, md: 2 }} size="small">
                <Descriptions.Item label="Status">
                  <PurchaseRequestStatusTag status={r.status} />
                </Descriptions.Item>
                <Descriptions.Item label="Tanggal">{fmtDate(r.date)}</Descriptions.Item>
                <Descriptions.Item label="Gudang">{r.warehouse.name}</Descriptions.Item>
                <Descriptions.Item label="Dibutuhkan">{r.neededBy ? fmtDate(r.neededBy) : '-'}</Descriptions.Item>
                <Descriptions.Item label="Peminta">{r.requestedBy ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="Diputuskan oleh">{r.decidedBy ?? (r.autoApproved ? 'Otomatis' : '-')}</Descriptions.Item>
                <Descriptions.Item label="Perkiraan nilai (DPP)">{r.estimatedTotal ? `${fmtMoney(r.estimatedTotal)}${r.estimateComplete ? '' : ' (sebagian harga belum diketahui)'}` : 'Belum diketahui'}</Descriptions.Item>
                {r.notes && <Descriptions.Item label="Catatan">{r.notes}</Descriptions.Item>}
              </Descriptions>
            </Card>
            <Card title="Barang diminta">
              <ResponsiveTable
                rowKey="id"
                dataSource={r.lines}
                pagination={false}
                scroll={{ x: 720 }}
                columns={[
                  { title: 'Barang', render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                  { title: 'Jumlah', align: 'right', render: (_, l) => `${Number(l.qty)} ${l.uom}` },
                  { title: 'Supplier', render: (_, l) => l.supplier?.name ?? '-' },
                  { title: 'Perkiraan harga', align: 'right', render: (_, l) => (l.estPrice != null ? fmtMoney(l.estPrice) : '-') },
                  { title: 'PO', render: (_, l) => (l.order ? <Link to={`/purchase-orders/${l.order.id}`}>{l.order.number}</Link> : '-') },
                ]}
              />
            </Card>
          </Space>
        )}
      </QueryState>
      <Modal open={rejecting} title="Tolak permintaan" okText="Tolak" okButtonProps={{ danger: true, disabled: !reason.trim(), loading: reject.isPending }} onCancel={() => setRejecting(false)} onOk={() => reject.mutate(undefined)}>
        <Form layout="vertical">
          <Form.Item label="Alasan penolakan (dilihat peminta)" required>
            <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={converting} width={860} title="Buat PO dari permintaan" okText="Buat PO draft" okButtonProps={{ loading: convert.isPending }} onCancel={() => setConverting(false)} onOk={() => convert.mutate(undefined)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Satu PO draft dibuat untuk setiap supplier. Supplier dan harga yang kosong diambil dari pembelian terakhir; isi di sini bila belum pernah dibeli." />
        <ResponsiveTable
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={open}
          scroll={{ x: 700 }}
          columns={[
            { title: 'Barang', render: (_, l) => `${l.product.sku} · ${l.product.name} (${Number(l.qty)} ${l.uom})` },
            {
              title: 'Supplier',
              width: 220,
              render: (_, l) => (
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 210 }}
                  placeholder="Pilih supplier"
                  value={over[l.id]?.supplierId ?? l.supplierId ?? undefined}
                  onChange={(v) => setOver({ ...over, [l.id]: { ...over[l.id], supplierId: v } })}
                  options={suppliers?.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))}
                />
              ),
            },
            {
              title: 'Harga / satuan',
              width: 160,
              render: (_, l) => <InputNumber size="small" min={0} style={{ width: 140 }} placeholder={l.estPrice != null ? fmtMoney(l.estPrice) : 'otomatis'} value={over[l.id]?.price} onChange={(v) => setOver({ ...over, [l.id]: { ...over[l.id], price: v ?? undefined } })} />,
            },
          ]}
        />
      </Modal>
    </>
  );
}
