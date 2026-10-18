import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

interface Line { productId: string; sku: string; name: string; baseUom: string; onHand: number; onOrder: number; requested: number; minQty: number; suggestedQty: number; lastPrice: number | null; estimate: number | null; shelfLifeDays: number | null }
interface Group { supplierId: string | null; supplierName: string; warehouseId: string; lines: Line[]; total: number }
interface Data { date: string; groups: Group[]; priceAlerts: { sku: string; name: string; supplier: string; latest: number; average: number; pct: number; date: string }[] }

/** Daftar belanja harian: kebutuhan di bawah stok minimum per pemasok; PO draf satu klik; peringatan lonjakan harga beli */
export default function ShoppingListPage() {
  const { me } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['shopping-list'], queryFn: () => get<Data>('/shopping-list') });
  const draft = useAction((g: Group) => post<{ id: string; number: string; lines: number; skipped: string[] }>('/shopping-list/draft-order', { supplierId: g.supplierId, warehouseId: g.warehouseId }), {
    success: (r) => `PO draf ${(r as { number: string }).number} dibuat`,
    invalidate: ['shopping-list', 'purchase-orders'],
    onSuccess: (r) => navigate(`/purchase-orders/${r.id}`),
  });
  const fnb = me?.businessModel === 'FNB';
  return (
    <>
      <PageHeader title={fnb ? 'Daftar belanja harian' : 'Daftar belanja'} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Barang di bawah stok minimum (memperhitungkan yang sudah dipesan/diminta), dikelompokkan per pemasok terakhir. PO draf memakai jumlah yang disarankan dan harga beli terakhir; tetap melewati persetujuan nilai besar dan kontrak harga saat dikonfirmasi." />
      {!!data?.priceAlerts.length && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Harga beli naik" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data.priceAlerts.slice(0, 6).map((a) => <li key={a.sku}>{a.sku} {a.name} ({a.supplier}): {fmtMoney(a.latest)} naik {a.pct}% dari rata-rata {fmtMoney(a.average)}</li>)}</ul>} />
      )}
      {!isLoading && !data?.groups.length && <Card><Empty description="Semua stok di atas minimum. Atur stok minimum di Persediaan per gudang." /></Card>}
      <Space direction="vertical" style={{ width: '100%' }}>
        {(data?.groups ?? []).map((g) => (
          <Card key={`${g.supplierId}-${g.warehouseId}`} size="small" title={<Space wrap>{g.supplierName}{g.total > 0 && <Typography.Text type="secondary">perkiraan {fmtMoney(g.total)}</Typography.Text>}</Space>}
            extra={g.supplierId && can('POST', '/shopping-list/draft-order') && <Button type="primary" loading={draft.isPending} onClick={() => draft.mutate(g)}>Buat PO draf</Button>}>
            <Table size="small" rowKey="productId" pagination={false} dataSource={g.lines} scroll={{ x: 640 }}
              columns={[
                { title: 'Barang', render: (_: unknown, l: Line) => <span>{l.sku} · {l.name} {l.shelfLifeDays != null && l.shelfLifeDays <= 7 && <Tag color="green">segar</Tag>}</span> },
                { title: 'Ada', align: 'right' as const, render: (_: unknown, l: Line) => `${l.onHand} ${l.baseUom}` },
                { title: 'Dipesan', align: 'right' as const, render: (_: unknown, l: Line) => l.onOrder + l.requested },
                { title: 'Minimum', align: 'right' as const, dataIndex: 'minQty' },
                { title: 'Disarankan', align: 'right' as const, render: (_: unknown, l: Line) => <strong>{l.suggestedQty} {l.baseUom}</strong> },
                { title: 'Harga terakhir', align: 'right' as const, render: (_: unknown, l: Line) => (l.lastPrice != null ? fmtMoney(l.lastPrice) : <Typography.Text type="secondary">belum ada</Typography.Text>) },
              ]}
            />
            {!g.supplierId && <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>Barang ini belum pernah dibeli. Buat Purchase Order manual dan pilih pemasoknya.</Typography.Paragraph>}
          </Card>
        ))}
      </Space>
    </>
  );
}
