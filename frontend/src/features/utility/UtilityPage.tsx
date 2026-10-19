import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { DEFAULT_UTILITY_RULES, READING_FLAG_LABELS, UTILITY_CONNECTION_LABELS, UTILITY_READING_LABELS, UTILITY_SERVICE_DEFAULTS, UTILITY_SERVICE_LABELS, UTILITY_SERVICE_TYPES, type ReadingFlag, type UtilityConnectionStatus, type UtilityReadingStatus, type UtilityRules, type UtilityServiceType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const SEV: Record<string, string> = { high: 'red', medium: 'orange' };
const STATUS_COLOR: Record<UtilityConnectionStatus, string> = { ACTIVE: 'green', SUSPENDED: 'orange', DISCONNECTED: 'default' };
const READ_COLOR: Record<UtilityReadingStatus, string> = { ENTERED: 'gold', VERIFIED: 'blue', BILLED: 'green', REJECTED: 'red' };
const COL: Record<string, string> = { number: 'Sambungan', customer: 'Pelanggan', address: 'Alamat', lastPeriod: 'Pencatatan terakhir', period: 'Periode', days: 'Hari', usage: 'Pemakaian', flags: 'Tanda', userName: 'Petugas', service: 'Layanan', n: 'Jumlah', numbers: 'Nomor sambungan' };
const thisMonth = () => dayjs().format('YYYY-MM');

interface Summary { period: string; active: number; suspended: number; awaitingVerification: number; readyToBill: number; missingReadings: number; overdueCount: number; overdueTotal: number; suggestSuspend: number }
interface Tariff { id: string; name: string; serviceType: UtilityServiceType; unit: string; metered: boolean; fixedFee: string; adminFee: string; minUsage: string; blocks: { upTo: number | null; price: number }[]; vatable: boolean; isActive: boolean; connections: number }
interface Connection { id: string; number: string; status: UtilityConnectionStatus; meterNo: string | null; address: string; installedAt: string; statusNote: string | null; customerName: string; tariffName: string; serviceType: UtilityServiceType; unit: string; metered: boolean; lastReading: string | null; lastPeriod: string | null }
interface Reading { id: string; period: string; previous: string; current: string; usage: string; status: UtilityReadingStatus; flags: ReadingFlag[]; meterReplaced: boolean; note: string | null; verifyNote: string | null; connectionNumber: string; meterNo: string | null; customerName: string; unit: string; enteredByName: string | null; enteredById: string; verifiedByName: string | null }
interface Due { id: string; number: string; meterNo: string | null; address: string; customerName: string; unit: string; previous: string }
interface Preview {
  period: string;
  ready: { connectionId: string; number: string; customerName: string; tariffName: string; usage: number | null; unit: string; subtotal: number; lateFee: number; lateFeeOf: string[] }[];
  held: { connectionId: string; number: string; customerName: string; reason: string }[];
  totals: { count: number; subtotal: number; lateFee: number };
}
interface RunResult { period: string; billedCount: number; billedTotal: number; billed: { number: string; invoice: string; total: number }[]; failed: { number: string; reason: string }[]; held: { number: string; reason: string }[] }
interface Overdue { id: string; number: string; status: UtilityConnectionStatus; address: string; customerName: string; phone: string | null; outstanding: string; daysLate: number; bills: number; suggestSuspend: boolean }
interface Control { key: string; title: string; severity: string; items: Record<string, unknown>[] }

export default function UtilityPage() {
  const { tab = 'ringkasan' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const fin = !!me && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(me.role);
  const summary = useQuery({ queryKey: ['utility', 'summary'], queryFn: () => get<Summary>('/utility/summary'), refetchInterval: 60_000 });
  const tabs = [
    { key: 'ringkasan', label: 'Ringkasan', children: <Overview s={summary.data} go={(t) => navigate(`/utility/${t}`)} /> },
    { key: 'sambungan', label: 'Sambungan', children: <ConnectionsTab /> },
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

// ---------- Sambungan ----------
function ConnectionsTab() {
  const can = useCan();
  const [status, setStatus] = useState<string>();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'connections', status, search], queryFn: () => get<Connection[]>(`/utility/connections?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`) });
  const tariffs = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const customers = useCustomers();
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [act, setAct] = useState<{ c: Connection; mode: 'suspend' | 'reconnect' | 'disconnect' } | null>(null);
  const [form] = Form.useForm();
  const [af] = Form.useForm<{ reason: string; onRequest?: boolean }>();
  const tariffId = Form.useWatch('tariffId', form);
  const metered = tariffs.data?.find((t) => t.id === tariffId)?.metered;
  const create = useAction((v: Record<string, unknown>) => post('/utility/connections', { ...v, installedAt: (v.installedAt as dayjs.Dayjs | undefined)?.format('YYYY-MM-DD') }), { success: 'Sambungan didaftarkan', invalidate: ['utility'], onSuccess: () => setCreating(false) });
  const doAct = useAction((v: { id: string; mode: string; reason: string; onRequest?: boolean }) => post(`/utility/connections/${v.id}/${v.mode}`, { reason: v.reason, onRequest: v.onRequest }), { success: 'Tersimpan', invalidate: ['utility'], onSuccess: () => setAct(null) });
  const TITLE = { suspend: 'Putus sementara', reconnect: 'Sambung kembali', disconnect: 'Bongkar sambungan (permanen)' } as const;
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Cari nama, nomor, meter, alamat" onSearch={setSearch} style={{ width: 260 }} />
        <Select allowClear placeholder="Semua status" style={{ width: 180 }} value={status} onChange={setStatus} options={Object.entries(UTILITY_CONNECTION_LABELS).map(([value, label]) => ({ value, label }))} />
        {can('POST', '/utility/connections') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Sambungan baru</Button>}
      </Space>
      <ResponsiveTable<Connection> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada sambungan' }}
        columns={[
          { title: 'No. sambungan', dataIndex: 'number', render: (v: string, c: Connection) => <a onClick={() => setDetail(c.id)}>{v}</a> },
          { title: 'Pelanggan', dataIndex: 'customerName' },
          { title: 'Alamat', dataIndex: 'address', ellipsis: true },
          { title: 'Layanan', render: (_: unknown, c: Connection) => `${c.tariffName}${c.meterNo ? ` · meter ${c.meterNo}` : ''}` },
          { title: 'Meter terakhir', render: (_: unknown, c: Connection) => (c.metered ? `${c.lastReading ?? '-'} ${c.unit}${c.lastPeriod ? ` (${c.lastPeriod})` : ''}` : 'tarif tetap') },
          { title: 'Status', render: (_: unknown, c: Connection) => <Tag color={STATUS_COLOR[c.status]}>{UTILITY_CONNECTION_LABELS[c.status]}</Tag> },
          {
            render: (_: unknown, c: Connection) => (
              <Space wrap>
                {c.status === 'ACTIVE' && can('POST', '/utility/connections/:id/suspend') && <Button size="small" onClick={() => { af.resetFields(); setAct({ c, mode: 'suspend' }); }}>Putus sementara</Button>}
                {c.status === 'SUSPENDED' && can('POST', '/utility/connections/:id/reconnect') && <Button size="small" type="primary" onClick={() => { af.resetFields(); setAct({ c, mode: 'reconnect' }); }}>Sambung kembali</Button>}
                {c.status !== 'DISCONNECTED' && can('POST', '/utility/connections/:id/disconnect') && <Button size="small" danger onClick={() => { af.resetFields(); setAct({ c, mode: 'disconnect' }); }}>Bongkar</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Sambungan baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Daftarkan" destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Daftarkan sambungan setelah pemasangan selesai dan biaya sambung dibayar. Pemasang dan pendaftar sebaiknya orang berbeda." />
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ initialReading: 0 }}>
          <Form.Item name="customerId" label="Pelanggan" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive !== false).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="tariffId" label="Tarif / layanan" rules={[{ required: true }]}><Select options={(tariffs.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.name} (${UTILITY_SERVICE_LABELS[t.serviceType]})` }))} /></Form.Item>
          <Form.Item name="address" label="Alamat pemasangan" rules={[{ required: true, min: 5 }]}><Input maxLength={300} /></Form.Item>
          {metered && <Form.Item name="meterNo" label="Nomor meter" rules={[{ required: true }]}><Input maxLength={60} /></Form.Item>}
          {metered && <Form.Item name="initialReading" label="Angka meter saat dipasang"><InputNumber min={0} style={{ width: 200 }} /></Form.Item>}
          <Form.Item name="installedAt" label="Tanggal pasang"><DatePicker disabledDate={(d) => d.isAfter(dayjs())} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={act ? `${TITLE[act.mode]} — ${act.c.number}` : ''} open={!!act} onCancel={() => setAct(null)} onOk={() => af.submit()} confirmLoading={doAct.isPending} okText="Simpan" okButtonProps={{ danger: act?.mode !== 'reconnect' }} destroyOnHidden>
        {act?.mode === 'suspend' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Pemutusan hanya untuk tunggakan melewati batas hari, atau atas permintaan pelanggan. Sambung kembali harus dilakukan orang lain setelah lunas." />}
        <Form form={af} layout="vertical" onFinish={(v) => doAct.mutate({ id: act!.c.id, mode: act!.mode, ...v })}>
          <Form.Item name="reason" label="Alasan / dasar" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
          {act?.mode === 'suspend' && <Form.Item name="onRequest" valuePropName="checked"><Checkbox>Atas permintaan pelanggan (tanpa tunggakan)</Checkbox></Form.Item>}
        </Form>
      </Modal>
      <ConnectionDrawer id={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function ConnectionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['utility', 'connection', id],
    queryFn: () => get<Connection & { readings: Reading[]; bills: { id: string; period: string; usage: string | null; total: string; paidAmount: string; invoiceNumber: string | null; status: string | null; dueDate: string | null; lateFee: string }[] }>(`/utility/connections/${id}`),
    enabled: !!id,
  });
  return (
    <Drawer open={!!id} onClose={onClose} width={Math.min(720, window.innerWidth)} title={data ? `Sambungan ${data.number}` : 'Sambungan'}>
      {!data ? null : (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Pelanggan">{data.customerName}</Descriptions.Item>
            <Descriptions.Item label="Alamat">{data.address}</Descriptions.Item>
            <Descriptions.Item label="Layanan">{data.tariffName}{data.meterNo ? ` · meter ${data.meterNo}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Dipasang">{fmtDate(data.installedAt)}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={STATUS_COLOR[data.status]}>{UTILITY_CONNECTION_LABELS[data.status]}</Tag>{data.statusNote}</Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 16 }}>Tagihan</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={data.bills} locale={{ emptyText: <Empty description="Belum ada tagihan" /> }}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Pemakaian', dataIndex: 'usage', render: (v: string | null) => (v == null ? '-' : Number(v)) },
              { title: 'Faktur', dataIndex: 'invoiceNumber', render: (v: string | null) => v ?? 'tertahan' },
              { title: 'Total', align: 'right', dataIndex: 'total', render: (v: string | null) => fmtMoney(v) },
              { title: 'Sisa', align: 'right', render: (_: unknown, b: { total: string; paidAmount: string }) => fmtMoney(Number(b.total) - Number(b.paidAmount)) },
              { title: 'Jatuh tempo', dataIndex: 'dueDate', render: (v: string | null) => fmtDate(v) },
            ]}
          />
          <Typography.Title level={5} style={{ marginTop: 16 }}>Riwayat meter</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={data.readings}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Awal → akhir', render: (_: unknown, r: Reading) => `${Number(r.previous)} → ${Number(r.current)}` },
              { title: 'Pakai', dataIndex: 'usage', render: (v: string) => Number(v) },
              { title: 'Status', render: (_: unknown, r: Reading) => <Tag color={READ_COLOR[r.status]}>{UTILITY_READING_LABELS[r.status]}</Tag> },
              { title: 'Dicatat → diverifikasi', render: (_: unknown, r: Reading) => `${r.enteredByName ?? '-'}${r.verifiedByName ? ` → ${r.verifiedByName}` : ''}` },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

// ---------- Catat meter ----------
function FlagTags({ flags }: { flags: ReadingFlag[] }) {
  return <>{flags.map((f) => <Tag key={f} color={f === 'METER_DIGANTI' ? 'blue' : 'orange'}>{READING_FLAG_LABELS[f]}</Tag>)}</>;
}

function ReadingsTab() {
  const can = useCan();
  const [period, setPeriod] = useState(thisMonth());
  const due = useQuery({ queryKey: ['utility', 'due', period], queryFn: () => get<Due[]>(`/utility/readings/due?period=${period}`), enabled: can('POST', '/utility/readings') });
  const list = useQuery({ queryKey: ['utility', 'readings', period], queryFn: () => get<Reading[]>(`/utility/readings?period=${period}`) });
  const [entering, setEntering] = useState<Due | null>(null);
  const [deciding, setDeciding] = useState<{ r: Reading; mode: 'verify' | 'reject' } | null>(null);
  const [ef] = Form.useForm();
  const [df] = Form.useForm<{ note?: string; reason?: string }>();
  const replaced = Form.useWatch('meterReplaced', ef);
  const enter = useAction((v: { connectionId: string; current: number; meterReplaced?: boolean; oldMeterFinal?: number; newMeterStart?: number; note?: string }) => post<Reading>('/utility/readings', { ...v, period, current: String(v.current), oldMeterFinal: v.oldMeterFinal == null ? undefined : String(v.oldMeterFinal), newMeterStart: v.newMeterStart == null ? undefined : String(v.newMeterStart) }), { success: 'Angka meter dicatat — menunggu verifikasi', invalidate: ['utility'], onSuccess: () => setEntering(null) });
  const decide = useAction((v: { id: string; mode: 'verify' | 'reject'; note?: string; reason?: string }) => post(`/utility/readings/${v.id}/${v.mode}`, v.mode === 'verify' ? { note: v.note } : { reason: v.reason }), { success: 'Tersimpan', invalidate: ['utility'], onSuccess: () => setDeciding(null) });
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Periode</span>
        <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
      </Space>
      {can('POST', '/utility/readings') && (
        <>
          <Typography.Title level={5}>Belum dicatat ({due.data?.length ?? 0})</Typography.Title>
          <ResponsiveTable<Due> rowKey="id" size="small" loading={due.isLoading} dataSource={due.data} pagination={{ pageSize: 10 }} locale={{ emptyText: 'Semua sambungan sudah dicatat untuk periode ini' }}
            columns={[
              { title: 'Sambungan', dataIndex: 'number' },
              { title: 'Pelanggan', dataIndex: 'customerName' },
              { title: 'Alamat', dataIndex: 'address', ellipsis: true },
              { title: 'Meter', dataIndex: 'meterNo' },
              { title: 'Angka sebelumnya', render: (_: unknown, d: Due) => `${Number(d.previous)} ${d.unit}` },
              { render: (_: unknown, d: Due) => <Button size="small" type="primary" onClick={() => { ef.resetFields(); setEntering(d); }}>Catat</Button> },
            ]}
          />
        </>
      )}
      <Typography.Title level={5} style={{ marginTop: 20 }}>Pencatatan periode {period}</Typography.Title>
      <ResponsiveTable<Reading> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada pencatatan' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, r: Reading) => `${r.connectionNumber} · ${r.customerName}` },
          { title: 'Awal → akhir', render: (_: unknown, r: Reading) => `${Number(r.previous)} → ${Number(r.current)}` },
          { title: 'Pemakaian', render: (_: unknown, r: Reading) => <span><b>{Number(r.usage)}</b> {r.unit} <FlagTags flags={r.flags} /></span> },
          { title: 'Status', render: (_: unknown, r: Reading) => <Tag color={READ_COLOR[r.status]}>{UTILITY_READING_LABELS[r.status]}</Tag> },
          { title: 'Dicatat → diperiksa', render: (_: unknown, r: Reading) => `${r.enteredByName ?? '-'}${r.verifiedByName ? ` → ${r.verifiedByName}` : ''}` },
          {
            render: (_: unknown, r: Reading) =>
              r.status === 'ENTERED' ? (
                <Space wrap>
                  {can('POST', '/utility/readings/:id/verify') && <Button size="small" type="primary" onClick={() => { df.resetFields(); setDeciding({ r, mode: 'verify' }); }}>Verifikasi</Button>}
                  {can('POST', '/utility/readings/:id/reject') && <Button size="small" danger onClick={() => { df.resetFields(); setDeciding({ r, mode: 'reject' }); }}>Tolak</Button>}
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal title={entering ? `Catat meter — ${entering.number}` : ''} open={!!entering} onCancel={() => setEntering(null)} onOk={() => ef.submit()} confirmLoading={enter.isPending} okText="Simpan" destroyOnHidden>
        {entering && <Typography.Paragraph type="secondary">{entering.customerName} · {entering.address}<br />Angka sebelumnya: <b>{Number(entering.previous)} {entering.unit}</b></Typography.Paragraph>}
        <Form form={ef} layout="vertical" onFinish={(v) => enter.mutate({ ...v, connectionId: entering!.id })}>
          <Form.Item name="current" label={replaced ? 'Angka meter BARU sekarang' : 'Angka meter sekarang'} rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="meterReplaced" valuePropName="checked"><Checkbox>Meter diganti pada periode ini</Checkbox></Form.Item>
          {replaced && (
            <>
              <Form.Item name="oldMeterFinal" label="Angka akhir meter LAMA" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
              <Form.Item name="newMeterStart" label="Angka awal meter BARU" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
            </>
          )}
          <Form.Item name="note" label="Catatan" rules={replaced ? [{ required: true, message: 'Tulis nomor meter baru dan alasan' }] : []}><Input.TextArea rows={2} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={deciding?.mode === 'verify' ? 'Verifikasi pencatatan' : 'Tolak pencatatan'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Simpan" okButtonProps={{ danger: deciding?.mode === 'reject' }} destroyOnHidden>
        {deciding && <Typography.Paragraph>{deciding.r.connectionNumber} · {deciding.r.customerName}: <b>{Number(deciding.r.usage)} {deciding.r.unit}</b> <FlagTags flags={deciding.r.flags} /></Typography.Paragraph>}
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate({ id: deciding!.r.id, mode: deciding!.mode, ...v })}>
          {deciding?.mode === 'verify' ? (
            <Form.Item name="note" label={deciding.r.flags.length ? 'Catatan pemeriksaan (wajib — angka ditandai janggal)' : 'Catatan (opsional)'} rules={deciding.r.flags.length ? [{ required: true, min: 5, message: 'Minimal 5 huruf' }] : []}><Input.TextArea rows={2} maxLength={255} placeholder="mis. sudah dicek ulang di lapangan / cocok dengan foto meter" /></Form.Item>
          ) : (
            <Form.Item name="reason" label="Alasan penolakan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={2} maxLength={255} /></Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}

// ---------- Tagihan bulanan ----------
function BillingTab() {
  const can = useCan();
  const [period, setPeriod] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const preview = useQuery({ queryKey: ['utility', 'preview', period], queryFn: () => get<Preview>(`/utility/billing/preview?period=${period}`) });
  const [result, setResult] = useState<RunResult | null>(null);
  const run = useAction(() => post<RunResult>('/utility/billing/run', { period }), { success: 'Penagihan selesai', invalidate: ['utility', 'invoices'], onSuccess: (r) => setResult(r as RunResult) });
  const p = preview.data;
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Periode</span>
        <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => { if (d) { setPeriod(d.format('YYYY-MM')); setResult(null); } }} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
        {can('POST', '/utility/billing/run') && (
          <Popconfirm title={`Terbitkan ${p?.totals.count ?? 0} tagihan periode ${period}?`} description="Faktur dibuat otomatis dan tidak bisa diterbitkan dua kali untuk periode yang sama." onConfirm={() => run.mutate(undefined)} disabled={!p?.totals.count}>
            <Button type="primary" disabled={!p?.totals.count} loading={run.isPending}>Terbitkan tagihan</Button>
          </Popconfirm>
        )}
      </Space>
      {result && (
        <Alert style={{ marginBottom: 12 }} type={result.failed.length ? 'warning' : 'success'} showIcon message={`${result.billedCount} tagihan diterbitkan, total ${fmtMoney(result.billedTotal)}`}
          description={result.failed.length ? <div>Gagal: {result.failed.map((f) => `${f.number} (${f.reason})`).join('; ')}</div> : undefined} />
      )}
      {p && (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={8}><Statistic title="Akan ditagih" value={p.totals.count} /></Col>
          <Col xs={8}><Statistic title="Nilai tagihan" value={fmtMoney(p.totals.subtotal)} /></Col>
          <Col xs={8}><Statistic title="Denda ikut ditagih" value={fmtMoney(p.totals.lateFee)} /></Col>
        </Row>
      )}
      <ResponsiveTable<Preview['ready'][number]> rowKey="connectionId" size="small" loading={preview.isLoading} dataSource={p?.ready} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} locale={{ emptyText: 'Tidak ada yang siap ditagih untuk periode ini' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, r) => `${r.number} · ${r.customerName}` },
          { title: 'Tarif', dataIndex: 'tariffName' },
          { title: 'Pemakaian', render: (_: unknown, r) => (r.usage == null ? 'tarif tetap' : `${r.usage} ${r.unit}`) },
          { title: 'Tagihan', align: 'right' as const, dataIndex: 'subtotal', render: (v: number) => fmtMoney(v) },
          { title: 'Denda', align: 'right' as const, render: (_: unknown, r) => (r.lateFee ? <span>{fmtMoney(r.lateFee)} <Tag color="orange">{r.lateFeeOf.join(', ')}</Tag></span> : '-') },
        ]}
      />
      {!!p?.held.length && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>Tertahan ({p.held.length})</Typography.Title>
          <Table size="small" rowKey="connectionId" pagination={{ pageSize: 10 }} dataSource={p.held}
            columns={[{ title: 'Sambungan', render: (_: unknown, r: Preview['held'][number]) => `${r.number} · ${r.customerName}` }, { title: 'Alasan', dataIndex: 'reason' }]} />
        </>
      )}
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

// ---------- Tarif & aturan ----------
type TariffForm = { name: string; serviceType: UtilityServiceType; unit?: string; fixedFee: number; adminFee: number; minUsage?: number; blocks: { upTo: number | null; price: number }[]; vatable?: boolean; isActive?: boolean };
function TariffsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const rules = useQuery({ queryKey: ['utility', 'rules'], queryFn: () => get<UtilityRules>('/utility/rules') });
  const [editing, setEditing] = useState<Tariff | 'new' | null>(null);
  const [form] = Form.useForm<TariffForm>();
  const [rf] = Form.useForm<UtilityRules>();
  const type = Form.useWatch('serviceType', form) as UtilityServiceType | undefined;
  const metered = type ? UTILITY_SERVICE_DEFAULTS[type].metered : true;
  const save = useAction((v: TariffForm) => (editing === 'new' ? post('/utility/tariffs', v) : put(`/utility/tariffs/${(editing as Tariff).id}`, v)), { success: 'Tarif tersimpan', invalidate: ['utility'], onSuccess: () => setEditing(null) });
  const saveRules = useAction((v: UtilityRules) => put('/utility/rules', v), { success: 'Aturan tersimpan', invalidate: ['utility'] });
  const canEdit = can('PUT', '/utility/tariffs/:id');
  const open = (t: Tariff | 'new') => {
    form.resetFields();
    if (t === 'new') form.setFieldsValue({ serviceType: 'AIR', fixedFee: 0, adminFee: 0, minUsage: 0, blocks: [{ upTo: 10, price: 0 }, { upTo: null, price: 0 }] });
    else form.setFieldsValue({ name: t.name, serviceType: t.serviceType, unit: t.unit, fixedFee: Number(t.fixedFee), adminFee: Number(t.adminFee), minUsage: Number(t.minUsage), blocks: t.blocks, vatable: t.vatable, isActive: t.isActive });
    setEditing(t);
  };
  return (
    <>
      <Space style={{ marginBottom: 12 }}>{can('POST', '/utility/tariffs') && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Tarif baru</Button>}</Space>
      <ResponsiveTable<Tariff> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} scroll={{ x: 800 }} locale={{ emptyText: 'Belum ada tarif — buat tarif pertama' }}
        columns={[
          { title: 'Tarif', render: (_: unknown, t: Tariff) => <span>{t.name} {!t.isActive && <Tag>nonaktif</Tag>}</span> },
          { title: 'Layanan', render: (_: unknown, t: Tariff) => UTILITY_SERVICE_LABELS[t.serviceType] },
          { title: 'Abonemen / tetap', align: 'right' as const, render: (_: unknown, t: Tariff) => fmtMoney(t.fixedFee) },
          { title: 'Admin', align: 'right' as const, render: (_: unknown, t: Tariff) => fmtMoney(t.adminFee) },
          { title: 'Blok pemakaian', render: (_: unknown, t: Tariff) => (t.metered ? t.blocks.map((b, i) => <div key={i}>{i === 0 ? 0 : t.blocks[i - 1].upTo}–{b.upTo ?? '∞'} {t.unit}: {fmtMoney(b.price)}</div>) : 'tarif tetap') },
          { title: 'Sambungan', dataIndex: 'connections', align: 'right' as const },
          { render: (_: unknown, t: Tariff) => (canEdit ? <Button size="small" onClick={() => open(t)}>Ubah</Button> : null) },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>Aturan denda, pemutusan, dan tanda janggal</Typography.Title>
      <Form form={rf} layout="vertical" key={JSON.stringify(rules.data)} initialValues={rules.data ?? DEFAULT_UTILITY_RULES} onFinish={(v) => saveRules.mutate(v)} disabled={!can('PUT', '/utility/rules')}>
        <Row gutter={12}>
          <Col xs={12} md={6}><Form.Item name="dueDays" label="Jatuh tempo (hari setelah terbit)"><InputNumber min={5} max={60} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="graceDays" label="Toleransi sebelum denda (hari)"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="lateFeePct" label="Denda (% dari sisa tagihan)"><InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="lateFeeCapPct" label="Batas denda (% nilai tagihan)"><InputNumber min={0} max={25} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="suspendAfterDays" label="Usulan putus setelah (hari)"><InputNumber min={14} max={180} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="spikeFactor" label="Tandai lonjakan (× rata-rata)"><InputNumber min={1.5} max={10} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="spikeMinUsage" label="Abaikan lonjakan di bawah"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        {can('PUT', '/utility/rules') && <Button type="primary" htmlType="submit" loading={saveRules.isPending}>Simpan aturan</Button>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>Besaran denda dan batas pemutusan harus sesuai ketentuan penyedia/regulator Anda dan perjanjian dengan pelanggan.</Typography.Paragraph>
      </Form>
      <Modal title={editing === 'new' ? 'Tarif baru' : 'Ubah tarif'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" width={640} destroyOnHidden>
        {editing !== 'new' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perubahan tarif berlaku untuk tagihan berikutnya dan tercatat di jejak audit (sebelum/sesudah)." />}
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate({ ...v, blocks: metered ? v.blocks : [] })}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="name" label="Nama tarif" rules={[{ required: true, min: 2 }]}><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="serviceType" label="Jenis layanan" rules={[{ required: true }]}><Select disabled={editing !== 'new'} options={UTILITY_SERVICE_TYPES.map((v) => ({ value: v, label: UTILITY_SERVICE_LABELS[v] }))} onChange={(v: UtilityServiceType) => form.setFieldValue('unit', UTILITY_SERVICE_DEFAULTS[v].unit)} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="fixedFee" label={metered ? 'Abonemen / biaya tetap' : 'Biaya per periode'} rules={[{ required: true }]}><InputNumber min={0} prefix="Rp" style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="adminFee" label="Biaya administrasi"><InputNumber min={0} prefix="Rp" style={{ width: '100%' }} /></Form.Item></Col>
            {metered && <Col xs={12} md={8}><Form.Item name="minUsage" label="Pemakaian minimum ditagih"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
          </Row>
          {metered && (
            <Form.List name="blocks">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Text strong>Blok tarif (progresif)</Typography.Text>
                  {fields.map((f, i) => (
                    <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}>
                      <span>Sampai</span>
                      <Form.Item name={[f.name, 'upTo']} noStyle><InputNumber min={1} placeholder="tanpa batas" style={{ width: 130 }} /></Form.Item>
                      <span>dengan harga</span>
                      <Form.Item name={[f.name, 'price']} noStyle rules={[{ required: true }]}><InputNumber min={0} prefix="Rp" style={{ width: 150 }} /></Form.Item>
                      {fields.length > 1 && i === fields.length - 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                    </Space>
                  ))}
                  <Button type="dashed" size="small" style={{ marginTop: 8 }} onClick={() => { const last = form.getFieldValue('blocks') as { upTo: number | null; price: number }[]; const prev = last[last.length - 1]; if (prev && prev.upTo == null) last[last.length - 1] = { ...prev, upTo: (last[last.length - 2]?.upTo ?? 0) + 10 }; add({ upTo: null, price: 0 }); }}>Tambah blok</Button>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>Blok terakhir dikosongkan "Sampai"-nya (tanpa batas).</Typography.Paragraph>
                </>
              )}
            </Form.List>
          )}
          <Form.Item name="vatable" label="Dikenai PPN" valuePropName="checked" extra="Hanya bila layanan ini memang kena PPN — pastikan dengan konsultan pajak."><Switch /></Form.Item>
          {editing !== 'new' && <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>}
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
            columns={Object.keys(c.items[0]).map((k) => ({ title: COL[k] ?? k, dataIndex: k, render: (v: unknown) => (Array.isArray(v) ? v.map((f) => READING_FLAG_LABELS[f as ReadingFlag] ?? String(f)).join(', ') : k === 'service' ? UTILITY_SERVICE_LABELS[v as UtilityServiceType] ?? String(v) : String(v ?? '-')) }))} />
        </Card>
      ))}
    </>
  );
}
