import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Input, InputNumber, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import type { AttendanceDay, AttendanceMonth } from '@/api/types';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { today } from '@/lib/format';

interface Row {
  employeeId: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  overtimeHours?: number;
  notes?: string;
}

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  HADIR: 'green',
  IZIN: 'orange',
  SAKIT: 'gold',
  CUTI: 'blue',
  ALPA: 'red',
  LIBUR: 'default',
};

function DailyTab() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['attendance', date],
    queryFn: () => get<AttendanceDay>(`/hr/attendance${qs({ date })}`),
  });

  useEffect(() => {
    if (!data) return;
    setRows(
      Object.fromEntries(
        data.rows.map((r) => [
          r.employee.id,
          r.record
            ? {
                employeeId: r.employee.id,
                status: r.record.status,
                checkIn: r.record.checkIn ?? undefined,
                checkOut: r.record.checkOut ?? undefined,
                overtimeHours: Number(r.record.overtimeHours),
                notes: r.record.notes ?? undefined,
              }
            : { employeeId: r.employee.id, status: 'HADIR' as const },
        ]),
      ),
    );
    setDirty(false);
  }, [data]);

  const set = (id: string, p: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
    setDirty(true);
  };
  const save = useAction(
    () =>
      post('/hr/attendance', {
        date,
        rows: Object.values(rows).map((r) => ({
          ...r,
          checkIn: r.checkIn || undefined,
          checkOut: r.checkOut || undefined,
          overtimeHours: r.status === 'HADIR' && r.overtimeHours ? String(r.overtimeHours) : undefined,
        })),
      }),
    { success: 'Absensi disimpan', invalidate: ['attendance', 'attendance-month'], onSuccess: () => setDirty(false) },
  );
  const recorded = data?.rows.filter((r) => r.record).length ?? 0;
  const list = Object.values(rows);
  const cnt = (f: (r: Row) => boolean) => list.filter(f).length;

  return (
    <>
      {list.length > 0 && (
        <SummaryCards
          items={[
            {
              label: 'Hadir',
              value: String(cnt((r) => r.status === 'HADIR')),
              hint: `dari ${list.length} karyawan`,
              tone: 'good',
            },
            {
              label: 'Tidak hadir',
              value: String(cnt((r) => r.status !== 'HADIR' && r.status !== 'LIBUR')),
              hint: 'izin, sakit, cuti, atau alpa',
              tone: cnt((r) => r.status === 'ALPA') ? 'bad' : 'neutral',
            },
            {
              label: 'Lembur',
              value: `${list.reduce((a, r) => a + (r.status === 'HADIR' ? Number(r.overtimeHours ?? 0) : 0), 0)} jam`,
              hint: 'total hari ini',
            },
          ]}
        />
      )}
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button onClick={() => setDate(dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'))}>‹</Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button onClick={() => setDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD'))}>›</Button>
          <Typography.Text strong>{dayjs(date).format('dddd, D MMMM YYYY')}</Typography.Text>
          {data && !data.isWorkDay && <Tag>Hari libur</Tag>}
          {data && <Tag color={recorded ? 'green' : 'default'}>{recorded ? 'Sudah dicatat' : 'Belum dicatat'}</Tag>}
        </Space>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Cukup catat pengecualian: hari kerja yang tidak dicatat otomatis dianggap hadir saat hitung gaji. Cuti yang disetujui terisi otomatis."
        />
        <Table
          rowKey={(r) => r.employee.id}
          loading={isLoading}
          dataSource={data?.rows}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Karyawan', render: (_, r) => `${r.employee.code} · ${r.employee.name}` },
            {
              title: 'Status',
              width: 180,
              render: (_, r) => (
                <Select
                  value={rows[r.employee.id]?.status}
                  onChange={(v) => set(r.employee.id, { status: v })}
                  style={{ width: '100%' }}
                  options={toOptions(ATTENDANCE_STATUS_LABELS).map((o) => ({
                    ...o,
                    label: <Tag color={STATUS_COLOR[o.value]}>{o.label}</Tag>,
                  }))}
                />
              ),
            },
            {
              title: 'Masuk',
              width: 120,
              render: (_, r) => (
                <Input
                  type="time"
                  value={rows[r.employee.id]?.checkIn}
                  onChange={(e) => set(r.employee.id, { checkIn: e.target.value })}
                />
              ),
            },
            {
              title: 'Pulang',
              width: 120,
              render: (_, r) => (
                <Input
                  type="time"
                  value={rows[r.employee.id]?.checkOut}
                  onChange={(e) => set(r.employee.id, { checkOut: e.target.value })}
                />
              ),
            },
            {
              title: 'Lembur (jam)',
              width: 120,
              render: (_, r) => (
                <InputNumber
                  min={0}
                  max={12}
                  step={0.5}
                  disabled={rows[r.employee.id]?.status !== 'HADIR'}
                  value={rows[r.employee.id]?.overtimeHours}
                  onChange={(v) => set(r.employee.id, { overtimeHours: v ?? 0 })}
                />
              ),
            },
            {
              title: 'Catatan',
              render: (_, r) => (
                <Input
                  value={rows[r.employee.id]?.notes}
                  onChange={(e) => set(r.employee.id, { notes: e.target.value })}
                />
              ),
            },
          ]}
        />
        <Space style={{ marginTop: 12 }}>
          <Button
            type="primary"
            disabled={!data?.rows.length}
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Simpan absensi
          </Button>
          {dirty && <Typography.Text type="warning">Ada perubahan belum disimpan</Typography.Text>}
        </Space>
      </Card>
    </>
  );
}

function MonthlyTab() {
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'));
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-month', period],
    queryFn: () => get<AttendanceMonth>(`/hr/attendance/month${qs({ period })}`),
  });
  const statuses = Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[];
  const absent = (data?.rows ?? []).reduce(
    (a, r) => a + statuses.filter((s) => s !== 'HADIR' && s !== 'LIBUR').reduce((b, s) => b + r.counts[s], 0),
    0,
  );
  return (
    <>
      {!!data?.rows.length && (
        <SummaryCards
          items={[
            { label: 'Hari kerja bulan ini', value: String(data.workDays) },
            {
              label: 'Total hari tidak hadir',
              value: String(absent),
              hint: 'izin, sakit, cuti, dan alpa',
              tone: absent ? 'warn' : 'neutral',
            },
            { label: 'Total lembur', value: `${data.rows.reduce((a, r) => a + Number(r.overtimeHours ?? 0), 0)} jam` },
          ]}
        />
      )}
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {data && <Typography.Text>{data.workDays} hari kerja</Typography.Text>}
        </Space>
        <Table
          rowKey={(r) => r.employee.id}
          loading={isLoading}
          dataSource={data?.rows}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Karyawan', render: (_, r) => `${r.employee.code} · ${r.employee.name}` },
            {
              title: 'Hadir (efektif)',
              align: 'right',
              render: (_, r) =>
                data ? data.workDays - statuses.filter((s) => s !== 'HADIR').reduce((a, s) => a + r.counts[s], 0) : 0,
            },
            ...statuses
              .filter((s) => s !== 'HADIR')
              .map((s) => ({
                title: ATTENDANCE_STATUS_LABELS[s],
                align: 'right' as const,
                render: (_: unknown, r: AttendanceMonth['rows'][number]) => r.counts[s] || '',
              })),
            { title: 'Lembur (jam)', dataIndex: 'overtimeHours', align: 'right' },
          ]}
        />
      </Card>
    </>
  );
}

export default function AttendancePage() {
  return (
    <>
      <PageHeader title="Absensi" />
      <Tabs
        items={[
          { key: 'day', label: 'Harian', children: <DailyTab /> },
          { key: 'month', label: 'Rekap bulanan', children: <MonthlyTab /> },
        ]}
      />
    </>
  );
}
