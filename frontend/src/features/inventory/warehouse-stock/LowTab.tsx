import { ShoppingCartOutlined, SwapOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Input, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import { fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

interface LowRow {
  productId: string;
  sku: string;
  name: string;
  baseUom: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qty: string;
  minQty: string;
  shortage: string;
}

export function LowTab() {
  const can = useCan();
  const navigate = useNavigate();
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [lowSearch, setLowSearch] = useState('');
  const q = useQuery({ queryKey: ['low-stock', warehouseId], queryFn: () => get<LowRow[]>(`/inventory/low-stock${qs({ warehouseId })}`) });
  const lowRows = q.data ?? [];
  const lowShown = lowRows.filter((r) => !lowSearch.trim() || `${r.sku} ${r.name} ${r.warehouseName}`.toLowerCase().includes(lowSearch.trim().toLowerCase()));
  return (
    <>
    {!q.isLoading && lowRows.length > 0 && (
      <SummaryCards
        items={[
          { label: 'Barang menipis', value: String(new Set(lowRows.map((r) => r.productId)).size), hint: 'di bawah stok minimum', tone: 'bad' },
          { label: 'Gudang terdampak', value: String(new Set(lowRows.map((r) => r.warehouseId)).size), hint: 'punya barang menipis', tone: 'warn' },
          { label: 'Baris perlu ditambah', value: String(lowRows.length), hint: 'kombinasi barang dan gudang' },
        ]}
      />
    )}
    <Card>
      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Cari SKU atau nama barang" style={{ width: 240 }} onChange={(e) => setLowSearch(e.target.value)} />
        <Select allowClear placeholder={t('Semua gudang')} style={{ width: 240 }} value={warehouseId} onChange={setWarehouseId} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        {can('POST', '/inventory/transfers') && (
          <Button icon={<SwapOutlined />} onClick={() => navigate('/inventory/transfers?new=1')}>
            Transfer dari gudang lain
          </Button>
        )}
        {can('POST', '/purchase-orders') && (
          <Button icon={<ShoppingCartOutlined />} onClick={() => navigate('/purchase-orders/new')}>
            Buat pesanan pembelian
          </Button>
        )}
      </Space>
      <ResponsiveTable<LowRow>
        rowKey={(r) => `${r.productId}-${r.warehouseId}`}
        size="small"
        loading={q.isLoading}
        dataSource={lowShown}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty description="Tidak ada stok di bawah minimum. Atur stok minimum di tab sebelah." /> }}
        columns={[
          { title: t('Gudang'), render: (_, r) => `${r.warehouseCode} · ${r.warehouseName}` },
          { title: 'SKU', dataIndex: 'sku' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Stok', dataIndex: 'qty', align: 'right', render: (v, r) => <Typography.Text type="danger">{fmtQty(v)} {r.baseUom}</Typography.Text> },
          { title: 'Minimum', dataIndex: 'minQty', align: 'right', render: fmtQty },
          { title: 'Kurang', dataIndex: 'shortage', align: 'right', render: (v) => <b>{fmtQty(v)}</b> },
        ]}
      />
    </Card>
    </>
  );
}
