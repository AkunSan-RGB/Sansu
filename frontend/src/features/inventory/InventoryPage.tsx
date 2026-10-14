import { ADJUSTMENT_REASON_LABELS, isProductionModel, PRODUCT_ROLE_COLORS, PRODUCT_ROLE_LABELS, STOCK_MOVE_LABELS, type StockMoveType, toOptions } from '@sansu/shared';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { get, post, qs } from '@/api/client';
import { useAction, useProducts, useWarehouses } from '@/api/queries';
import type { StockBalance, StockMove } from '@/api/types';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import InventoryMethodBadge from './InventoryMethodBadge';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';

const REASONS = toOptions(ADJUSTMENT_REASON_LABELS);

interface AdjustValues {
  warehouseId: string;
  reason: string;
  date?: string;
  notes?: string;
  lines: { productId: string; qty: number; unitCost?: number; lotNo?: string; expiryDate?: string }[];
}

export default function InventoryPage() {
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [productId, setProductId] = useState<string>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [view, setView] = useState<'ALL' | 'IN' | 'EMPTY'>('ALL');
  const { me } = useAuth();
  const prod = isProductionModel(me?.businessModel);
  const [role, setRole] = useState<string>('ALL');
  const roleOf = new Map((products ?? []).map((p) => [p.id, p.role]));
  const [search, setSearch] = useState('');
  const [form] = Form.useForm<AdjustValues>();

  const balances = useQuery({
    queryKey: ['stock', warehouseId],
    queryFn: () => get<StockBalance[]>(`/inventory/balances${qs({ warehouseId })}`),
  });
  const moves = useQuery({
    queryKey: ['stock-moves', warehouseId, productId],
    queryFn: () => get<StockMove[]>(`/inventory/moves${qs({ warehouseId, productId })}`),
  });

  const adjust = useAction(
    (v: AdjustValues) =>
      post<{ number: string; journalNumber: string | null }>('/inventory/adjustments', {
        ...v,
        lines: v.lines.map((l) => ({ productId: l.productId, qty: String(l.qty), unitCost: l.unitCost != null ? String(l.unitCost) : undefined, ...(l.qty > 0 ? { lotNo: l.lotNo?.trim() || undefined, expiryDate: l.expiryDate || undefined } : {}) })),
      }),
    {
      success: (r) => `Penyesuaian ${r.number} disimpan${r.journalNumber ? `, jurnal ${r.journalNumber}` : ''}`,
      invalidate: ['stock', 'stock-moves', 'dashboard'],
      onSuccess: () => setAdjustOpen(false),
    },
  );

  const bal = balances.data ?? [];
  const totalValue = bal.reduce((a, r) => a + Number(r.value), 0);
  const inStock = bal.filter((r) => Number(r.qty) > 0);
  const empty = bal.filter((r) => Number(r.qty) <= 0);
  const term = search.trim().toLowerCase();
  const shownBal = bal.filter(
    (r) => (role === 'ALL' || roleOf.get(r.productId) === role) && (view === 'ALL' || (view === 'IN' ? Number(r.qty) > 0 : Number(r.qty) <= 0)) && (!term || `${r.sku} ${r.productName}`.toLowerCase().includes(term)),
  );
  const whOptions = warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const prodOptions = products?.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name} (${p.baseUom})` }));

  return (
    <>
      <PageHeader
        title={t('Inventori')}
        extra={
          <Space wrap>
            <InventoryMethodBadge />
            <Select allowClear placeholder={t('Semua gudang')} style={{ width: 200 }} options={whOptions} onChange={setWarehouseId} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ warehouseId: warehouses?.[0]?.id, reason: 'OPENING', date: today(), lines: [{} as never] });
                setAdjustOpen(true);
              }}
            >
              Penyesuaian stok
            </Button>
          </Space>
        }
      />
      <Card>
        <Tabs
          items={[
            {
              key: 'balance',
              label: 'Saldo stok',
              children: (
                <>
                  <SummaryCards
                    items={[
                      { label: t('Total nilai persediaan'), value: fmtMoney(totalValue), hint: `${bal.length} baris stok` },
                      { label: 'Barang yang ada stoknya', value: String(inStock.length), hint: 'jumlah lebih dari nol', tone: 'good', onClick: () => setView('IN'), active: view === 'IN' },
                      { label: 'Persediaan kosong', value: String(empty.length), hint: 'perlu dibeli atau diproduksi', tone: empty.length ? 'warn' : 'neutral', onClick: () => setView('EMPTY'), active: view === 'EMPTY' },
                    ]}
                  />
                  <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                    <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                      <Segmented
                        value={view}
                        onChange={(v) => setView(v as typeof view)}
                        options={[
                          { value: 'ALL', label: `Semua (${bal.length})` },
                          { value: 'IN', label: `Ada stok (${inStock.length})` },
                          { value: 'EMPTY', label: `Kosong (${empty.length})` },
                        ]}
                      />
                    </div>
                    {prod && (
                      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                        <Segmented
                          value={role}
                          onChange={(v) => setRole(v as string)}
                          options={[
                            { value: 'ALL', label: 'Semua jenis' },
                            { value: 'RAW', label: PRODUCT_ROLE_LABELS.RAW },
                            { value: 'SEMI', label: PRODUCT_ROLE_LABELS.SEMI },
                            { value: 'FINISHED', label: PRODUCT_ROLE_LABELS.FINISHED },
                          ]}
                        />
                      </div>
                    )}
                    <Input.Search allowClear placeholder="Cari SKU atau nama barang" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
                  </Space>
                  <ResponsiveTable<StockBalance>
                    rowKey={(r) => `${r.productId}-${r.warehouseId}`}
                    loading={balances.isLoading}
                    dataSource={shownBal}
                    scroll={{ x: 700 }}
                    locale={{ emptyText: <Empty description={bal.length ? 'Tidak ada barang yang cocok dengan pilihan ini' : 'Belum ada stok. Klik Penyesuaian stok untuk mengisi stok awal.'} /> }}
                    columns={[
                      { title: 'SKU', dataIndex: 'sku' },
                      {
                        title: t('Produk'),
                        dataIndex: 'productName',
                        render: (n: string, r: StockBalance) => {
                          const ro = roleOf.get(r.productId);
                          return (
                            <span>
                              {n}
                              {prod && ro && <Tag color={PRODUCT_ROLE_COLORS[ro]} style={{ marginLeft: 6 }}>{PRODUCT_ROLE_LABELS[ro]}</Tag>}
                            </span>
                          );
                        },
                      },
                      { title: t('Gudang'), dataIndex: 'warehouseCode' },
                      { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v, r) => `${fmtQty(v)} ${r.baseUom}` },
                      { title: 'HPP rata-rata', dataIndex: 'avgCost', align: 'right', render: fmtMoney },
                      { title: 'Nilai', dataIndex: 'value', align: 'right', render: fmtMoney },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'card',
              label: 'Kartu stok',
              children: (
                <>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={t('Filter produk')}
                    style={{ width: '100%', maxWidth: 360, marginBottom: 12 }}
                    options={prodOptions}
                    onChange={setProductId}
                  />
                  <ResponsiveTable<StockMove>
                    rowKey="id"
                    size="small"
                    loading={moves.isLoading}
                    dataSource={moves.data}
                    scroll={{ x: 800 }}
                    locale={{ emptyText: <Empty description="Belum ada pergerakan stok" /> }}
                    columns={[
                      { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                      { title: 'Dokumen', dataIndex: 'refNumber' },
                      { title: t('Produk'), render: (_, m) => `${m.product.sku} · ${m.product.name}` },
                      { title: t('Gudang'), dataIndex: ['warehouse', 'code'] },
                      { title: 'Jenis', dataIndex: 'type', render: (t) => <Tag>{STOCK_MOVE_LABELS[t as StockMoveType] ?? t}</Tag> },
                      {
                        title: 'Qty',
                        dataIndex: 'qty',
                        align: 'right',
                        render: (v) => <span style={{ color: Number(v) < 0 ? '#cf1322' : '#389e0d' }}>{fmtQty(v)}</span>,
                      },
                      { title: 'Biaya/unit', dataIndex: 'unitCost', align: 'right', render: fmtMoney },
                      { title: 'Saldo', dataIndex: 'balanceAfter', align: 'right', render: fmtQty },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Penyesuaian persediaan"
        width={720}
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjust.isPending}
        okText="Posting"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => adjust.mutate(v)}>
          <Space wrap>
            <Form.Item name="warehouseId" label={t('Gudang')} rules={[{ required: true }]}>
              <Select style={{ width: 220 }} options={whOptions} />
            </Form.Item>
            <Form.Item name="reason" label="Alasan" rules={[{ required: true }]}>
              <Select style={{ width: 220 }} options={REASONS} />
            </Form.Item>
            <Form.Item name="date" label="Tanggal">
              <Input type="date" />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary">
            Qty dalam satuan dasar. Positif = tambah stok (wajib isi biaya/unit), negatif = kurangi stok (memakai HPP rata-rata).
          </Typography.Paragraph>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap>
                    <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: t('Pilih produk') }]}>
                      <Select showSearch optionFilterProp="label" placeholder={t('Produk')} style={{ width: 300 }} options={prodOptions} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Qty' }]}>
                      <InputNumber placeholder="Qty" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'unitCost']}>
                      <InputNumber min={0} placeholder="Biaya/unit" style={{ width: 150 }} prefix="Rp" />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue }) =>
                        Number(getFieldValue(['lines', f.name, 'qty'])) > 0 && (
                          <>
                            <Form.Item name={[f.name, 'lotNo']}>
                              <Input placeholder="No. lot (opsional)" maxLength={40} style={{ width: 150 }} />
                            </Form.Item>
                            <Form.Item name={[f.name, 'expiryDate']}>
                              <Input type="date" title="Tanggal kedaluwarsa (opsional)" style={{ width: 150 }} />
                            </Form.Item>
                          </>
                        )
                      }
                    </Form.Item>
                    {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                  Tambah baris
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Catatan" style={{ marginTop: 16 }}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
