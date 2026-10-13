/** Cabang: laba rugi per cabang (+ gabungan), temuan kontrol, dan pengaturan cabang & gudang/toko */
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, patch, post, put } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

interface Fin {
  revenue: string;
  costOfSales: string;
  grossProfit: string;
  operatingExpense: string;
  other: string;
  netProfit: string;
  margin: string | null;
}
interface Report {
  from: string;
  to: string;
  columns: { key: string; code: string; name: string }[];
  summary: Record<string, Fin>;
  consolidated: Fin;
  rows: { accountId: string; code: string; name: string; type: 'REVENUE' | 'EXPENSE'; values: Record<string, string>; total: string }[];
}
interface Finding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

function ReportTab() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const q = useQuery({ queryKey: ['branches', 'report', from, to], queryFn: () => get<Report>(`/branches/report?from=${from}&to=${to}`) });
  const controls = useQuery({ queryKey: ['branches', 'controls'], queryFn: () => get<{ items: Finding[] }>('/branches/controls') });
  const r = q.data;
  const cols = r?.columns ?? [];
  return (
    <>
      {!!controls.data?.items.length && (
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          {controls.data.items.map((c) => (
            <Alert key={c.key} type={c.level} showIcon message={c.title} description={<div><div>{c.detail}</div><div style={{ marginTop: 4 }}><strong>Contoh:</strong> {c.refs.slice(0, 5).join(' · ')}</div></div>} />
          ))}
        </Space>
      )}
      <Space style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])} />
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small" loading={q.isLoading}>
            <Statistic title="Pendapatan gabungan" value={Number(r?.consolidated.revenue ?? 0)} formatter={(v) => fmtMoney(Number(v))} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" loading={q.isLoading}>
            <Statistic title="Laba kotor gabungan" value={Number(r?.consolidated.grossProfit ?? 0)} formatter={(v) => fmtMoney(Number(v))} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" loading={q.isLoading}>
            <Statistic title="Laba bersih gabungan" value={Number(r?.consolidated.netProfit ?? 0)} formatter={(v) => fmtMoney(Number(v))} valueStyle={{ color: Number(r?.consolidated.netProfit ?? 0) < 0 ? '#cf1322' : undefined }} />
          </Card>
        </Col>
      </Row>
      <Table
        size="small"
        rowKey="label"
        pagination={false}
        loading={q.isLoading}
        scroll={{ x: 600 + cols.length * 150 }}
        dataSource={
          r
            ? ([
                ['Pendapatan', 'revenue'],
                ['Beban pokok penjualan', 'costOfSales'],
                ['Laba kotor', 'grossProfit'],
                ['Beban usaha', 'operatingExpense'],
                ['Pendapatan (beban) lain', 'other'],
                ['Laba bersih', 'netProfit'],
                ['Margin bersih (%)', 'margin'],
              ] as [string, keyof Fin][]).map(([label, k]) => ({ label, k }))
            : []
        }
        columns={[
          { title: 'Laba rugi', dataIndex: 'label', fixed: 'left', width: 200, render: (v: string) => (['Laba kotor', 'Laba bersih'].includes(v) ? <strong>{v}</strong> : v) },
          ...cols.map((c) => ({
            title: <span title={c.name}>{c.code === '-' ? 'Pusat' : c.code}</span>,
            align: 'right' as const,
            render: (_: unknown, row: { k: keyof Fin }) => (row.k === 'margin' ? (r!.summary[c.key]?.margin ?? '-') : fmtMoney(r!.summary[c.key]?.[row.k] ?? 0)),
          })),
          { title: 'Gabungan', align: 'right', render: (_: unknown, row: { k: keyof Fin }) => <strong>{row.k === 'margin' ? (r!.consolidated.margin ?? '-') : fmtMoney(r!.consolidated[row.k] ?? 0)}</strong> },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Rincian per akun
      </Typography.Title>
      <Table
        size="small"
        rowKey="accountId"
        pagination={false}
        loading={q.isLoading}
        dataSource={r?.rows}
        scroll={{ x: 600 + cols.length * 150 }}
        columns={[
          { title: 'Akun', fixed: 'left', width: 260, render: (_, a: Report['rows'][number]) => <span>{a.code} {a.name} <Tag>{a.type === 'REVENUE' ? 'Pendapatan' : 'Beban'}</Tag></span> },
          ...cols.map((c) => ({ title: c.code === '-' ? 'Pusat' : c.code, align: 'right' as const, render: (_: unknown, a: Report['rows'][number]) => fmtMoney(a.values[c.key] ?? 0) })),
          { title: 'Gabungan', align: 'right', render: (_: unknown, a: Report['rows'][number]) => <strong>{fmtMoney(a.total)}</strong> },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Cabang diturunkan otomatis dari toko/gudang (penjualan, kasir, pembelian, stok) dan dari pilihan cabang pada kas & jurnal. Kolom Gabungan sama dengan laporan laba rugi perusahaan. Transaksi sebelum cabang diaktifkan tetap di "Pusat" (jurnal lama tidak diubah).
      </Typography.Paragraph>
    </>
  );
}

function SettingsTab() {
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const q = useBranches();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ code: string; name: string; address?: string }>();
  const create = useAction((v: { code: string; name: string; address?: string }) => post('/branches', v), { success: 'Cabang dibuat', invalidate: ['branches'], onSuccess: () => setOpen(false) });
  const toggle = useAction((v: { id: string; isActive: boolean }) => patch(`/branches/${v.id}`, { isActive: v.isActive }), { success: 'Tersimpan', invalidate: ['branches'] });
  const assign = useAction((v: { warehouseId: string; branchId: string | null }) => put(`/branches/warehouses/${v.warehouseId}`, { branchId: v.branchId }), { success: 'Gudang/toko dipasangkan', invalidate: ['branches'] });
  const all = [...(q.data?.branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branchId: b.id }))) ?? []), ...(q.data?.unassignedWarehouses.map((w) => ({ ...w, isActive: true, branchId: null as string | null })) ?? [])];
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Satu perusahaan, satu pembukuan. Pasangkan setiap toko/gudang ke cabangnya; semua transaksi di toko itu otomatis berlabel cabang. Perubahan pasangan hanya berlaku untuk transaksi berikutnya." />
      {admin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { form.resetFields(); setOpen(true); }}>
          Cabang baru
        </Button>
      )}
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        loading={q.isLoading}
        dataSource={q.data?.branches}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Cabang', dataIndex: 'name' },
          { title: 'Toko / gudang', render: (_, b: NonNullable<typeof q.data>['branches'][number]) => (b.warehouses.length ? b.warehouses.map((w) => <Tag key={w.id}>{w.name}</Tag>) : '-') },
          { title: 'Status', dataIndex: 'isActive', render: (a: boolean) => (a ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          ...(admin ? [{ title: '', render: (_: unknown, b: { id: string; isActive: boolean }) => <Button size="small" type="link" onClick={() => toggle.mutate({ id: b.id, isActive: !b.isActive })}>{b.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button> }] : []),
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Toko / gudang milik cabang
      </Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={all}
        columns={[
          { title: 'Toko / gudang', render: (_, w: (typeof all)[number]) => `${w.code} · ${w.name}` },
          {
            title: 'Cabang',
            render: (_, w: (typeof all)[number]) => (
              <Select
                allowClear
                disabled={!admin}
                placeholder="Belum ada cabang"
                style={{ width: 240 }}
                value={w.branchId ?? undefined}
                options={(q.data?.branches ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
                onChange={(v) => assign.mutate({ warehouseId: w.id, branchId: v ?? null })}
              />
            ),
          },
        ]}
      />
      <Modal title="Cabang baru" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input maxLength={20} placeholder="CB-BKS" /></Form.Item>
          <Form.Item name="name" label="Nama cabang" rules={[{ required: true, min: 2 }]}><Input maxLength={120} placeholder="Cabang Bekasi" /></Form.Item>
          <Form.Item name="address" label="Alamat"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function BranchesPage() {
  const { me } = useAuth();
  const reportOk = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'FINANCE';
  return (
    <>
      <PageHeader title="Cabang" />
      <Card>
        <Tabs
          items={[
            ...(reportOk ? [{ key: 'report', label: 'Laba rugi per cabang', children: <ReportTab /> }] : []),
            { key: 'settings', label: 'Cabang & toko', children: <SettingsTab /> },
          ]}
        />
      </Card>
    </>
  );
}
