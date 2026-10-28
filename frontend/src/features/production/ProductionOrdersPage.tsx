import { PlusOutlined } from '@ant-design/icons';
import { PRODUCTION_STATUS_LABELS, type ProductionOrder, type ProductionStatus, type SubcontractHolding } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Space, Tag } from 'antd';
import { useState } from 'react';
import { get } from '@/api/client';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';
import { COLOR } from './production-orders/shared';
import { CreateModal } from './production-orders/CreateModal';
import { OrderDrawer } from './production-orders/OrderDrawer';

export default function ProductionOrdersPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => get<ProductionOrder[]>('/production/orders'),
  });
  const holdings = useQuery({ queryKey: ['production', 'holdings'], queryFn: () => get<SubcontractHolding[]>('/production/subcontract/holdings') });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <ListPage<ProductionOrder>
        title="Perintah produksi"
        actions={
          can('POST', '/production/orders') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Produksi baru
            </Button>
          )
        }
        rows={q.data}
        loading={q.isLoading}
        below={
          (holdings.data ?? []).length > 0 && (
            <Alert
              style={{ marginBottom: 12 }}
              type="info"
              showIcon
              message="Bahan di tangan maklon"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(holdings.data ?? []).map((h) => (
                    <li key={h.supplierId}>
                      <b>{h.supplierName}</b> — {fmtMoney(h.totalValue)} (perintah {h.orders.map((o) => o.orderNumber).join(', ')}):{' '}
                      {h.orders.flatMap((o) => o.materials).map((m) => `${m.name} ${fmtQty(m.qty)} ${m.unit}`).join(', ')}
                    </li>
                  ))}
                </ul>
              }
            />
          )
        }
        summary={(rows) => {
          const running = rows.filter((o) => o.status === 'IN_PROGRESS');
          const planned = rows.filter((o) => o.status === 'DRAFT');
          const done = rows.filter((o) => o.status === 'COMPLETED');
          return [
            { label: 'Sedang diproduksi', value: String(running.length), hint: 'bahan sudah keluar, belum selesai', tone: running.length ? 'warn' : 'neutral' },
            { label: 'Masih rencana', value: String(planned.length), hint: 'belum dimulai' },
            { label: 'Selesai', value: String(done.length), hint: 'produk jadi sudah masuk gudang', tone: done.length ? 'good' : 'neutral' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'IN_PROGRESS', label: 'Sedang diproduksi', test: (o) => o.status === 'IN_PROGRESS' },
          { value: 'DRAFT', label: 'Rencana', test: (o) => o.status === 'DRAFT' },
          { value: 'COMPLETED', label: 'Selesai', test: (o) => o.status === 'COMPLETED' },
          { value: 'CANCELLED', label: 'Dibatalkan', test: (o) => o.status === 'CANCELLED' },
        ]}
        searchText={(o) => `${o.number} ${o.product.sku} ${o.product.name} ${o.warehouse.name}`}
        searchPlaceholder="Cari nomor atau produk"
        emptyText={t("Belum ada perintah produksi. Buat resep dulu, lalu klik Produksi baru.")}
        onRowClick={(r) => setOpenId(r.id)}
        scrollX={1000}
        columns={[
          {
            title: 'Nomor',
            dataIndex: 'number',
            render: (n, o) => (
              <Space size={4} wrap>
                {n}
                {o.parentNumber && <Tag color="purple">Untuk {o.parentNumber}</Tag>}
                {!!o.childCount && <Tag color="blue">{o.childCount} perintah setengah jadi</Tag>}
              </Space>
            ),
          },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: t('Produk'), render: (_, o) => `${o.product.sku} · ${o.product.name}` },
          { title: 'Rencana', align: 'right', render: (_, o) => `${fmtQty(o.plannedQty)} ${o.product.unit}` },
          {
            title: 'Hasil',
            align: 'right',
            render: (_, o) => (o.status === 'COMPLETED' ? `${fmtQty(o.outputQty)} ${o.product.unit}` : '-'),
          },
          {
            title: 'Harga pokok / unit',
            align: 'right',
            render: (_, o) => (o.status === 'COMPLETED' ? fmtMoney(o.unitCost) : '-'),
          },
          { title: t('Gudang'), render: (_, o) => o.warehouse.name },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: ProductionStatus) => <Tag color={COLOR[s]}>{PRODUCTION_STATUS_LABELS[s]}</Tag>,
          },
        ]}
      />
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={(o) => setOpenId(o.id)} />
      {openId && <OrderDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
