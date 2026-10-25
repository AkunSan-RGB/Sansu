import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, InputNumber, Segmented, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get } from '@/api/client';
import { useProducts } from '@/api/queries';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import type { SalesOrder } from '@sansu/shared';
import { KEY, UNASSIGNED_CODE } from './shared';

interface PickLine { productId: string; sku: string; name: string; uom: string; binId: string; binCode: string; zone: string | null; binKind: string; lotId: string | null; lotNo: string | null; expiryDate: string | null; qty: string; available: string }

interface PickPlan { warehouse: { code: string; name: string }; order: { number: string } | null; lines: PickLine[]; shortages: { productId: string; sku: string; name: string; needed: string; available: string }[]; unplaced: number }

/** Daftar ambil: dari pesanan penjualan yang belum terkirim, atau diketik manual; urut jalan petugas, lot paling cepat kedaluwarsa lebih dulu */
export function PickTab({ wid, warehouseLabel }: { wid: string; warehouseLabel: string }) {
  const [mode, setMode] = useState<'order' | 'manual'>('order');
  const [orderId, setOrderId] = useState<string | undefined>();
  const [items, setItems] = useState<{ productId?: string; qty?: number }[]>([{}]);
  const [manualKey, setManualKey] = useState('');
  const orders = useQuery({ queryKey: ['sales-orders', 'all'], queryFn: () => get<SalesOrder[]>('/sales-orders'), enabled: mode === 'order' });
  const { data: products } = useProducts();
  const open = (orders.data ?? []).filter((o) => o.status === 'CONFIRMED' && (!o.warehouse?.id || o.warehouse.id === wid));
  const manual = items.filter((i) => i.productId && i.qty && i.qty > 0).map((i) => `${i.productId}:${i.qty}`).join(',');
  const key = mode === 'order' ? (orderId ? `salesOrderId=${orderId}` : '') : manualKey;
  const plan = useQuery({
    queryKey: [KEY, 'pick', wid, key],
    queryFn: () => get<PickPlan>(`/inventory/bins/pick-plan?${mode === 'order' ? key : `warehouseId=${wid}&items=${manualKey.replace(/^items=/, '')}`}`),
    enabled: !!key,
    retry: false,
  });
  const lines = plan.data?.lines ?? [];
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Segmented value={mode} onChange={(v) => setMode(v as 'order' | 'manual')} options={[{ value: 'order', label: 'Dari pesanan penjualan' }, { value: 'manual', label: 'Ketik sendiri' }]} />
      {mode === 'order' ? (
        <Select showSearch optionFilterProp="label" allowClear placeholder="Pilih pesanan yang belum dikirim" style={{ width: 420, maxWidth: '100%' }} value={orderId} onChange={setOrderId} loading={orders.isLoading}
          options={open.map((o) => ({ value: o.id, label: `${o.number} · ${o.customer.name}` }))} />
      ) : (
        <>
          {items.map((it, i) => (
            <Space key={i} wrap>
              <Select showSearch optionFilterProp="label" placeholder="Barang" style={{ width: 320, maxWidth: '100%' }} value={it.productId} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, productId: v } : x)))}
                options={(products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} />
              <InputNumber min={0.0001} placeholder="Jumlah" value={it.qty} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(v) } : x)))} />
              {items.length > 1 && <Button size="small" onClick={() => setItems(items.filter((_, j) => j !== i))}>Hapus</Button>}
            </Space>
          ))}
          <Space>
            <Button size="small" onClick={() => setItems([...items, {}])}>Tambah barang</Button>
            <Button type="primary" size="small" disabled={!manual} onClick={() => setManualKey(manual)}>Buat daftar ambil</Button>
          </Space>
        </>
      )}
      {plan.isError && <Alert type="error" showIcon message={(plan.error as Error).message} />}
      {plan.data && (
        <>
          {plan.data.shortages.length > 0 && (
            <Alert type="warning" showIcon message="Stok yang bisa diambil tidak cukup" description={plan.data.shortages.map((s) => `${s.sku}: butuh ${fmtQty(s.needed)}, tersedia ${fmtQty(s.available)}`).join(' · ') + '. Stok di rak rusak/karantina tidak dihitung.'} />
          )}
          {plan.data.unplaced > 0 && <Alert type="info" showIcon message={`${plan.data.unplaced} baris diambil dari ${UNASSIGNED_CODE}: barangnya belum ditata, cari di area penerimaan.`} />}
          <Button icon={<PrinterOutlined />} style={{ width: 'fit-content' }} onClick={() => printDoc('Daftar ambil')}>Cetak daftar ambil</Button>
          <div className="print-doc">
            <Typography.Title level={4} style={{ margin: '8px 0' }}>Daftar ambil{plan.data.order ? ` · ${plan.data.order.number}` : ''}</Typography.Title>
            <Typography.Text type="secondary">{warehouseLabel} · urut jalan: zona, rak · lot paling cepat kedaluwarsa lebih dulu</Typography.Text>
            <ResponsiveTable<PickLine>
              rowKey={(r) => `${r.binId}|${r.productId}|${r.lotId ?? ''}`}
              size="small"
              style={{ marginTop: 8 }}
              pagination={false}
              dataSource={lines}
              mobileTitle={0}
              columns={[
                { title: 'Rak', dataIndex: 'binCode', render: (v: string, r) => <Space size={4}><b>{v}</b>{r.zone && <Tag>{r.zone}</Tag>}{r.binKind === 'UNASSIGNED' && <Tag color="gold">belum ditata</Tag>}</Space> },
                { title: 'Barang', key: 'p', render: (_: unknown, r) => `${r.sku} · ${r.name}` },
                { title: 'Lot', dataIndex: 'lotNo', render: (v) => v ?? '-' },
                { title: 'Kedaluwarsa', dataIndex: 'expiryDate', render: (v: string | null) => (v ? fmtDate(v) : '-') },
                { title: 'Ambil', dataIndex: 'qty', align: 'right', render: (v: string, r) => <b>{fmtQty(v)} {r.uom}</b> },
                { title: 'Ada di rak', dataIndex: 'available', align: 'right', render: (v: string) => fmtQty(v) },
                { title: '✓', key: 'chk', width: 40, render: () => '☐' },
              ]}
            />
          </div>
        </>
      )}
    </Space>
  );
}
