import { useQuery } from '@tanstack/react-query';
import { t } from '@/lib/terms';
import { Alert, Card, Empty, Input, InputNumber, Segmented, Space, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { get } from '@/api/client';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Row_ {
  orderId: string;
  number: string;
  date: string;
  product: string;
  batches: number;
  createdBy: string | null;
  plannedOutput: number;
  actualOutput: number;
  yieldPct: number;
  yieldValue: number;
  materials: { sku: string; name: string; planned: number; issued: number; pct: number; value: number }[];
  materialValue: number;
  laborVariance: number;
  overheadVariance: number;
  flags: string[];
}
interface Report {
  tolerancePct: number;
  rows: Row_[];
  byMaterial: { sku: string; name: string; planned: number; issued: number; value: number }[];
  totals: { orders: number; flagged: number; materialValue: number; yieldValue: number; laborVariance: number; overheadVariance: number };
}

const FLAG: Record<string, { label: string; hint: string }> = {
  HIGH_USAGE: { label: 'Bahan berlebih', hint: t('Pemakaian bahan di atas standar resep melebihi toleransi — periksa pemborosan atau kebocoran bahan') },
  LOW_YIELD: { label: 'Hasil rendah', hint: 'Hasil jadi di bawah rencana melebihi toleransi — periksa susut, cacat, atau pencatatan hasil' },
};
const signed = (v: number) => (v === 0 ? '-' : <span style={{ color: v > 0 ? '#d46b08' : '#389e0d' }}>{`${v > 0 ? 'Lebih' : 'Hemat'} ${fmtMoney(Math.abs(v))}`}</span>);

/** Analisis selisih produksi: pemakaian bahan, hasil, dan biaya konversi sesungguhnya vs standar resep */
export default function ProductionVariancePage() {
  const [tol, setTol] = useState(3);
  const q = useQuery({ queryKey: ['production', 'variance', tol], queryFn: () => get<Report>(`/production/variance?tolerancePct=${tol}`) });
  const r = q.data;
  const [view, setView] = useState<'ALL' | 'FLAG'>('ALL');
  const [search, setSearch] = useState('');
  const allRows = r?.rows ?? [];
  const term = search.trim().toLowerCase();
  const shown = allRows.filter((x) => (view === 'ALL' || x.flags.length > 0) && (!term || `${x.number} ${x.product}`.toLowerCase().includes(term)));
  return (
    <>
      <PageHeader title="Analisis selisih produksi" extra={<Space>Toleransi <InputNumber min={0} max={100} step={0.5} value={tol} onChange={(v) => setTol(Number(v ?? 3))} addonAfter="%" /></Space>} />
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("Membandingkan setiap perintah produksi yang selesai dengan standar resepnya: bahan yang benar-benar keluar gudang, hasil jadi, serta upah dan overhead yang dibebankan. Perintah dengan pemakaian bahan atau hasil di luar toleransi diberi penanda untuk ditinjau.")} />
      {r && (
        <SummaryCards
          items={[
            { label: 'Perintah selesai', value: String(r.totals.orders), hint: t('dibandingkan dengan resep') },
            { label: 'Perlu ditinjau', value: String(r.totals.flagged), hint: 'di luar batas toleransi', tone: r.totals.flagged ? 'bad' : 'good', onClick: () => setView('FLAG'), active: view === 'FLAG' },
            { label: 'Selisih pemakaian bahan', value: fmtMoney(Math.abs(r.totals.materialValue)), hint: t(r.totals.materialValue > 0 ? 'bahan lebih banyak dari resep' : r.totals.materialValue < 0 ? 'bahan lebih hemat dari resep' : 'sesuai resep'), tone: r.totals.materialValue > 0 ? 'warn' : 'neutral' },
          ]}
        />
      )}
      {r && r.byMaterial.length > 0 && (
        <Card size="small" title="Per bahan" style={{ marginBottom: 16 }}>
          <ResponsiveTable
            rowKey="sku"
            size="small"
            pagination={false}
            dataSource={r.byMaterial}
            scroll={{ x: 520 }}
            columns={[
              { title: 'Bahan', render: (_, m) => `${m.sku} · ${m.name}` },
              { title: 'Standar', align: 'right', dataIndex: 'planned' },
              { title: 'Dikeluarkan', align: 'right', dataIndex: 'issued' },
              { title: 'Selisih nilai', align: 'right', render: (_, m) => signed(m.value) },
            ]}
          />
        </Card>
      )}
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as typeof view)}
              options={[
                { value: 'ALL', label: `Semua (${allRows.length})` },
                { value: 'FLAG', label: `Perlu ditinjau (${allRows.filter((x) => x.flags.length).length})` },
              ]}
            />
          </div>
          <Input.Search allowClear placeholder="Cari nomor atau produk" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
      <ResponsiveTable
        rowKey="orderId"
        loading={q.isLoading}
        dataSource={shown}
        scroll={{ x: 1000 }}
        locale={{ emptyText: <Empty description={allRows.length ? 'Tidak ada perintah yang cocok dengan pilihan ini' : 'Belum ada produksi yang selesai untuk dibandingkan'} /> }}
        columns={[
          { title: 'Selesai', dataIndex: 'date', render: fmtDate, width: 100 },
          { title: 'Perintah', dataIndex: 'number' },
          { title: 'Produk', dataIndex: 'product' },
          { title: 'Hasil (rencana → nyata)', align: 'right', render: (_, x: Row_) => `${x.plannedOutput} → ${x.actualOutput}${x.yieldPct ? ` (kurang ${Math.abs(x.yieldPct)}%)` : ''}` },
          { title: 'Selisih bahan', align: 'right', render: (_, x: Row_) => signed(x.materialValue) },
          { title: 'Selisih upah', align: 'right', render: (_, x: Row_) => signed(x.laborVariance) },
          { title: 'Selisih overhead', align: 'right', render: (_, x: Row_) => signed(x.overheadVariance) },
          { title: 'Dibuat oleh', dataIndex: 'createdBy', render: (v) => v ?? '-' },
          { title: 'Penanda', render: (_, x: Row_) => x.flags.map((f) => <Tooltip key={f} title={FLAG[f]?.hint}><Tag color="red">{FLAG[f]?.label ?? f}</Tag></Tooltip>) },
        ]}
        expandable={{
          rowExpandable: (x: Row_) => x.materials.length > 0,
          expandedRowRender: (x: Row_) => (
            <ResponsiveTable
              rowKey="sku"
              size="small"
              pagination={false}
              dataSource={x.materials}
              columns={[
                { title: 'Bahan', render: (_, m) => `${m.sku} · ${m.name}` },
                { title: 'Standar', align: 'right', dataIndex: 'planned' },
                { title: 'Dikeluarkan', align: 'right', dataIndex: 'issued' },
                { title: '%', align: 'right', render: (_, m) => (m.pct ? `${m.pct > 0 ? 'Lebih' : 'Hemat'} ${Math.abs(m.pct)}%` : '-') },
                { title: 'Selisih nilai', align: 'right', render: (_, m) => signed(m.value) },
              ]}
            />
          ),
        }}
      />
      </Card>
    </>
  );
}
