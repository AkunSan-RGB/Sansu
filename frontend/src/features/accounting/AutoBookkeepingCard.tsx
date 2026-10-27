import { useQuery } from '@tanstack/react-query';
import { Alert, Button, InputNumber, Space, Switch, Typography } from 'antd';
import { get, post, put } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtDate } from '@/lib/format';

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

type Key = 'payroll' | 'fx' | 'lock' | 'closeYear';
type Last = Partial<Record<Key, { at: string; data: Record<string, unknown> | null }>>;

const ROWS: { key: Key; title: string; hint: string; warn?: string }[] = [
  { key: 'payroll', title: 'Posting jurnal gaji', hint: 'Draf penggajian yang sudah lewat tanggal bayar dan lebih dari 24 jam diposting sendiri; pembayaran tetap oleh Keuangan.' },
  { key: 'fx', title: 'Penilaian ulang valas akhir bulan', hint: 'Piutang dan utang valas dinilai ulang pada akhir bulan lalu bila semua kurs sudah diisi, dengan jurnal balik otomatis.' },
  {
    key: 'lock',
    title: 'Kunci periode bulan lalu',
    hint: 'Pada tanggal yang dipilih, bulan lalu dikunci sendiri sehingga tidak ada yang bisa mengubah transaksinya (hanya Pemilik yang bisa membuka).',
    warn: 'Sistem hanya menunda bila ada gaji draf atau persetujuan yang menunggu; pekerjaan penyesuaian akhir bulan (penyusutan, akrual) tidak diperiksa. Nyalakan hanya bila bulan lalu biasanya sudah final pada tanggal itu.',
  },
  {
    key: 'closeYear',
    title: 'Tutup buku tahun lalu',
    hint: 'Setelah Februari, tahun lalu ditutup sendiri (jurnal penutup ke Laba Ditahan) bila periodenya sudah terkunci sampai 31 Desember.',
    warn: 'Jurnal penutup tidak bisa dibatalkan oleh pengguna biasa. Nyalakan hanya bila laporan tahun lalu sudah final.',
  },
];

const lastText = (key: Key, l?: Last[Key]): string => {
  if (!l) return 'Belum pernah dikerjakan otomatis';
  const d = l.data ?? {};
  const detail =
    key === 'payroll' ? (d.number ? ` · ${String(d.number)}` : '') : key === 'lock' ? (d.to ? ` · dikunci sampai ${fmtDate(String(d.to))}` : '') : key === 'fx' ? (d.date ? ` · untuk ${fmtDate(String(d.date))}` : '') : d.year ? ` · tahun ${String(d.year)}` : '';
  return `Terakhir dikerjakan ${fmtDate(l.at.slice(0, 10))}${detail}`;
};

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
  const last = useQuery({ queryKey: ['auto-bookkeeping', 'last'], queryFn: () => get<Last>('/accounting/auto/last') });
  const s = q.data;
  return (
    <div>
      <Typography.Paragraph type="secondary">
        Pilihan opsional: sistem mengerjakan pekerjaan rutin Akuntan sendiri, atas nama Pemilik, dan semuanya tercatat di jejak audit. Cocok bila perusahaan belum punya Akuntan.
        Semua ini tetap bisa dikerjakan manual di menu masing-masing.
      </Typography.Paragraph>
      {q.isLoading && <Typography.Text type="secondary">Memuat…</Typography.Text>}
      {s && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
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
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {r.hint}
                  </Typography.Text>
                </div>
                {r.warn && (
                  <Alert style={{ marginTop: 6 }} type={s[r.key] ? 'warning' : 'info'} showIcon message={r.warn} />
                )}
                <div style={{ marginTop: 4 }}>
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    {last.isLoading ? '' : lastText(r.key, last.data?.[r.key])}
                  </Typography.Text>
                </div>
              </div>
            </div>
          ))}
          {editable && (
            <div>
              <Button size="small" loading={run.isPending} onClick={() => run.mutate(undefined)}>
                Jalankan sekarang
              </Button>
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                Biasanya berjalan sendiri tiap jam; tombol ini hanya memeriksa dan mengerjakannya saat itu juga.
              </Typography.Text>
            </div>
          )}
          {run.data?.skipped.length ? <Alert type="info" showIcon message="Ditunda" description={run.data.skipped.join('; ')} /> : null}
        </Space>
      )}
    </div>
  );
}
