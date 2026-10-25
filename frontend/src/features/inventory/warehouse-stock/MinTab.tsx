import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Input, InputNumber, Select, Space, Table } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { get, put } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

interface MinRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  baseUom: string;
  qty: string;
  minQty: string | null;
}

export function MinTab() {
  const can = useCan();
  const canEditMin = can('PUT', '/inventory/minimums');
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);
  const q = useQuery({ queryKey: ['minimums', warehouseId], queryFn: () => get<MinRow[]>(`/inventory/minimums?warehouseId=${warehouseId}`), enabled: !!warehouseId });
  useEffect(() => setEdits({}), [warehouseId]);
  const save = useAction(
    () => put(`/inventory/minimums`, { warehouseId, items: Object.entries(edits).map(([productId, v]) => ({ productId, minQty: v == null ? null : String(v) })) }),
    { success: 'Stok minimum disimpan', invalidate: ['minimums', 'low-stock', 'matrix', 'dashboard'], onSuccess: () => setEdits({}) },
  );
  const rows = useMemo(() => (q.data ?? []).filter((r) => !search || `${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  const changed = Object.keys(edits).length;
  return (
    <Card>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('Isi jumlah minimum per gudang. Jika stok turun di bawahnya, produk muncul di tab Stok menipis dan di Dashboard. Kosongkan untuk menghapus.')} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 240 }} value={warehouseId} onChange={setWarehouseId} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        <Input prefix={<SearchOutlined />} placeholder="Cari SKU / nama" allowClear value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        {canEditMin && (
          <Button type="primary" icon={<SaveOutlined />} disabled={!changed} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Simpan{changed ? ` (${changed})` : ''}
          </Button>
        )}
      </Space>
      <Table
        rowKey="productId"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 100, showSizeChanger: false }}
        scroll={{ x: 680 }}
        columns={[
          { title: 'SKU', dataIndex: 'sku', width: 130 },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kategori', dataIndex: 'category', width: 130 },
          { title: 'Stok sekarang', dataIndex: 'qty', align: 'right', width: 130, render: (v, r) => `${fmtQty(v)} ${r.baseUom}` },
          {
            title: 'Stok minimum',
            width: 150,
            render: (_, r) => !canEditMin ? (r.minQty == null ? '—' : fmtQty(r.minQty)) : (
              <InputNumber
                min={0}
                style={{ width: 130 }}
                value={r.productId in edits ? edits[r.productId] : r.minQty == null ? null : Number(r.minQty)}
                onChange={(v) => setEdits((e) => ({ ...e, [r.productId]: v == null || Number(v) === 0 ? null : Number(v) }))}
                placeholder="—"
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
