/**
 * Perputaran stok: barang cepat keluar, lambat, dan tidak bergerak. Ambang & saran menyesuaikan jenis usaha
 * (toko berputar mingguan, dagang bulanan, produksi mengikuti bahan, jasa bahan kerja).
 */
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Statistic, Tag, Typography } from 'antd';
import { BUSINESS_MODEL_BY_KEY, MOVEMENT_LABELS, type BusinessModel, type MovementClass, type MovementProfile } from '@sansu/shared';
import { useState } from 'react';
import { get } from '@/api/client';
import ResponsiveTable from '@/components/ResponsiveTable';
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
  const q = useQuery({ queryKey: ['inventory', 'movement'], queryFn: () => get<Analysis>('/inventory/movement-analysis') });
  const a = q.data;
  const rows = (a?.items ?? []).filter((i) => (filter ? i.cls === filter : i.cls !== 'EMPTY'));
  const p = a?.profile;
  const model = a ? BUSINESS_MODEL_BY_KEY[a.model] : undefined;

  return (
    <>
      <PageHeader title="Perputaran stok" />
      {a && p && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Untuk usaha ${model?.name ?? ''}: dihitung dari barang ${p.outWord} dalam ${p.windowDays} hari terakhir`}
          description={`Cepat bila stok habis dalam ≤ ${p.fastCoverDays} hari, normal ≤ ${p.normalCoverDays} hari, lambat bila lebih; tidak bergerak bila tidak keluar lebih dari ${p.deadDays} hari. Barang yang baru masuk tidak dinilai lambat. Jenis usaha diubah di Pengaturan › Perusahaan.`}
        />
      )}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {SHOWN.map((c) => (
          <Col key={c} xs={12} md={8} lg={4}>
            <Card size="small" hoverable loading={q.isLoading} onClick={() => setFilter(filter === c ? undefined : c)} style={filter === c ? { borderColor: '#1677ff' } : undefined}>
              <Statistic title={MOVEMENT_LABELS[c]} value={a?.summary[c].count ?? 0} suffix="barang" />
              <Typography.Text type="secondary">{fmtMoney(a?.summary[c].value ?? 0)}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
      {filter && p?.actions[filter] && <Alert type={filter === 'DEAD' || filter === 'OUT' ? 'warning' : 'success'} showIcon style={{ marginBottom: 16 }} message={`Saran: ${p.actions[filter]}`} />}
      <Card>
        <ResponsiveTable
          rowKey="productId"
          loading={q.isLoading}
          dataSource={rows}
          scroll={{ x: 900 }}
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
