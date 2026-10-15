import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, InputNumber, Progress, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

interface Row {
  userId: string;
  name: string;
  invoices: number;
  gross: string;
  returns: string;
  net: string;
  target: string;
  hasTarget: boolean;
  achievementPct: string | null;
  commissionPct: string;
  minAchievementPct: string;
  commission: string;
  commissionNote: string | null;
}
interface Perf {
  period: string;
  rows: Row[];
  totals: { net: string; target: string; commission: string };
}
interface Edit {
  target: number;
  commissionPct: number;
  minAchievementPct: number;
}

/** Target omzet dan komisi per sales lapangan (omzet neto = faktur − retur, tanpa PPN) */
export default function SalesTargetsPage() {
  const can = useCan();
  const canEdit = can('PUT', '/sales-targets');
  const [month, setMonth] = useState(dayjs());
  const period = month.format('YYYY-MM');
  const { data, isLoading } = useQuery({ queryKey: ['sales-targets', period], queryFn: () => get<Perf>(`/sales-targets?month=${period}`) });
  const [edit, setEdit] = useState<Record<string, Edit>>({});
  useEffect(() => {
    setEdit(Object.fromEntries((data?.rows ?? []).map((r) => [r.userId, { target: Number(r.target), commissionPct: Number(r.commissionPct), minAchievementPct: Number(r.minAchievementPct) }])));
  }, [data]);
  const save = useAction(
    () => put('/sales-targets', { period, items: Object.entries(edit).filter(([, e]) => e.target > 0 || e.commissionPct > 0).map(([userId, e]) => ({ userId, targetAmount: String(e.target), commissionPct: String(e.commissionPct), minAchievementPct: String(e.minAchievementPct) })) }),
    { success: 'Target disimpan', invalidate: ['sales-targets'] },
  );
  const set = (id: string, p: Partial<Edit>) => setEdit((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  return (
    <>
      <PageHeader title="Target & komisi sales" extra={<Space><DatePicker picker="month" allowClear={false} value={month} onChange={(v) => v && setMonth(v)} />{canEdit && <Button type="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan target</Button>}</Space>} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Omzet sales = DPP faktur dari pesanan yang dipegang sales itu, dikurangi retur penjualan di bulan yang sama. Komisi hanya perhitungan sebagai bahan penggajian/insentif; sistem tidak membuat jurnal komisi otomatis. Pilih sales di pesanan penjualan agar tercatat atas namanya." />
      <SummaryCards items={[
        { label: 'Omzet neto', value: fmtMoney(data?.totals.net) },
        { label: 'Target', value: fmtMoney(data?.totals.target), hint: Number(data?.totals.target) > 0 ? `${((Number(data?.totals.net) / Number(data?.totals.target)) * 100).toFixed(0)}% tercapai` : undefined },
        { label: 'Komisi bulan ini', value: fmtMoney(data?.totals.commission) },
      ]} />
      <Table<Row> style={{ marginTop: 12 }} rowKey="userId" loading={isLoading} dataSource={data?.rows} pagination={false} scroll={{ x: 900 }}
        locale={{ emptyText: 'Belum ada pengguna berperan Sales. Tambahkan di Pengaturan › Pengguna.' }}
        columns={[
          { title: 'Sales', dataIndex: 'name' },
          { title: 'Omzet neto', align: 'right' as const, render: (_: unknown, r: Row) => <div>{fmtMoney(r.net)}<div style={{ fontSize: 12, color: '#64748b' }}>{r.invoices} faktur · retur {fmtMoney(r.returns)}</div></div> },
          { title: 'Target', width: 170, render: (_: unknown, r: Row) => canEdit ? <InputNumber min={0} prefix="Rp" style={{ width: 150 }} value={edit[r.userId]?.target} onChange={(v) => set(r.userId, { target: v ?? 0 })} /> : fmtMoney(r.target) },
          { title: 'Pencapaian', width: 160, render: (_: unknown, r: Row) => r.achievementPct === null ? <Tag>Belum ada target</Tag> : <Progress percent={Math.min(100, Number(r.achievementPct))} format={() => `${r.achievementPct}%`} status={Number(r.achievementPct) >= 100 ? 'success' : 'active'} size="small" /> },
          { title: 'Komisi %', width: 110, render: (_: unknown, r: Row) => canEdit ? <InputNumber min={0} max={100} step={0.1} suffix="%" style={{ width: 90 }} value={edit[r.userId]?.commissionPct} onChange={(v) => set(r.userId, { commissionPct: v ?? 0 })} /> : `${r.commissionPct}%` },
          { title: 'Min. capaian', width: 110, render: (_: unknown, r: Row) => canEdit ? <InputNumber min={0} max={100} suffix="%" style={{ width: 90 }} value={edit[r.userId]?.minAchievementPct} onChange={(v) => set(r.userId, { minAchievementPct: v ?? 0 })} /> : `${r.minAchievementPct}%` },
          { title: 'Komisi', align: 'right' as const, render: (_: unknown, r: Row) => <div>{fmtMoney(r.commission)}{r.commissionNote && <div style={{ fontSize: 12, color: '#64748b' }}>{r.commissionNote}</div>}</div> },
        ]} />
    </>
  );
}
