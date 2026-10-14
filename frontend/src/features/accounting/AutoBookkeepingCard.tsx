import { ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, InputNumber, Space, Switch, Typography } from 'antd';
import { get, post, put } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';

interface Settings {
  payroll: boolean;
  fx: boolean;
  lock: boolean;
  lockDay: number;
  closeYear: boolean;
}
interface RunResult {
  payrollPosted: string[];
  fxRevalued: string | null;
  locked: string | null;
  closedYear: number | null;
  skipped: string[];
}

const ROWS: { key: 'payroll' | 'fx' | 'lock' | 'closeYear'; title: string; hint: string }[] = [
  { key: 'payroll', title: 'Posting jurnal gaji', hint: 'Draf penggajian yang sudah lewat tanggal bayar dan lebih dari 24 jam diposting otomatis (jeda untuk koreksi SDM). Pembayaran tetap oleh Keuangan.' },
  { key: 'fx', title: 'Penilaian ulang valas akhir bulan', hint: 'Piutang/utang valas dinilai ulang pada akhir bulan lalu bila semua kurs sudah diisi, dengan jurnal balik otomatis.' },
  { key: 'lock', title: 'Kunci periode bulan lalu', hint: 'Bulan lalu dikunci pada tanggal yang dipilih (hanya menambah kunci, tidak pernah membuka). Ditunda bila ada gaji draf atau persetujuan yang menunggu.' },
  { key: 'closeYear', title: 'Tutup buku tahun lalu', hint: 'Tahun lalu ditutup setelah Februari, bila periodenya sudah terkunci sampai 31 Desember.' },
];

/** Pekerjaan Akuntan yang dikerjakan sistem. Penyusutan aset, jurnal berulang, dan aturan bank sudah otomatis dari menu masing-masing. */
export default function AutoBookkeepingCard() {
  const can = useCan();
  const editable = can('PUT', '/accounting/auto');
  const q = useQuery({ queryKey: ['auto-bookkeeping'], queryFn: () => get<Settings>('/accounting/auto') });
  const save = useAction((v: Partial<Settings>) => put<Settings>('/accounting/auto', v), { invalidate: ['auto-bookkeeping'], success: 'Pengaturan disimpan' });
  const run = useAction(() => post<RunResult>('/accounting/auto/run'), {
    invalidate: ['period', 'auto-bookkeeping', ...LEDGER_KEYS],
    success: (r) => {
      const done = [r.payrollPosted.length && `${r.payrollPosted.length} gaji diposting`, r.fxRevalued && `valas dinilai ulang ${r.fxRevalued}`, r.locked && `periode dikunci ${r.locked}`, r.closedYear && `tahun ${r.closedYear} ditutup`].filter(Boolean);
      return done.length ? done.join(', ') : 'Tidak ada yang perlu dikerjakan';
    },
  });
  const s = q.data;
  return (
    <Card
      loading={q.isLoading}
      title={
        <Space>
          <ThunderboltOutlined /> Pembukuan otomatis
        </Space>
      }
      extra={
        editable && s ? (
          <Space>
            <Button size="small" disabled={s.lock && s.closeYear && s.payroll && s.fx} loading={save.isPending} onClick={() => save.mutate({ payroll: true, fx: true, lock: true, closeYear: true })}>
              Nyalakan semua
            </Button>
            <Button size="small" type="primary" loading={run.isPending} onClick={() => run.mutate(undefined)}>
              Jalankan sekarang
            </Button>
          </Space>
        ) : null
      }
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary">
        Pekerjaan rutin Akuntan dikerjakan sistem berdasarkan aturan tetap, atas nama Pemilik, dan tercatat di jejak audit. Tanpa Akuntan pun pembukuan tetap rapi. Penyusutan aset,
        jurnal berulang, dan aturan bank sudah otomatis dari menu masing-masing.
      </Typography.Paragraph>
      {s && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {ROWS.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <Switch checked={s[r.key]} disabled={!editable} loading={save.isPending} onChange={(v) => save.mutate({ [r.key]: v })} />
              <div style={{ flex: 1 }}>
                <Typography.Text strong>{r.title}</Typography.Text>
                {r.key === 'lock' && s.lock && (
                  <span style={{ marginLeft: 8 }}>
                    tanggal <InputNumber size="small" min={1} max={28} value={s.lockDay} disabled={!editable} onChange={(v) => v && save.mutate({ lockDay: v })} style={{ width: 64 }} />
                  </span>
                )}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.hint}
                  </Typography.Text>
                </div>
              </div>
            </div>
          ))}
          {run.data?.skipped.length ? <Alert type="info" showIcon message="Ditunda" description={run.data.skipped.join('; ')} /> : null}
        </Space>
      )}
    </Card>
  );
}
