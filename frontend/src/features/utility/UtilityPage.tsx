import { DEFAULT_UTILITY_RULES, READING_FLAG_LABELS, UTILITY_CONNECTION_LABELS, UTILITY_SERVICE_LABELS, type ReadingFlag, type UtilityConnectionStatus, type UtilityRules, type UtilityServiceType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import { CounterTab, FieldTab, ImportTab } from './UtilityFieldTabs';
import { ConnectionsTab } from './utility/ConnectionsTab';
import { ReadingsTab } from './utility/ReadingsTab';
import { BillingTab } from './utility/BillingTab';
import { TariffsTab } from './utility/TariffsTab';
import { STATUS_COLOR, thisMonth } from './utility/shared';

const SEV: Record<string, string> = { high: 'red', medium: 'orange' };

const COL: Record<string, string> = { number: 'Sambungan', customer: 'Pelanggan', address: 'Alamat', lastPeriod: 'Pencatatan terakhir', period: 'Periode', days: 'Hari', usage: 'Pemakaian', flags: 'Tanda', userName: 'Petugas', service: 'Layanan', n: 'Jumlah', numbers: 'Nomor sambungan', zone: 'Zona', supplied: 'Pasokan', lossPct: 'Kehilangan (%)', loss: 'Kehilangan', status: 'Keterangan' };

const ZONE_STATUS: Record<string, { label: string; color: string }> = { NO_SUPPLY: { label: 'Pasokan belum diisi', color: 'default' }, INCOMPLETE: { label: 'Belum lengkap', color: 'gold' }, HIGH: { label: 'Kehilangan tinggi', color: 'red' }, OK: { label: 'Wajar', color: 'green' }, NEGATIVE: { label: 'Pemakaian melebihi pasokan', color: 'volcano' } };

interface Summary { period: string; active: number; suspended: number; awaitingVerification: number; readyToBill: number; missingReadings: number; overdueCount: number; overdueTotal: number; suggestSuspend: number }

interface ZoneRow { zone: string; period: string; unit: string | null; mixedUnits: boolean; connections: number; supplied: number | null; usage: number; loss: number | null; lossPct: number | null; unverified: number; missing: number; note: string | null; status: string }

interface Overdue { id: string; number: string; status: UtilityConnectionStatus; address: string; customerName: string; phone: string | null; outstanding: string; daysLate: number; bills: number; suggestSuspend: boolean }

interface Control { key: string; title: string; severity: string; items: Record<string, unknown>[] }

export default function UtilityPage() {
  const { tab = 'ringkasan' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const can = useCan();
  const fin = !!me && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(me.role);
  const summary = useQuery({ queryKey: ['utility', 'summary'], queryFn: () => get<Summary>('/utility/summary'), refetchInterval: 60_000 });
  const tabs = [
    { key: 'ringkasan', label: 'Ringkasan', children: <Overview s={summary.data} go={(t) => navigate(`/utility/${t}`)} /> },
    { key: 'sambungan', label: 'Sambungan', children: <ConnectionsTab /> },
    ...(can('POST', '/utility/field/readings') ? [{ key: 'lapangan', label: 'Petugas lapangan', children: <FieldTab /> }] : []),
    ...(can('POST', '/utility/readings/import') || can('POST', '/utility/ingest-keys') ? [{ key: 'impor', label: 'Impor & alat meter', children: <ImportTab /> }] : []),
    ...(can('POST', '/utility/counter/pay') || can('POST', '/utility/counter/remit') ? [{ key: 'loket', label: 'Loket', children: <CounterTab /> }] : []),
    ...(fin ? [{ key: 'zona', label: 'Zona & kehilangan', children: <ZonesTab /> }] : []),
    { key: 'meter', label: `Catat meter${summary.data?.awaitingVerification ? ` (${summary.data.awaitingVerification})` : ''}`, children: <ReadingsTab /> },
    ...(fin ? [{ key: 'tagihan', label: 'Tagihan bulanan', children: <BillingTab /> }, { key: 'tunggakan', label: `Tunggakan${summary.data?.overdueCount ? ` (${summary.data.overdueCount})` : ''}`, children: <OverdueTab /> }] : []),
    { key: 'tarif', label: 'Tarif & aturan', children: <TariffsTab /> },
    ...(fin ? [{ key: 'kontrol', label: 'Kontrol', children: <ControlsTab /> }] : []),
  ];
  return (
    <>
      <PageHeader title="Layanan utilitas" />
      <Tabs activeKey={tabs.some((t) => t.key === tab) ? tab : 'ringkasan'} onChange={(k) => navigate(`/utility/${k}`)} items={tabs} destroyOnHidden />
    </>
  );
}

function Overview({ s, go }: { s?: Summary; go: (tab: string) => void }) {
  if (!s) return null;
  const Card1 = ({ title, value, tab, warn }: { title: string; value: number | string; tab: string; warn?: boolean }) => (
    <Col xs={12} md={8} lg={6}><Card size="small" hoverable onClick={() => go(tab)}><Statistic title={title} value={value} valueStyle={warn ? { color: '#d97706' } : undefined} /></Card></Col>
  );
  return (
    <>
      <Row gutter={[12, 12]}>
        <Card1 title="Sambungan aktif" value={s.active} tab="sambungan" />
        <Card1 title="Diputus sementara" value={s.suspended} tab="sambungan" />
        <Card1 title={`Belum dicatat (${s.period})`} value={s.missingReadings} tab="meter" warn={s.missingReadings > 0} />
        <Card1 title="Menunggu verifikasi" value={s.awaitingVerification} tab="meter" warn={s.awaitingVerification > 0} />
        <Card1 title="Siap ditagih" value={s.readyToBill} tab="tagihan" />
        <Card1 title="Tunggakan lewat jatuh tempo" value={fmtMoney(s.overdueTotal)} tab="tunggakan" warn={s.overdueTotal > 0} />
        <Card1 title="Pelanggan menunggak" value={s.overdueCount} tab="tunggakan" />
        <Card1 title="Usulan pemutusan" value={s.suggestSuspend} tab="tunggakan" warn={s.suggestSuspend > 0} />
      </Row>
      <Alert style={{ marginTop: 16 }} type="info" showIcon message="Alur bulanan" description="1) Petugas mencatat meter  →  2) Orang lain memverifikasi (angka janggal ditandai)  →  3) Keuangan menerbitkan tagihan (faktur otomatis, denda ikut dihitung)  →  4) Pembayaran lewat Penjualan › Faktur  →  5) Tunggakan melewati batas diusulkan putus dan disambung kembali oleh orang lain setelah lunas." />
    </>
  );
}

// ---------- Tunggakan ----------
function OverdueTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'overdue'], queryFn: () => get<Overdue[]>('/utility/overdue') });
  const rules = useQuery({ queryKey: ['utility', 'rules'], queryFn: () => get<UtilityRules>('/utility/rules') });
  const [act, setAct] = useState<Overdue | null>(null);
  const [af] = Form.useForm<{ reason: string }>();
  const suspend = useAction((v: { id: string; reason: string }) => post(`/utility/connections/${v.id}/suspend`, { reason: v.reason }), { success: 'Sambungan diputus sementara', invalidate: ['utility'], onSuccess: () => setAct(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Denda ${rules.data?.lateFeePct ?? DEFAULT_UTILITY_RULES.lateFeePct}% setelah ${rules.data?.graceDays ?? DEFAULT_UTILITY_RULES.graceDays} hari dari jatuh tempo (sekali per tagihan, ikut di tagihan bulan berikutnya). Usulan putus bila lewat ${rules.data?.suspendAfterDays ?? DEFAULT_UTILITY_RULES.suspendAfterDays} hari.`} />
      <ResponsiveTable<Overdue> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 20 }} scroll={{ x: 800 }} locale={{ emptyText: 'Tidak ada tunggakan melewati jatuh tempo' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, o: Overdue) => `${o.number} · ${o.customerName}` },
          { title: 'Alamat', dataIndex: 'address', ellipsis: true },
          { title: 'Telepon', dataIndex: 'phone' },
          { title: 'Tagihan', dataIndex: 'bills', align: 'right' as const },
          { title: 'Tunggakan', align: 'right' as const, render: (_: unknown, o: Overdue) => fmtMoney(o.outstanding) },
          { title: 'Terlambat', render: (_: unknown, o: Overdue) => <Tag color={o.daysLate > 30 ? 'red' : 'orange'}>{o.daysLate} hari</Tag> },
          { title: 'Status', render: (_: unknown, o: Overdue) => <Tag color={STATUS_COLOR[o.status]}>{UTILITY_CONNECTION_LABELS[o.status]}</Tag> },
          { render: (_: unknown, o: Overdue) => (o.suggestSuspend && can('POST', '/utility/connections/:id/suspend') ? <Button size="small" danger onClick={() => { af.resetFields(); setAct(o); }}>Putus sementara</Button> : null) },
        ]}
      />
      <Modal title={act ? `Putus sementara — ${act.number}` : ''} open={!!act} onCancel={() => setAct(null)} onOk={() => af.submit()} confirmLoading={suspend.isPending} okText="Putus" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={af} layout="vertical" onFinish={(v) => suspend.mutate({ id: act!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Dasar pemutusan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} placeholder="mis. menunggak 2 tagihan; sudah diingatkan 3x" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ---------- Kontrol ----------
function ControlsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'controls'], queryFn: () => get<Control[]>('/utility/controls') });
  if (isLoading) return null;
  const any = (data ?? []).some((c) => c.items.length);
  return (
    <>
      {!any && <Alert type="success" showIcon message="Tidak ada temuan saat ini." />}
      {(data ?? []).filter((c) => c.items.length).map((c) => (
        <Card key={c.key} size="small" style={{ marginBottom: 12 }} title={<span><Tag color={SEV[c.severity]}>{c.items.length}</Tag> {c.title}</span>}>
          <Table size="small" rowKey={(r) => JSON.stringify(r)} pagination={{ pageSize: 5 }} dataSource={c.items}
            columns={Object.keys(c.items[0]).map((k) => ({ title: COL[k] ?? k, dataIndex: k, render: (v: unknown) => (Array.isArray(v) ? v.map((f) => READING_FLAG_LABELS[f as ReadingFlag] ?? String(f)).join(', ') : k === 'status' && ZONE_STATUS[String(v)] ? ZONE_STATUS[String(v)].label : k === 'service' ? UTILITY_SERVICE_LABELS[v as UtilityServiceType] ?? String(v) : String(v ?? '-')) }))} />
        </Card>
      ))}
    </>
  );
}

// ---------- Zona & kehilangan ----------
function ZonesTab() {
  const can = useCan();
  const [period, setPeriod] = useState(thisMonth());
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'zones', period], queryFn: () => get<{ period: string; warnPct: number; rows: ZoneRow[] }>(`/utility/zones?period=${period}`) });
  const [row, setRow] = useState<ZoneRow | null>(null);
  const [f] = Form.useForm<{ supplied: number; note?: string }>();
  const save = useAction((v: { zone: string; supplied: number; note?: string }) => put('/utility/zones/supply', { zone: v.zone, period, supplied: String(v.supplied), note: v.note }), { success: 'Pasokan tersimpan', invalidate: ['utility'], onSuccess: () => setRow(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Kehilangan = jumlah masuk zona (meter induk/sumber) dikurangi pemakaian pelanggan terverifikasi. Di atas ${data?.warnPct ?? 20}% perlu dicek: kebocoran, sambungan liar, atau meter rusak. Pasokan diisi Admin/Keuangan, pencatat meter orang lain.`} />
      <Space style={{ marginBottom: 12 }}><span>Periode</span><DatePicker picker="month" allowClear={false} value={dayjs(`${period}-01`)} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs())} /></Space>
      <ResponsiveTable<ZoneRow> rowKey="zone" size="small" loading={isLoading} dataSource={data?.rows} pagination={false} locale={{ emptyText: 'Belum ada zona. Isi zona pada sambungan di tab Sambungan.' }}
        columns={[
          { title: 'Zona', dataIndex: 'zone' },
          { title: 'Sambungan', dataIndex: 'connections', align: 'right' },
          { title: 'Pasokan', align: 'right', render: (_: unknown, r: ZoneRow) => (r.supplied == null ? '-' : `${fmtQty(r.supplied)} ${r.unit ?? ''}`) },
          { title: 'Pemakaian', align: 'right', render: (_: unknown, r: ZoneRow) => `${fmtQty(r.usage)} ${r.unit ?? ''}` },
          { title: 'Kehilangan', align: 'right', render: (_: unknown, r: ZoneRow) => (r.loss == null ? '-' : `${fmtQty(r.loss)} ${r.unit ?? ''} (${r.lossPct ?? 0}%)`) },
          { title: 'Keterangan', render: (_: unknown, r: ZoneRow) => <Space direction="vertical" size={0}><Tag color={ZONE_STATUS[r.status]?.color}>{ZONE_STATUS[r.status]?.label ?? r.status}</Tag>{(r.unverified > 0 || r.missing > 0) && <Typography.Text type="secondary">{r.unverified} belum diverifikasi, {r.missing} belum dicatat</Typography.Text>}{r.mixedUnits && <Typography.Text type="danger">Satuan layanan berbeda dalam satu zona</Typography.Text>}</Space> },
          { render: (_: unknown, r: ZoneRow) => can('PUT', '/utility/zones/supply') && !r.mixedUnits && <Button size="small" onClick={() => { f.setFieldsValue({ supplied: r.supplied ?? undefined, note: r.note ?? undefined }); setRow(r); }}>Isi pasokan</Button> },
        ]}
      />
      <Modal title={row ? `Pasokan ${row.zone} — ${period}` : ''} open={!!row} onCancel={() => setRow(null)} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={f} layout="vertical" onFinish={(v) => save.mutate({ zone: row!.zone, ...v })}>
          <Form.Item name="supplied" label={`Jumlah masuk zona${row?.unit ? ` (${row.unit})` : ''}`} rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="note" label="Catatan / sumber angka"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
