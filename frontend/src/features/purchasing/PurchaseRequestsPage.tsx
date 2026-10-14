import { BulbOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { useAction, useSuppliers, useWarehouses } from '@/api/queries';
import ListPage from '@/components/ListPage';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PR_STATUS, type PurchaseRequest, type PurchaseRequestRow, type PurchaseRequestStatus, type Suggestion } from './requestTypes';

export const PurchaseRequestStatusTag = ({ status }: { status: PurchaseRequestStatus }) => <Tag color={PR_STATUS[status].color}>{PR_STATUS[status].label}</Tag>;

/** Usulan pembelian dari persediaan minimum: pilih barang, atur jumlah & supplier, lalu ajukan sebagai satu permintaan */
function SuggestionsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: warehouses } = useWarehouses();
  const { data: suppliers } = useSuppliers();
  const [wh, setWh] = useState<string>();
  const q = useQuery({ queryKey: ['purchase-requests', 'suggestions', wh], queryFn: () => get<Suggestion[]>(`/purchase-requests/suggestions${qs({ warehouseId: wh })}`), enabled: open });
  const [picked, setPicked] = useState<React.Key[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [sup, setSup] = useState<Record<string, string | undefined>>({});
  const key = (s: Suggestion) => `${s.productId}:${s.warehouseId}`;
  const rows = (q.data ?? []).filter((s) => picked.includes(key(s)));
  const warehouseIds = [...new Set(rows.map((s) => s.warehouseId))];
  const create = useAction(
    async () => {
      // satu permintaan per gudang
      const made: PurchaseRequest[] = [];
      for (const w of warehouseIds) {
        made.push(
          await post<PurchaseRequest>('/purchase-requests', {
            warehouseId: w,
            submit: true,
            notes: 'Dari usulan stok minimum',
            lines: rows
              .filter((s) => s.warehouseId === w)
              .map((s) => ({ productId: s.productId, qty: String(qty[key(s)] ?? s.suggestedQty), supplierId: sup[key(s)] ?? s.supplierId ?? undefined, estPrice: s.lastPrice != null ? String(s.lastPrice) : undefined })),
          }),
        );
      }
      return made;
    },
    {
      success: (r) => `${r.length} permintaan pembelian dibuat`,
      invalidate: ['purchase-requests'],
      onSuccess: (r) => {
        onClose();
        navigate(r.length === 1 ? `/purchase-requests/${r[0].id}` : '/purchase-requests');
      },
    },
  );
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Usulan pembelian dari persediaan minimum"
      width={980}
      okText={`Ajukan ${rows.length || ''} barang`}
      okButtonProps={{ disabled: !rows.length, loading: create.isPending }}
      onOk={() => create.mutate(undefined)}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Barang yang stoknya, ditambah pesanan berjalan dan permintaan yang sudah diajukan, masih di bawah minimum. Jumlah usulan memenuhi sampai 2× stok minimum; supplier dan harga diambil dari pembelian terakhir." />
      <Select allowClear placeholder="Semua gudang" style={{ width: 260, marginBottom: 12 }} value={wh} onChange={setWh} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
      <ResponsiveTable
        rowKey={key}
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        pagination={false}
        locale={{ emptyText: 'Tidak ada barang di bawah stok minimum' }}
        scroll={{ x: 880 }}
        rowSelection={{ selectedRowKeys: picked, onChange: setPicked }}
        columns={[
          { title: 'Barang', render: (_, s: Suggestion) => `${s.sku} · ${s.name}` },
          { title: 'Gudang', dataIndex: 'warehouseCode', width: 90 },
          { title: 'Stok', align: 'right', width: 80, render: (_, s: Suggestion) => s.onHand },
          { title: 'Minimum', align: 'right', width: 90, dataIndex: 'minQty' },
          { title: 'Dipesan / diminta', align: 'right', width: 120, render: (_, s: Suggestion) => s.onOrder + s.requested },
          {
            title: 'Jumlah',
            width: 110,
            render: (_, s: Suggestion) => (
              <input type="number" min={1} style={{ width: 90, textAlign: 'right' }} value={qty[key(s)] ?? s.suggestedQty} onChange={(e) => setQty({ ...qty, [key(s)]: Number(e.target.value) })} />
            ),
          },
          {
            title: 'Supplier',
            width: 200,
            render: (_, s: Suggestion) => (
              <Select
                size="small"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Tentukan nanti"
                style={{ width: 190 }}
                value={sup[key(s)] ?? s.supplierId ?? undefined}
                onChange={(v) => setSup({ ...sup, [key(s)]: v })}
                options={suppliers?.filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.name }))}
              />
            ),
          },
          { title: 'Harga terakhir', align: 'right', width: 110, render: (_, s: Suggestion) => (s.lastPrice != null ? fmtMoney(s.lastPrice) : '-') },
        ]}
      />
    </Modal>
  );
}

export default function PurchaseRequestsPage() {
  const navigate = useNavigate();
  const [sug, setSug] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['purchase-requests', 'all'], queryFn: () => get<PurchaseRequestRow[]>('/purchase-requests') });
  return (
    <>
      <ListPage<PurchaseRequestRow>
        title="Permintaan pembelian"
        actions={
          <>
            <Button icon={<BulbOutlined />} onClick={() => setSug(true)}>
              Usulan dari stok minimum
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/purchase-requests/new')}>
              Permintaan baru
            </Button>
          </>
        }
        rows={data}
        loading={isLoading}
        summary={(rows) => {
          const waiting = rows.filter((r) => r.status === 'SUBMITTED');
          const approved = rows.filter((r) => r.status === 'APPROVED');
          return [
            { label: 'Menunggu persetujuan', value: String(waiting.length), hint: 'perlu diputuskan', tone: waiting.length ? 'warn' : 'neutral' },
            { label: 'Disetujui, belum jadi PO', value: String(approved.length), hint: 'siap dipesan ke supplier', tone: approved.length ? 'good' : 'neutral' },
            { label: 'Masih draf', value: String(rows.filter((r) => r.status === 'DRAFT').length), hint: 'belum diajukan' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          ...(Object.keys(PR_STATUS) as PurchaseRequestStatus[]).map((k) => ({ value: k, label: PR_STATUS[k].label, test: (r: PurchaseRequestRow) => r.status === k })),
        ]}
        searchText={(r) => `${r.number} ${r.warehouse.name} ${r.requestedBy ?? ''}`}
        searchPlaceholder="Cari nomor atau peminta"
        emptyText="Belum ada permintaan pembelian"
        onRowClick={(r) => navigate(`/purchase-requests/${r.id}`)}
        scrollX={820}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'Gudang', render: (_, r) => r.warehouse.name },
          { title: 'Peminta', dataIndex: 'requestedBy', render: (v) => v ?? '-' },
          { title: 'Dibutuhkan', dataIndex: 'neededBy', render: (v) => (v ? fmtDate(v) : '-') },
          { title: 'Barang', align: 'right', render: (_, r) => (r.orderedCount ? `${r.orderedCount}/${r.lineCount} dipesan` : r.lineCount) },
          { title: 'Status', render: (_, r) => <PurchaseRequestStatusTag status={r.status} /> },
        ]}
      />
      <SuggestionsModal open={sug} onClose={() => setSug(false)} />
    </>
  );
}
