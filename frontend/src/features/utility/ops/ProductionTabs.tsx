import { WATER_QUALITY_LIMITS, evaluateWaterQuality } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AutoComplete, Button, DatePicker, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtQty } from '@/lib/format';
import { Stats } from './kit';

interface Prod { id: string; date: string; source: string; produced: string; distributed: string; own_use: string; energy_kwh: string | null; note: string | null }
interface Summary { period: string; produced: number; distributed: number; ownUse: number; billed: number; nrwVolume: number; nrwPct: number | null; days: number; expectedDays: number; kwhPerM3: number | null; warnPct: number; warn: boolean; perSource: { source: string; produced: string; distributed: string; days: number }[]; trend: { period: string; distributed: number; billed: number; nrwPct: number | null }[] }

/** Produksi air harian per sumber dan neraca air: produksi → dialirkan → ditagih; selisihnya air tak berekening (NRW) */
export function ProductionTab() {
  const can = useCan();
  const [period, setPeriod] = useState(dayjs());
  const [adding, setAdding] = useState(false);
  const p = period.format('YYYY-MM');
  const sum = useQuery({ queryKey: ['utility', 'production', 'summary', p], queryFn: () => get<Summary>(`/utility/production/summary?period=${p}`) });
  const list = useQuery({ queryKey: ['utility', 'production', 'list', p], queryFn: () => get<Prod[]>(`/utility/production?from=${p}-01&to=${period.endOf('month').format('YYYY-MM-DD')}`) });
  const s = sum.data;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Neraca air" description="Catat setiap hari berapa air yang diproduksi dan dialirkan ke jaringan. Dibandingkan dengan air yang ditagih bulan itu, selisihnya adalah air tak berekening (kebocoran, sambungan liar, meter kurang baca). Batas wajar 30%; di atas itu perlu ditelusuri per zona." />
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker picker="month" allowClear={false} value={period} onChange={(d) => d && setPeriod(d)} />
        {can('POST', '/utility/production') && <Button type="primary" onClick={() => setAdding(true)}>Catat produksi harian</Button>}
      </Space>
      <Stats items={[
        { title: 'Diproduksi (m³)', value: fmtQty(s?.produced ?? 0), hint: s ? `${s.days} dari ${s.expectedDays} hari terisi` : undefined },
        { title: 'Dialirkan (m³)', value: fmtQty(s?.distributed ?? 0) },
        { title: 'Ditagih (m³)', value: fmtQty(s?.billed ?? 0) },
        { title: 'Air tak berekening', value: s?.nrwPct == null ? '-' : `${s.nrwPct}%`, warn: !!s?.warn, ok: s?.nrwPct != null && !s.warn, hint: s?.nrwPct != null ? `${fmtQty(s.nrwVolume)} m³ hilang (batas ${s.warnPct}%)` : 'Isi produksi dan tagihan bulan ini' },
        ...(s?.kwhPerM3 ? [{ title: 'Energi (kWh/m³)', value: s.kwhPerM3 }] : []),
      ]} />
      <Typography.Title level={5}>Enam bulan terakhir</Typography.Title>
      <Table size="small" rowKey="period" pagination={false} dataSource={s?.trend} style={{ marginBottom: 16 }} columns={[
        { title: 'Bulan', dataIndex: 'period' }, { title: 'Dialirkan (m³)', align: 'right' as const, render: (_: unknown, t: Summary['trend'][number]) => fmtQty(t.distributed) },
        { title: 'Ditagih (m³)', align: 'right' as const, render: (_: unknown, t: Summary['trend'][number]) => fmtQty(t.billed) },
        { title: 'NRW', align: 'right' as const, render: (_: unknown, t: Summary['trend'][number]) => (t.nrwPct == null ? '-' : <Tag color={t.nrwPct > (s?.warnPct ?? 30) ? 'red' : 'green'}>{t.nrwPct}%</Tag>) },
      ]} />
      <Typography.Title level={5}>Catatan harian</Typography.Title>
      <ResponsiveTable<Prod> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} columns={[
        { title: 'Tanggal', render: (_: unknown, r: Prod) => fmtDate(r.date) }, { title: 'Sumber', dataIndex: 'source' },
        { title: 'Diproduksi', align: 'right' as const, render: (_: unknown, r: Prod) => fmtQty(r.produced) }, { title: 'Dialirkan', align: 'right' as const, render: (_: unknown, r: Prod) => fmtQty(r.distributed) },
        { title: 'Pakai sendiri', align: 'right' as const, render: (_: unknown, r: Prod) => fmtQty(r.own_use) }, { title: 'Listrik (kWh)', align: 'right' as const, render: (_: unknown, r: Prod) => (r.energy_kwh ? fmtQty(r.energy_kwh) : '-') },
      ]} />
      <AddProduction open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddProduction({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const sources = useQuery({ queryKey: ['utility', 'production', 'sources'], queryFn: () => get<string[]>('/utility/production/sources'), enabled: open });
  const save = useAction((v: Record<string, unknown>) => post<{ updated: boolean }>('/utility/production', { ...v, date: dayjs(v.date as string).format('YYYY-MM-DD') }), { success: (r) => (r.updated ? 'Catatan hari itu diperbarui' : 'Produksi dicatat'), invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Catat produksi harian" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ date: dayjs(), ownUse: 0 }}>
        <Space align="start"><Form.Item name="date" label="Tanggal" rules={[{ required: true }]}><DatePicker disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
          <Form.Item name="source" label="Sumber / instalasi" rules={[{ required: true, min: 2 }]}><AutoComplete style={{ width: 240 }} options={(sources.data ?? []).map((v) => ({ value: v }))} placeholder="Mis. IPA Sungai Tirta" /></Form.Item></Space>
        <Space align="start">
          <Form.Item name="produced" label="Diproduksi (m³)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 150 }} /></Form.Item>
          <Form.Item name="distributed" label="Dialirkan ke jaringan (m³)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 170 }} /></Form.Item>
          <Form.Item name="ownUse" label="Pakai sendiri (m³)"><InputNumber min={0} style={{ width: 130 }} /></Form.Item>
        </Space>
        <Form.Item name="energyKwh" label="Listrik terpakai (kWh)"><InputNumber min={0} style={{ width: 150 }} /></Form.Item>
        <Form.Item name="note" label="Catatan"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

// ------------------------------------------------------------------ kualitas air
interface Q { id: string; sampled_on: string; point: string; ph: string | null; turbidity: string | null; chlorine: string | null; coliform: string | null; tds: string | null; ok: boolean; failed: string[]; sampler: string | null; note: string | null }
interface QSum { samples: number; failing: number; okPct: number | null; points: { point: string; samples: number; failing: number; last_on: string }[]; knownPoints: string[] }
const PARAMS = ['ph', 'turbidity', 'chlorine', 'coliform', 'tds'] as const;
const LIMIT_TEXT: Record<(typeof PARAMS)[number], string> = { ph: '6,5–8,5', turbidity: '≤ 5', chlorine: '0,2–1,0', coliform: '0', tds: '≤ 500' };

/** Kualitas air: hasil uji sampel dibandingkan baku mutu; yang melanggar ditandai merah */
export function QualityTab() {
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['utility', 'quality', 'list'], queryFn: () => get<Q[]>('/utility/water-quality') });
  const sum = useQuery({ queryKey: ['utility', 'quality', 'summary'], queryFn: () => get<QSum>('/utility/water-quality/summary') });
  const s = sum.data;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Baku mutu air minum" description={`Batas yang dipakai: ${PARAMS.map((k) => `${WATER_QUALITY_LIMITS[k].label} ${LIMIT_TEXT[k]}`).join(' · ')}. Hasil uji yang melewati batas ditandai dan dihitung sebagai tidak memenuhi.`} />
      <Stats items={[
        { title: 'Sampel 30 hari', value: s?.samples ?? 0 },
        { title: 'Memenuhi baku mutu', value: s?.okPct == null ? '-' : `${s.okPct}%`, ok: s?.okPct === 100, warn: s?.okPct != null && s.okPct < 100 },
        { title: 'Tidak memenuhi', value: s?.failing ?? 0, warn: (s?.failing ?? 0) > 0 },
      ]} />
      {can('POST', '/utility/water-quality') && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>Catat hasil uji</Button>}
      <ResponsiveTable<Q> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }}
        columns={[
          { title: 'Tanggal', render: (_: unknown, r: Q) => fmtDate(r.sampled_on) }, { title: 'Titik sampel', dataIndex: 'point' },
          ...PARAMS.map((k) => ({ title: WATER_QUALITY_LIMITS[k].label, align: 'right' as const, render: (_: unknown, r: Q) => (r[k] == null ? '-' : <span style={r.failed.includes(k) ? { color: '#dc2626', fontWeight: 600 } : undefined}>{Number(r[k])}</span>) })),
          { title: 'Hasil', render: (_: unknown, r: Q) => (r.ok ? <Tag color="green">Memenuhi</Tag> : <Tag color="red">Tidak memenuhi</Tag>) },
          { title: 'Petugas', dataIndex: 'sampler' },
        ]} />
      <AddQuality open={adding} onClose={() => setAdding(false)} points={s?.knownPoints ?? []} />
    </>
  );
}

function AddQuality({ open, onClose, points }: { open: boolean; onClose: () => void; points: string[] }) {
  const [f] = Form.useForm();
  const vals = Form.useWatch([], f) as Record<string, number | undefined> | undefined;
  const ev = vals ? evaluateWaterQuality({ ph: vals.ph ?? null, turbidity: vals.turbidity ?? null, chlorine: vals.chlorine ?? null, coliform: vals.coliform ?? null, tds: vals.tds ?? null }) : null;
  const any = !!vals && PARAMS.some((k) => vals[k] != null);
  const save = useAction((v: Record<string, unknown>) => post<{ ok: boolean }>('/utility/water-quality', { ...v, sampledOn: dayjs(v.sampledOn as string).format('YYYY-MM-DD') }), { success: (r) => (r.ok ? 'Hasil uji dicatat — memenuhi baku mutu' : 'Hasil uji dicatat — ADA yang melewati baku mutu'), invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Catat hasil uji kualitas air" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ sampledOn: dayjs() }}>
        <Space align="start"><Form.Item name="sampledOn" label="Tanggal sampel" rules={[{ required: true }]}><DatePicker disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
          <Form.Item name="point" label="Titik sampel" rules={[{ required: true, min: 2 }]}><AutoComplete style={{ width: 240 }} options={points.map((v) => ({ value: v }))} placeholder="Reservoir, ujung jaringan…" /></Form.Item></Space>
        <Space wrap align="start">
          {PARAMS.map((k) => <Form.Item key={k} name={k} label={`${WATER_QUALITY_LIMITS[k].label} (${LIMIT_TEXT[k]})`}><InputNumber min={0} step={k === 'ph' ? 0.1 : 0.01} style={{ width: 150 }} status={ev?.failed.includes(k) ? 'error' : undefined} /></Form.Item>)}
        </Space>
        {any && ev && <Alert style={{ marginBottom: 12 }} type={ev.ok ? 'success' : 'error'} showIcon message={ev.ok ? 'Memenuhi baku mutu' : `Tidak memenuhi: ${ev.failed.map((k) => WATER_QUALITY_LIMITS[k as (typeof PARAMS)[number]].label).join(', ')}`} />}
        <Form.Item name="note" label="Catatan"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}
