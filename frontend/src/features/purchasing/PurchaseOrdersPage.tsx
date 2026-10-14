import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import type { PurchaseOrder } from '@/api/types';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PurchaseOrderStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

const sum = (xs: PurchaseOrder[]) => xs.reduce((a, o) => a + Number(o.total), 0);

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', 'all'], queryFn: () => get<PurchaseOrder[]>('/purchase-orders') });
  return (
    <ListPage<PurchaseOrder>
      title={t('Purchase Order')}
      actions={
        <>
          <Button type={me?.businessModel === 'RITEL' ? 'primary' : 'default'} icon={<ThunderboltOutlined />} onClick={() => navigate('/purchase-orders/quick')}>
            Pembelian cepat
          </Button>
          <Button type={me?.businessModel === 'RITEL' ? 'default' : 'primary'} icon={<PlusOutlined />} onClick={() => navigate('/purchase-orders/new')}>
            PO baru
          </Button>
        </>
      }
      rows={data}
      loading={isLoading}
      summary={(rows) => {
        const live = rows.filter((o) => o.status !== 'CANCELLED');
        const waiting = rows.filter((o) => o.status === 'CONFIRMED' && o.receiptStatus !== 'FULL');
        return [
          { label: 'Nilai pembelian (tidak termasuk batal)', value: fmtMoney(sum(live)), hint: `${live.length} PO` },
          { label: 'Menunggu barang tiba', value: String(waiting.length), hint: `senilai ${fmtMoney(sum(waiting))}`, tone: waiting.length ? 'warn' : 'neutral' },
          { label: 'Masih draf', value: String(rows.filter((o) => o.status === 'DRAFT').length), hint: 'belum dikirim ke supplier' },
        ];
      }}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'DRAFT', label: 'Draf', test: (o) => o.status === 'DRAFT' },
        { value: 'OPEN', label: 'Menunggu barang', test: (o) => o.status === 'CONFIRMED' && o.receiptStatus !== 'FULL' },
        { value: 'BILLED', label: 'Sudah difakturkan', test: (o) => o.status === 'BILLED' },
        { value: 'CANCELLED', label: 'Batal', test: (o) => o.status === 'CANCELLED' },
      ]}
      searchText={(o) => `${o.number} ${o.supplier.name} ${o.invoices?.map((i) => i.number).join(' ') ?? ''}`}
      searchPlaceholder={`Cari ${t('Supplier').toLowerCase()} atau nomor PO`}
      emptyText="Belum ada pesanan pembelian"
      onRowClick={(o) => navigate(`/purchase-orders/${o.id}`)}
      scrollX={800}
      columns={[
        {
          title: 'PO',
          dataIndex: 'number',
          render: (n: string, o) => (
            <div>
              <Space size={4}>{n}{o.priceEstimate && <Tag color="orange">Harga estimasi</Tag>}</Space>
              <div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(o.date)}</span></div>
            </div>
          ),
        },
        { title: t('Supplier'), render: (_: unknown, o) => o.supplier.name },
        { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
        { title: 'Status', dataIndex: 'status', render: (s) => <PurchaseOrderStatusTag status={s} /> },
        {
          title: 'Penerimaan',
          render: (_: unknown, o) =>
            o.status !== 'CONFIRMED' && o.status !== 'BILLED' ? '-' : o.receiptStatus === 'FULL' ? <Tag color="green">Lengkap</Tag> : o.receiptStatus === 'PARTIAL' ? <Tag color="gold">Sebagian</Tag> : <Tag>Belum</Tag>,
        },
        { title: t('Faktur'), render: (_: unknown, o) => (o.invoices?.length ? `${o.invoices[0].number}${o.invoices.length > 1 ? ` +${o.invoices.length - 1}` : ''}` : '-') },
      ]}
    />
  );
}
