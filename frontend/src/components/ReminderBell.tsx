import { BellOutlined, CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import type { ReminderItem, RemindersResponse } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dropdown, Empty, Popover, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useTasks } from '@/layout/useTasks';

const ICON = {
  error: <CloseCircleFilled style={{ color: '#D92D20' }} />,
  warning: <ExclamationCircleFilled style={{ color: '#D48A06' }} />,
  info: <InfoCircleFilled style={{ color: '#3B6FD4' }} />,
};
/** Pengingat yang sudah tercakup antrean tugas pengguna (tidak ditampilkan dobel di lonceng) */
const COVERED_BY_TASK: Record<string, string> = { approvals: 'approvals', 'pr-pending': 'purchase-requests', 'pr-approved': 'handoff-pr', 'delivery-not-invoiced': 'handoff-invoice', 'po-not-received': 'handoff-receive', 'grni-old': 'handoff-bill' };
const SNOOZE = [
  { key: '1', label: 'Besok' },
  { key: '3', label: '3 hari' },
  { key: '7', label: '1 minggu' },
  { key: '30', label: '1 bulan' },
];
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Lonceng pengingat di header: jumlah hal yang perlu ditindaklanjuti; daftar bisa dibuka, ditunda, atau dipulihkan */
export default function ReminderBell() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const q = useQuery({
    queryKey: ['reminders', showSnoozed],
    queryFn: () => get<RemindersResponse>(`/reminders${showSnoozed ? '?all=true' : ''}`),
    enabled: !!me,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['reminders'] });
  const snooze = async (key: string, days: number) => {
    await post('/reminders/snooze', { key, days });
    refresh();
  };
  const restore = async (key: string) => {
    await post('/reminders/unsnooze', { key });
    refresh();
  };
  const tasks = useTasks().data ?? [];
  const taskTotal = tasks.reduce((a, t) => a + t.count, 0);
  // persetujuan sudah tampil sebagai tugas (disaring per pengguna); hindari ganda
  const taskKeys = new Set(tasks.map((t) => t.key));
  const data = q.data ? { ...q.data, items: q.data.items.filter((i) => !(COVERED_BY_TASK[i.key] && taskKeys.has(COVERED_BY_TASK[i.key]))) } : q.data;
  const urgent = (data?.items.filter((i) => i.level !== 'info').length ?? 0) + taskTotal;

  const row = (i: ReminderItem, snoozed = false) => (
    <div key={i.key} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #F0EEE8', opacity: snoozed ? 0.65 : 1 }}>
      <div style={{ paddingTop: 3 }}>{ICON[i.level]}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          onClick={() => {
            setOpen(false);
            navigate(i.link);
          }}
          style={{ fontWeight: 600, color: '#101C33' }}
        >
          {i.title}
        </a>
        <div style={{ fontSize: 12.5, color: '#5B6477', marginTop: 2 }}>{i.detail}</div>
        <div style={{ marginTop: 4 }}>
          {snoozed ? (
            <Space size={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Ditunda sampai {fmtDay(i.snoozedUntil!)}
              </Typography.Text>
              <a style={{ fontSize: 12 }} onClick={() => restore(i.key)}>
                Tampilkan lagi
              </a>
            </Space>
          ) : (
            <Dropdown menu={{ items: SNOOZE, onClick: (e) => snooze(i.key, Number(e.key)) }} trigger={['click']}>
              <a style={{ fontSize: 12, color: '#6B7388' }}>Tunda…</a>
            </Dropdown>
          )}
        </div>
      </div>
    </div>
  );

  const content = (
    <div style={{ width: 380, maxWidth: '86vw' }}>
      {tasks.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7388', marginBottom: 4 }}>Menunggu tindakan Anda</div>
          {tasks.map((t) => (
            <div key={t.key} style={{ padding: '6px 0', borderBottom: '1px solid #F0EEE8' }}>
              <a onClick={() => { setOpen(false); navigate(t.link); }} style={{ fontWeight: 600, color: '#101C33' }}>{t.title}</a>
              <div style={{ fontSize: 12.5, color: '#5B6477' }}>{t.detail}</div>
            </div>
          ))}
        </div>
      )}
      {q.isPending ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : data && data.items.length ? (
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>{data.items.map((i) => row(i))}</div>
      ) : tasks.length ? null : (
        <Empty
          image={<CheckCircleFilled style={{ fontSize: 40, color: '#16A37B' }} />}
          description={<span>Semua beres. Tidak ada yang perlu ditindaklanjuti.</span>}
          styles={{ image: { height: 48 } }}
          style={{ padding: '16px 0' }}
        />
      )}
      {showSnoozed && data?.snoozed?.length ? <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: '#6B7388' }}>Ditunda</div> : null}
      {showSnoozed && data?.snoozed?.map((i) => row(i, true))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        {data?.snoozedCount ? (
          <a style={{ fontSize: 12.5 }} onClick={() => setShowSnoozed((v) => !v)}>
            {showSnoozed ? 'Sembunyikan yang ditunda' : `Lihat ${data.snoozedCount} yang ditunda`}
          </a>
        ) : (
          <span />
        )}
        {['OWNER', 'ADMIN'].includes(me?.role ?? '') && (
          <a
            style={{ fontSize: 12.5 }}
            onClick={() => {
              setOpen(false);
              navigate('/settings/company?tab=pengingat');
            }}
          >
            Atur pengingat
          </a>
        )}
      </div>
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Pengingat" content={content} open={open} onOpenChange={setOpen} arrow={false}>
      <Badge count={urgent} size="small" overflowCount={99} offset={[-2, 4]}>
        <Button shape="circle" icon={<BellOutlined />} aria-label={`Pengingat${urgent ? `, ${urgent} perlu perhatian` : ''}`} />
      </Badge>
    </Popover>
  );
}
