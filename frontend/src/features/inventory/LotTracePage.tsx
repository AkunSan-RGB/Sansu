import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { useProducts } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

interface Doc { type: string; number: string | null; date: string; qty: string; cancelled: boolean; estimate?: boolean }
interface Trace {
  product: { sku: string; name: string; baseUom: string };
  lotNo: string;
  lots: { id: string; warehouse: string; receivedDate: string; expiryDate: string | null; qtyReceived: string; qtyRemaining: string; source: { type: string; number: string | null; supplier: string | null } }[];
  summary: { received: string; remaining: string; toCustomers: string; walkIn: string; other: string; untraced: string; estimated: string };
  customers: { customerId: string; code: string; name: string; phone: string | null; address: string | null; qty: string; docs: Doc[] }[];
  walkIn: { qty: string; docs: Doc[] };
  other: { type: string; label: string; qty: string; docs: Doc[] }[];
}

const docLabel: Record<string, string> = { DELIVERY: 'Surat jalan', INVOICE: 'Faktur', POS_ORDER: 'Kasir', GOODS_SWAP: 'Tukar-guling' };
const docList = (docs: Doc[]) => docs.map((d, i) => <div key={i} style={{ fontSize: 12 }}>{docLabel[d.type] ?? d.type} {d.number ?? ''} · {fmtDate(d.date)} · {fmtQty(d.qty)}{d.cancelled && <Tag color="default" style={{ marginLeft: 4 }}>dibatalkan</Tag>}{d.estimate && <Tag color="orange" style={{ marginLeft: 4 }}>perkiraan</Tag>}</div>);

/** Penelusuran lot untuk penarikan produk (recall): satu nomor lot → asal penerimaan → semua pelanggan penerimanya */
export default function LotTracePage() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const rebuild = useAction(() => post<{ allocated: number; quantity: string }>('/inventory/lots/rebuild-trace'), { success: (r) => (r.allocated ? `${r.allocated} jejak lama direkonstruksi (ditandai perkiraan)` : 'Tidak ada jejak lama yang perlu direkonstruksi'), invalidate: ['lot-trace'] });
  const { data: products } = useProducts();
  const productId = params.get('productId') ?? undefined;
  const lotNo = params.get('lotNo') ?? undefined;
  const [lotInput, setLotInput] = useState(lotNo ?? '');
  const [pid, setPid] = useState(productId);
  const { data, isFetching, error } = useQuery({
    queryKey: ['lot-trace', productId, lotNo],
    queryFn: () => get<Trace>(`/inventory/lots/trace?productId=${productId}&lotNo=${encodeURIComponent(lotNo!)}`),
    enabled: !!productId && !!lotNo,
    retry: false,
  });
  return (
    <>
      <PageHeader title="Telusuri lot (recall)" extra={can('POST', '/inventory/lots/rebuild-trace') && <Button loading={rebuild.isPending} onClick={() => rebuild.mutate(undefined)}>Rekonstruksi jejak stok lama</Button>} />
      <Card style={{ marginBottom: 12 }}>
        <Form layout="inline" onFinish={() => pid && lotInput.trim() && setParams({ productId: pid, lotNo: lotInput.trim() })}>
          <Form.Item label={t('Produk')}><Select showSearch style={{ width: 280 }} optionFilterProp="label" value={pid} onChange={setPid} options={(products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
          <Form.Item label="Nomor lot"><Input style={{ width: 180 }} value={lotInput} onChange={(e) => setLotInput(e.target.value)} placeholder="mis. MIE-2409A" /></Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />} disabled={!pid || !lotInput.trim()} loading={isFetching}>Telusuri</Button>
        </Form>
      </Card>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Menampilkan asal penerimaan lot dan ke mana barangnya keluar: pelanggan (per surat jalan/faktur), kasir, transfer, pembuangan, atau produksi. Hanya pengeluaran sejak jejak lot dicatat yang terlacak; selisihnya ditampilkan sebagai “tidak terlacak”. Tombol “Rekonstruksi jejak stok lama” (Admin) mengalokasikan pengeluaran lama ke lot secara FEFO; hasilnya ditandai “perkiraan”, bukan catatan asli." />
      {error && <Alert type="warning" showIcon message={(error as Error).message} />}
      {!data && !error && <Empty description="Pilih produk dan isi nomor lot, atau klik “Telusuri” pada daftar Kedaluwarsa." />}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Card title={`${data.product.name} · lot ${data.lotNo}`}>
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="Diterima">{fmtQty(data.summary.received)} {data.product.baseUom}</Descriptions.Item>
              <Descriptions.Item label="Ke pelanggan">{fmtQty(data.summary.toCustomers)}</Descriptions.Item>
              <Descriptions.Item label="Kasir (pembeli umum)">{fmtQty(data.summary.walkIn)}</Descriptions.Item>
              <Descriptions.Item label="Keluar lain (transfer/buang/produksi)">{fmtQty(data.summary.other)}</Descriptions.Item>
              <Descriptions.Item label="Masih di gudang">{fmtQty(data.summary.remaining)}</Descriptions.Item>
              <Descriptions.Item label="Perkiraan (direkonstruksi)">{Number(data.summary.estimated) !== 0 ? <Tag color="orange">{fmtQty(data.summary.estimated)}</Tag> : '0'}</Descriptions.Item>
              <Descriptions.Item label="Tidak terlacak">{Number(data.summary.untraced) !== 0 ? <Tag color="orange">{fmtQty(data.summary.untraced)}</Tag> : '0'}</Descriptions.Item>
            </Descriptions>
            <Table size="small" style={{ marginTop: 8 }} rowKey="id" pagination={false} dataSource={data.lots} scroll={{ x: 600 }}
              columns={[
                { title: 'Gudang', dataIndex: 'warehouse' },
                { title: 'Asal', render: (_: unknown, l: Trace['lots'][number]) => `${l.source.type}${l.source.number ? ` ${l.source.number}` : ''}${l.source.supplier ? ` · ${l.source.supplier}` : ''}` },
                { title: 'Diterima', render: (_: unknown, l: Trace['lots'][number]) => fmtDate(l.receivedDate) },
                { title: 'Kedaluwarsa', render: (_: unknown, l: Trace['lots'][number]) => fmtDate(l.expiryDate) },
                { title: 'Sisa', align: 'right' as const, render: (_: unknown, l: Trace['lots'][number]) => `${fmtQty(l.qtyRemaining)} / ${fmtQty(l.qtyReceived)}` },
              ]} />
          </Card>
          <Card title={`Pelanggan penerima (${data.customers.length})`}>
            <Table size="small" rowKey="customerId" pagination={false} dataSource={data.customers} scroll={{ x: 640 }} locale={{ emptyText: 'Belum ada pelanggan terdaftar yang menerima lot ini' }}
              columns={[
                { title: 'Pelanggan', render: (_: unknown, c: Trace['customers'][number]) => <div><Typography.Text strong>{c.name}</Typography.Text><div style={{ fontSize: 12, color: '#64748b' }}>{c.code}{c.phone ? ` · ${c.phone}` : ''}{c.address ? ` · ${c.address}` : ''}</div></div> },
                { title: 'Jumlah', align: 'right' as const, render: (_: unknown, c: Trace['customers'][number]) => fmtQty(c.qty) },
                { title: 'Dokumen', render: (_: unknown, c: Trace['customers'][number]) => docList(c.docs) },
              ]} />
          </Card>
          {(data.walkIn.docs.length > 0 || data.other.length > 0) && (
            <Card title="Keluar ke tujuan lain">
              <Table size="small" rowKey="label" pagination={false} scroll={{ x: 520 }}
                dataSource={[...(data.walkIn.docs.length ? [{ label: 'Kasir / pembeli umum', qty: data.walkIn.qty, docs: data.walkIn.docs }] : []), ...data.other.map((o) => ({ label: o.label, qty: o.qty, docs: o.docs }))] as { label: string; qty: string; docs?: Doc[] }[]}
                columns={[{ title: 'Tujuan', dataIndex: 'label' }, { title: 'Jumlah', align: 'right' as const, render: (_: unknown, r: { qty: string }) => fmtQty(r.qty) }, { title: 'Dokumen', render: (_: unknown, r: { qty: string; docs?: Doc[] }) => docList(r.docs ?? []) }]} />
            </Card>
          )}
        </Space>
      )}
    </>
  );
}
