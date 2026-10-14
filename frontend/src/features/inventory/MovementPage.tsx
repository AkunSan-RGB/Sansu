/**
 * Perputaran stok: barang cepat keluar, lambat, dan tidak bergerak. Ambang & saran menyesuaikan jenis usaha
 * (toko berputar mingguan, dagang bulanan, produksi mengikuti bahan, jasa bahan kerja).
 */
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Empty, Input, Segmented, Space, Tag } from 'antd';
import { BUSINESS_MODEL_BY_KEY, MOVEMENT_LABELS, type BusinessModel, type MovementClass, type MovementProfile } from '@sansu/shared';
import { useState } from 'react';
import { get } from '@/api/client';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface Item {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  uom: string;
  onHand: number;
  value: number;
  soldInWindow: number;
  perDay: number;
  coverDays: number | null;
  lastOutDate: string | null;
  cls: MovementClass;
}
interface Analysis {
  model: BusinessModel;
  asOf: string;
  profile: MovementProfile;
  summary: Record<MovementClass, { count: number; value: number }>;
  items: Item[];
  truncated: boolean;
  total: number;
}

const COLOR: Record<MovementClass, string> = { FAST: 'green', NORMAL: 'blue', SLOW: 'orange', DEAD: 'red', NEW: 'default', OUT: 'magenta', EMPTY: 'default' };
const SHOWN: MovementClass[] = ['OUT', 'FAST', 'NORMAL', 'SLOW', 'DEAD', 'NEW'];

export default function MovementPage() {
  const [filter, setFilter] = useState<MovementClass>();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['inventory', 'movement'], queryFn: () => get<Analysis>('/inventory/movement-analysis') });
  const a = q.data;
  const term = search.trim().toLowerCase();
  const rows = (a?.items ?? []).filter((i) => (filter ? i.cls === filter : i.cls !== 'EMPTY') && (!term || `${i.sku} ${i.name} ${i.category ?? ''}`.toLowerCase().includes(term)));
  const p = a?.profile;
  const model = a ? BUSINESS_MODEL_BY_KEY[a.model] : undefined;
  const sm = a?.summary;
  const cnt = (c: MovementClass) => sm?.[c]?.count ?? 0;
  const val = (...cs: MovementClass[]) => cs.reduce((t, c) => t + (sm?.[c]?.value ?? 0), 0);
  const total = SHOWN.reduce((t, c) => t + cnt(c), 0);

  return (
    <>
      <PageHeader title="Perputaran persediaan" />
      {a && p && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Untuk usaha ${model?.name ?? ''}: dihitung dari barang ${p.outWord} dalam ${p.windowDays} hari terakhir`}
          description={`Cepat bila stok habis dalam ${p.fastCoverDays} hari atau kurang, normal bila ${p.normalCoverDays} hari atau kurang, lambat bila lebih; tidak bergerak bila tidak keluar lebih dari ${p.deadDays} hari. Barang yang baru masuk tidak dinilai lambat. Jenis usaha diubah di Pengaturan › Perusahaan.`}
        />
      )}
      {a && (
        <SummaryCards
          items={[
            { label: 'Laku cepat & normal', value: `${cnt('FAST') + cnt('NORMAL')} barang`, hint: `nilai stok ${fmtMoney(val('FAST', 'NORMAL'))}`, tone: 'good' },
            { label: 'Lambat', value: `${cnt('SLOW')} barang`, hint: `nilai stok ${fmtMoney(val('SLOW'))}`, tone: cnt('SLOW') ? 'warn' : 'neutral', onClick: () => setFilter(filter === 'SLOW' ? undefined : 'SLOW'), active: filter === 'SLOW' },
            { label: 'Tidak bergerak & habis', value: `${cnt('DEAD') + cnt('OUT')} barang`, hint: `nilai stok ${fmtMoney(val('DEAD', 'OUT'))}`, tone: cnt('DEAD') + cnt('OUT') ? 'bad' : 'neutral', onClick: () => setFilter(filter === 'DEAD' ? undefined : 'DEAD'), active: filter === 'DEAD' },
          ]}
        />
      )}
      {filter && p?.actions[filter] && <Alert type={filter === 'DEAD' || filter === 'OUT' ? 'warning' : 'success'} showIcon style={{ marginBottom: 16 }} message={`Saran: ${p.actions[filter]}`} />}
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Segmented
              value={filter ?? 'ALL'}
              onChange={(v) => setFilter(v === 'ALL' ? undefined : (v as MovementClass))}
              options={[{ value: 'ALL', label: `Semua (${total})` }, ...SHOWN.map((c) => ({ value: c, label: `${MOVEMENT_LABELS[c]} (${cnt(c)})` }))]}
            />
          </div>
          <Input.Search allowClear placeholder="Cari SKU atau nama barang" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
        <ResponsiveTable
          rowKey="productId"
          loading={q.isLoading}
          dataSource={rows}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description={filter || term ? 'Tidak ada barang yang cocok dengan pilihan ini' : 'Belum ada barang bergerak untuk dianalisis'} /> }}
          columns={[
            { title: 'SKU', dataIndex: 'sku' },
            { title: 'Barang', dataIndex: 'name' },
            { title: 'Status', dataIndex: 'cls', render: (c: MovementClass) => <Tag color={COLOR[c]}>{MOVEMENT_LABELS[c]}</Tag> },
            { title: 'Stok', dataIndex: 'onHand', align: 'right', render: (v: number, r: Item) => `${fmtQty(v)} ${r.uom}` },
            { title: 'Nilai stok', dataIndex: 'value', align: 'right', render: fmtMoney },
            { title: `Keluar ${p?.windowDays ?? ''} hari`, dataIndex: 'soldInWindow', align: 'right', render: (v: number) => fmtQty(v) },
            { title: 'Cukup untuk', dataIndex: 'coverDays', align: 'right', render: (v: number | null) => (v === null ? '-' : `${v} hari`) },
            { title: 'Terakhir keluar', dataIndex: 'lastOutDate', render: (d: string | null) => (d ? fmtDate(d) : 'belum pernah') },
          ]}
        />
        {a?.truncated && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={`Menampilkan 1.000 dari ${a.total} barang (terurut prioritas).`} />}
      </Card>
    </>
  );
}
