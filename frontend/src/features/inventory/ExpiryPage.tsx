import { DeleteOutlined, NodeIndexOutlined } from '@ant-design/icons';
import type { StockLotRow, StockLotList } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

const STATUS: Record<StockLotRow['status'], { color: string; text: (l: StockLotRow) => string }> = {
  EXPIRED: { color: 'red', text: (l) => `Lewat ${Math.abs(l.daysLeft ?? 0)} hari` },
  SOON: { color: 'orange', text: (l) => (l.daysLeft === 0 ? 'Hari ini' : `${l.daysLeft} hari lagi`) },
  WARNING: { color: 'gold', text: (l) => `${l.daysLeft} hari lagi` },
  OK: { color: 'green', text: (l) => `${l.daysLeft} hari lagi` },
  NO_EXPIRY: { color: 'default', text: () => 'Tanpa tanggal' },
};

/** Pantau bahan yang akan atau sudah kedaluwarsa (lot dicatat saat penerimaan barang atau saldo awal) */
export default function ExpiryPage() {
  const { me } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const canTrace = me?.businessModel === 'FMCG' && ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES', 'ACCOUNTANT'].includes(me?.role ?? '');
  const canDiscard = ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(me?.role ?? '') && can('POST', '/inventory/lots/:id/discard');
  const { data, isLoading } = useQuery({ queryKey: ['stock-lots'], queryFn: () => get<StockLotList>('/inventory/lots') });
  const discard = useAction((id: string) => post(`/inventory/lots/${id}/discard`, {}), {
    success: 'Lot dibuang dan dicatat sebagai bahan rusak/kedaluwarsa',
    invalidate: ['stock-lots', 'stock', 'stock-moves', 'dashboard'],
  });
  const s = data?.summary;
  return (
    <ListPage<StockLotRow>
      title="Kedaluwarsa bahan"
      rows={data?.items}
      loading={isLoading}
      summary={() => [
        { label: 'Sudah kedaluwarsa', value: String(s?.expired ?? 0), hint: s?.expired ? `nilai ${fmtMoney(s.expiredValue)} — segera dibuang` : 'tidak ada', tone: s?.expired ? 'bad' : 'good' },
        { label: `Segera (≤ ${data?.soonDays ?? 7} hari)`, value: String(s?.soon ?? 0), hint: s?.soon ? `nilai ${fmtMoney(s.soonValue)} — pakai lebih dulu` : 'tidak ada', tone: s?.soon ? 'warn' : 'good' },
        { label: `Perlu diperhatikan (≤ ${data?.warningDays ?? 30} hari)`, value: String(s?.warning ?? 0), hint: `${s?.tracked ?? 0} lot dipantau` },
      ]}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'EXPIRED', label: 'Kedaluwarsa', test: (l) => l.status === 'EXPIRED' },
        { value: 'SOON', label: 'Segera', test: (l) => l.status === 'SOON' },
        { value: 'WARNING', label: 'Perlu diperhatikan', test: (l) => l.status === 'WARNING' },
      ]}
      searchText={(l) => `${l.sku} ${l.productName} ${l.lotNo ?? ''} ${l.warehouseCode}`}
      searchPlaceholder="Cari bahan, lot, atau gudang"
      emptyText="Belum ada lot. Isi nomor lot dan tanggal kedaluwarsa saat menerima barang (Pembelian) atau saat mengisi saldo awal; sistem lalu memantaunya di sini."
      below={
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Barang keluar (penjualan, pemakaian resep, pembuangan) mengurangi lot yang paling cepat kedaluwarsa lebih dulu. Pencatatan lot hanya pemantauan: nilai persediaan dan jurnal tetap mengikuti biaya biasa."
        />
      }
      columns={[
        { title: t('Produk'), render: (_: unknown, l: StockLotRow) => <span><Typography.Text strong>{l.productName}</Typography.Text><br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{l.sku}</Typography.Text></span> },
        { title: 'Lot', dataIndex: 'lotNo', render: (v: string | null) => v ?? '-' },
        { title: t('Gudang'), dataIndex: 'warehouseCode' },
        { title: 'Sisa', align: 'right', render: (_: unknown, l: StockLotRow) => `${fmtQty(l.qtyRemaining)} ${l.baseUom}` },
        { title: 'Kedaluwarsa', render: (_: unknown, l: StockLotRow) => (l.expiryDate ? fmtDate(l.expiryDate) : '-') },
        { title: 'Status', render: (_: unknown, l: StockLotRow) => <Tag color={STATUS[l.status].color}>{STATUS[l.status].text(l)}</Tag> },
        { title: 'Perkiraan nilai', align: 'right', render: (_: unknown, l: StockLotRow) => fmtMoney(l.value) },
        ...(canDiscard || canTrace
          ? [
              {
                title: '',
                render: (_: unknown, l: StockLotRow) => (
                  <Space>
                    {canTrace && l.lotNo && <Button size="small" icon={<NodeIndexOutlined />} onClick={() => navigate(`/inventory/lot-trace?productId=${l.productId}&lotNo=${encodeURIComponent(l.lotNo!)}`)}>Telusuri</Button>}
                    {canDiscard && (
                      <Popconfirm title="Buang seluruh sisa lot ini?" description="Stok berkurang dan dicatat sebagai bahan rusak/kedaluwarsa (beban)." okText="Buang" cancelText="Batal" onConfirm={() => discard.mutate(l.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} loading={discard.isPending}>Buang</Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
