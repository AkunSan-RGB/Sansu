import { ArrowRightOutlined, CarOutlined, SwapOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Select, Tag } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney } from '@/lib/format';
import { TransferStatus } from './transfers/shared';
import { NewTransfer } from './transfers/NewTransfer';
import { TransferDoc } from './transfers/TransferDoc';

const STATUS: Record<TransferStatus, { label: string; color: string }> = {
  IN_TRANSIT: { label: 'Dalam perjalanan', color: 'gold' },
  RECEIVED: { label: 'Diterima', color: 'green' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};

interface TransferRow {
  id: string;
  number: string;
  date: string;
  status: TransferStatus;
  receivedDate: string | null;
  fromWarehouseId: string;
  toWarehouseId: string;
  notes: string | null;
  totalValue: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  lines: number;
  createdBy: string | null;
}

/** Transfer barang antar gudang + surat jalan transfer */
export default function TransfersPage() {
  const [params, setParams] = useSearchParams();
  const [warehouseId, setWarehouseId] = useState<string>();
  const can = useCan();
  const [open, setOpen] = useState(params.get('new') === '1');
  const detailId = params.get('id');
  const { data: warehouses } = useWarehouses();
  const list = useQuery({
    queryKey: ['transfers', warehouseId],
    queryFn: () => get<TransferRow[]>(`/inventory/transfers${qs({ warehouseId })}`),
  });
  const transit = (list.data ?? []).filter((r) => r.status === 'IN_TRANSIT').length;

  return (
    <>
      <ListPage<TransferRow>
        title="Transfer antar gudang"
        actions={
          <>
            <Select
              allowClear
              placeholder="Semua gudang"
              style={{ width: 220 }}
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
            />
            {can('POST', '/inventory/transfers') && (
              <Button type="primary" icon={<SwapOutlined />} onClick={() => setOpen(true)} disabled={(warehouses?.length ?? 0) < 2}>
                Transfer baru
              </Button>
            )}
          </>
        }
        rows={list.data}
        loading={list.isLoading}
        summary={(rows) => {
          const going = rows.filter((r) => r.status === 'IN_TRANSIT');
          const got = rows.filter((r) => r.status === 'RECEIVED');
          const val = (xs: TransferRow[]) => xs.reduce((a, r) => a + Number(r.totalValue), 0);
          return [
            { label: 'Dalam perjalanan', value: String(going.length), hint: `senilai ${fmtMoney(val(going))}`, tone: going.length ? 'warn' : 'neutral' },
            { label: 'Sudah diterima', value: String(got.length), hint: `senilai ${fmtMoney(val(got))}`, tone: got.length ? 'good' : 'neutral' },
            { label: 'Semua transfer', value: String(rows.length), hint: 'termasuk yang dibatalkan' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'IN_TRANSIT', label: 'Dalam perjalanan', test: (r) => r.status === 'IN_TRANSIT' },
          { value: 'RECEIVED', label: 'Diterima', test: (r) => r.status === 'RECEIVED' },
          { value: 'CANCELLED', label: 'Dibatalkan', test: (r) => r.status === 'CANCELLED' },
        ]}
        searchText={(r) => `${r.number} ${r.fromCode} ${r.fromName} ${r.toCode} ${r.toName} ${r.notes ?? ''}`}
        searchPlaceholder="Cari nomor atau gudang"
        emptyText="Belum ada transfer antar gudang"
        onRowClick={(r) => setParams({ id: r.id })}
        scrollX={820}
        below={
          <>
            {(warehouses?.length ?? 0) < 2 && (
              <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Transfer butuh minimal dua gudang aktif. Tambahkan gudang di Inventori › Gudang." />
            )}
            {transit > 0 && (
              <Alert
                type="warning"
                showIcon
                icon={<CarOutlined />}
                style={{ marginBottom: 16 }}
                message={`${transit} kiriman masih dalam perjalanan`}
                description="Stoknya belum masuk ke gudang tujuan. Buka transfer lalu klik Terima barang setelah barang tiba dan dihitung."
              />
            )}
          </>
        }
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          {
            title: 'Dari → Ke',
            render: (_, r) => (
              <span>
                {r.fromCode} <ArrowRightOutlined style={{ fontSize: 11, color: '#6b7280' }} /> {r.toCode}
              </span>
            ),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: TransferStatus, r) => (
              <>
                <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>
                {s === 'RECEIVED' && r.receivedDate && r.receivedDate !== r.date && <div style={{ fontSize: 11, color: '#6b7280' }}>tiba {fmtDate(r.receivedDate)}</div>}
              </>
            ),
          },
          { title: 'Item', dataIndex: 'lines', align: 'right' },
          { title: 'Nilai (HPP)', dataIndex: 'totalValue', align: 'right', render: fmtMoney },
          { title: 'Catatan', dataIndex: 'notes', render: (v) => v ?? '-' },
          { title: 'Oleh', dataIndex: 'createdBy', render: (v) => v ?? '-' },
        ]}
      />
      <NewTransfer open={open} onClose={() => setOpen(false)} onDone={(id) => setParams({ id })} />
      <Drawer open={!!detailId} onClose={() => setParams({})} width={900} title="Transfer antar gudang" destroyOnHidden>
        {detailId && <TransferDoc id={detailId} />}
      </Drawer>
    </>
  );
}
