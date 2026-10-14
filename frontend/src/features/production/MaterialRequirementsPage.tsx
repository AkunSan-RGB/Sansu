import { DeleteOutlined, PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { t } from '@/lib/terms';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Input, InputNumber, Popconfirm, Segmented, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bom } from '@sansu/shared';
import { get, post } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

interface Material {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  required: number;
  onHand: number;
  onOrder: number;
  requested: number;
  shortage: number;
  supplierId: string | null;
  supplierName: string | null;
  lastPrice: number | null;
}
interface Result {
  warehouse: string;
  materials: Material[];
  subAssemblies: { productId: string; sku: string; name: string; unit: string; bomCode: string; needed: number; fromStock: number; toProduce: number; batches: number }[];
  conversion: { labor: string; overhead: string };
  shortageCount: number;
  canProduce: boolean;
}

/**
 * Perencanaan kebutuhan bahan (MRP ringan): rencana produksi → resep bertingkat diledakkan sampai bahan baku →
 * dibandingkan dengan stok, pesanan berjalan, dan permintaan pembelian → kekurangan langsung bisa diminta dibeli.
 */
export default function MaterialRequirementsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const { data: warehouses } = useWarehouses();
  const boms = useQuery({ queryKey: ['production', 'boms'], queryFn: () => get<Bom[]>('/production/boms') });
  const [wh, setWh] = useState<string>();
  const [items, setItems] = useState<{ bomId?: string; batches: number }[]>([{ batches: 1 }]);
  const [matView, setMatView] = useState<'ALL' | 'SHORT' | 'OK'>('ALL');
  const [matQ, setMatQ] = useState('');
  const warehouseId = wh ?? warehouses?.[0]?.id;
  const valid = !!warehouseId && items.length > 0 && items.every((i) => i.bomId && i.batches > 0);

  const calc = useAction(() => post<Result>('/production/requirements', { warehouseId, items: items.map((i) => ({ bomId: i.bomId, batches: String(i.batches) })) }), {});
  const r = calc.data;
  const plan = useAction(
    () => post<{ planNo: string; orders: { id: string; number: string; level: number }[] }>('/production/plan', { warehouseId, items: items.map((i) => ({ bomId: i.bomId, batches: String(i.batches) })) }),
    {
      success: (x) => `Rencana ${x.planNo}: ${x.orders.length} perintah produksi dibuat${x.orders.length > 1 ? ' (berjenjang)' : ''}`,
      invalidate: ['production'],
      onSuccess: () => navigate('/production/orders'),
    },
  );
  const request = useAction(
    () =>
      post<{ id: string; number: string }>('/purchase-requests', {
        warehouseId,
        submit: true,
        notes: 'Dari perencanaan kebutuhan bahan produksi',
        lines: r!.materials.filter((m) => m.shortage > 0).map((m) => ({ productId: m.productId, qty: String(m.shortage), supplierId: m.supplierId ?? undefined, estPrice: m.lastPrice != null ? String(m.lastPrice) : undefined })),
      }),
    { success: (x) => `Permintaan pembelian ${x.number} dibuat`, invalidate: ['purchase-requests'], onSuccess: (x) => navigate(`/purchase-requests/${x.id}`) },
  );

  return (
    <>
      <PageHeader title="Kebutuhan bahan (MRP)" />
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={t("Pilih resep dan jumlah batch yang direncanakan. Resep bertingkat (barang setengah jadi) dihitung sampai bahan baku; stok barang setengah jadi dipakai dulu, sisanya dihitung dari resepnya. Stok, pesanan pembelian berjalan, dan permintaan pembelian yang sudah ada ikut dikurangkan.")}
        />
        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select style={{ width: 280 }} value={warehouseId} onChange={setWh} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} placeholder="Gudang bahan" />
            {items.map((it, i) => (
              <Space key={i} wrap>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 320 }}
                  placeholder={t("Pilih resep")}
                  value={it.bomId}
                  onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, bomId: v } : x)))}
                  options={boms.data?.filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
                />
                <InputNumber min={0.0001} value={it.batches} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, batches: Number(v ?? 0) } : x)))} addonAfter="batch" />
                {items.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setItems(items.filter((_, j) => j !== i))} />}
              </Space>
            ))}
            <Space wrap>
              <Button icon={<PlusOutlined />} onClick={() => setItems([...items, { batches: 1 }])}>
                {t('Tambah resep')}
              </Button>
              {can('POST', '/production/requirements') && (
                <Button type="primary" disabled={!valid} loading={calc.isPending} onClick={() => calc.mutate(undefined)}>
                  Hitung kebutuhan
                </Button>
              )}
              {r && can('POST', '/production/plan') && (
                <Popconfirm title="Buat perintah produksi dari rencana ini?" description="Satu perintah untuk tiap barang jadi dan satu perintah anak untuk setiap barang setengah jadi yang kurang. Perintah induk baru bisa dimulai setelah anaknya selesai." onConfirm={() => plan.mutate(undefined)}>
                  <Button loading={plan.isPending}>Buat perintah produksi</Button>
                </Popconfirm>
              )}
            </Space>
          </Space>
        </Card>
        {r && (
          <>
            <SummaryCards
              items={[
                { label: 'Status bahan', value: r.canProduce ? 'Cukup' : `${r.shortageCount} bahan kurang`, tone: r.canProduce ? 'good' : 'bad', hint: r.canProduce ? 'siap diproduksi' : 'perlu dibeli dulu' },
                { label: 'Upah langsung standar', value: fmtMoney(r.conversion.labor), hint: t('menurut resep') },
                { label: 'Overhead standar', value: fmtMoney(r.conversion.overhead), hint: t('menurut resep') },
              ]}
            />
            {r.subAssemblies.length > 0 && (
              <Card title="Barang setengah jadi" size="small">
                <Table
                  rowKey="productId"
                  size="small"
                  pagination={false}
                  dataSource={r.subAssemblies}
                  columns={[
                    { title: 'Barang', render: (_, s) => `${s.sku} · ${s.name}` },
                    { title: t('Resep'), dataIndex: 'bomCode' },
                    { title: 'Dibutuhkan', align: 'right', render: (_, s) => `${s.needed} ${s.unit}` },
                    { title: 'Dari stok', align: 'right', render: (_, s) => `${s.fromStock} ${s.unit}` },
                    { title: 'Perlu diproduksi', align: 'right', render: (_, s) => (s.toProduce > 0 ? <Tag color="orange">{`${s.toProduce} ${s.unit} · ${s.batches} batch`}</Tag> : <Tag color="green">Cukup</Tag>) },
                  ]}
                />
              </Card>
            )}
            <Card
              title="Bahan baku"
              size="small"
              extra={
                r.shortageCount > 0 && can('POST', '/purchase-requests') && (
                  <Button type="primary" icon={<ShoppingCartOutlined />} loading={request.isPending} onClick={() => request.mutate(undefined)}>
                    Minta beli kekurangan
                  </Button>
                )
              }
            >
              <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                  <Segmented
                    value={matView}
                    onChange={(v) => setMatView(v as typeof matView)}
                    options={[
                      { value: 'ALL', label: `Semua (${r.materials.length})` },
                      { value: 'SHORT', label: `Kurang (${r.materials.filter((m) => m.shortage > 0).length})` },
                      { value: 'OK', label: `Cukup (${r.materials.filter((m) => m.shortage <= 0).length})` },
                    ]}
                  />
                </div>
                <Input.Search allowClear placeholder="Cari bahan" style={{ width: 220 }} onChange={(e) => setMatQ(e.target.value)} />
              </Space>
              <ResponsiveTable
                rowKey="productId"
                size="small"
                pagination={false}
                locale={{ emptyText: <Empty description="Tidak ada bahan pada pilihan ini" /> }}
                dataSource={r.materials.filter((m) => (matView === 'ALL' || (matView === 'SHORT' ? m.shortage > 0 : m.shortage <= 0)) && (!matQ.trim() || `${m.sku} ${m.name}`.toLowerCase().includes(matQ.trim().toLowerCase())))}
                scroll={{ x: 820 }}
                columns={[
                  { title: 'Bahan', render: (_, m: Material) => `${m.sku} · ${m.name}` },
                  { title: 'Dibutuhkan', align: 'right', render: (_, m: Material) => `${m.required} ${m.unit}` },
                  { title: 'Stok', align: 'right', dataIndex: 'onHand' },
                  { title: 'Dipesan', align: 'right', dataIndex: 'onOrder' },
                  { title: 'Diminta', align: 'right', dataIndex: 'requested' },
                  { title: 'Kurang', align: 'right', render: (_, m: Material) => (m.shortage > 0 ? <Tag color="red">{`${m.shortage} ${m.unit}`}</Tag> : <Tag color="green">Cukup</Tag>) },
                  { title: 'Pemasok terakhir', render: (_, m: Material) => (m.supplierName ? `${m.supplierName}${m.lastPrice != null ? ` · ${fmtMoney(m.lastPrice)}` : ''}` : '-') },
                ]}
              />
            </Card>
          </>
        )}
      </Space>
    </>
  );
}
