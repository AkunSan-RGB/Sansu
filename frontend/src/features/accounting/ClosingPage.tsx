import { CheckCircleFilled, ClockCircleFilled, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Input, InputNumber, List, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PeriodStatus } from '@/api/types';
import { canBookkeep } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import AutoBookkeepingCard from './AutoBookkeepingCard';
import { fmtDate, fmtMoney } from '@/lib/format';

type CheckItem = { key: string; title: string; status: 'DONE' | 'TODO' | 'INFO' | 'NA'; message: string; link?: string; waiting?: boolean };

const STEP = { fontWeight: 600, fontSize: 15, marginBottom: 6 } as const;

/**
 * Tutup buku bulanan dalam tiga langkah: pilih bulan, periksa pekerjaan akhir bulan, kunci.
 * Tutup buku akhir tahun dan pembukuan otomatis jarang dipakai, jadi dilipat di bawah.
 */
export default function ClosingPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const isOwner = me?.role === 'OWNER';
  const bookkeeper = canBookkeep(me?.role);
  const status = useQuery({ queryKey: ['period'], queryFn: () => get<PeriodStatus>('/accounting/period') });
  const lockedUntil = status.data?.lockedUntil ?? null;

  const [month, setMonth] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const [showAll, setShowAll] = useState(false);
  const [year, setYear] = useState<number>(dayjs().year() - 1);
  const [lockYear, setLockYear] = useState(true);

  const today = dayjs().format('YYYY-MM-DD');
  const until = month ? dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD') : '';
  const notEnded = !!until && until >= today;
  const unlocking = !!lockedUntil && !!until && until < lockedUntil;
  const alreadyLocked = !!lockedUntil && !!until && until === lockedUntil;

  const checklist = useQuery({
    queryKey: ['closing-checklist', month],
    queryFn: () => get<{ items: CheckItem[] }>(`/accounting/adjustments/checklist?period=${month}`),
    enabled: bookkeeper && !!month,
  });
  const items = checklist.data?.items ?? [];
  const open = items.filter((i) => i.status === 'TODO' && !i.waiting);
  const shown = showAll ? items : items.filter((i) => i.status === 'TODO');

  const lock = useAction((d: string) => post<PeriodStatus>('/accounting/period/lock', { until: d }), {
    success: (r) => (r.lockedUntil ? `Periode dikunci sampai ${fmtDate(r.lockedUntil)}` : 'Periode dibuka'),
    invalidate: ['period'],
  });
  const close = useAction(
    () => post<PeriodStatus & { journalNumber: string; netIncome: string }>('/accounting/period/close-year', { year, lock: lockYear }),
    {
      success: (r) => `Tahun ${year} ditutup · jurnal ${r.journalNumber} · laba bersih ${fmtMoney(r.netIncome)} dipindah ke Laba Ditahan`,
      invalidate: ['period', ...LEDGER_KEYS],
    },
  );

  return (
    <>
      <PageHeader title="Tutup Buku" />
      <Card style={{ marginBottom: 16 }} loading={status.isLoading}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Status pembukuan">
            {lockedUntil ? (
              <Tag icon={<LockOutlined />} color="red">
                Terkunci sampai {fmtDate(lockedUntil)}
              </Tag>
            ) : (
              <Tag icon={<UnlockOutlined />} color="green">
                Semua periode terbuka
              </Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          Kunci periode menyegel bulan yang sudah final: transaksi bertanggal sampai tanggal kunci tidak bisa dibuat, dibatalkan, atau diubah oleh siapa pun. Dilakukan tiap bulan setelah laporannya final.
        </Typography.Paragraph>
      </Card>

      {bookkeeper ? (
        <Card style={{ marginBottom: 16 }}>
          <div style={STEP}>1. Pilih bulan yang mau ditutup</div>
          <Space wrap style={{ marginBottom: 20 }}>
            <Input type="month" value={month} max={dayjs().subtract(1, 'month').format('YYYY-MM')} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 180 }} />
            <Typography.Text type="secondary">Periode dikunci sampai {until ? fmtDate(until) : '—'}.</Typography.Text>
          </Space>

          <div style={STEP}>2. Periksa pekerjaan akhir bulan</div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            Dihitung otomatis dari data Anda (daftar yang sama dengan Jurnal penyesuaian).
          </Typography.Paragraph>
          {checklist.isLoading ? (
            <Typography.Text type="secondary">Memeriksa…</Typography.Text>
          ) : open.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message={`${open.length} pekerjaan belum selesai`}
              description="Selesaikan dulu sebelum mengunci; setelah terkunci, perbaikannya harus lewat Pemilik."
            />
          ) : (
            <Alert type="success" showIcon style={{ marginBottom: 8 }} message="Tidak ada pekerjaan akhir bulan yang tertunda. Siap dikunci." />
          )}
          {shown.length > 0 && (
            <List
              size="small"
              dataSource={shown}
              renderItem={(i) => (
                <List.Item actions={i.link ? [<Button key="b" size="small" onClick={() => navigate(i.link!)}>Buka</Button>] : []}>
                  <List.Item.Meta
                    avatar={i.status === 'DONE' ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <ClockCircleFilled style={{ color: '#faad14' }} />}
                    title={<Space>{i.title}{i.waiting && <Tag>Belum waktunya</Tag>}</Space>}
                    description={i.message}
                  />
                </List.Item>
              )}
            />
          )}
          <Button type="link" size="small" style={{ padding: 0, marginBottom: 20 }} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Sembunyikan yang sudah selesai' : `Tampilkan semua pemeriksaan (${items.length})`}
          </Button>

          <div style={STEP}>3. Kunci</div>
          {notEnded && <Alert style={{ marginBottom: 8 }} type="warning" showIcon message="Bulan ini belum berakhir; sistem menolak mengunci tanggal yang belum lewat." />}
          {alreadyLocked && <Alert style={{ marginBottom: 8 }} type="info" showIcon message="Periode sudah terkunci sampai tanggal ini." />}
          {unlocking && !isOwner && <Alert style={{ marginBottom: 8 }} type="warning" showIcon message="Bulan ini sudah terkunci. Membuka kembali hanya bisa dilakukan Pemilik." />}
          <Popconfirm
            title={unlocking ? 'Buka kembali periode?' : 'Kunci periode?'}
            description={unlocking ? 'Transaksi lama bisa diubah lagi. Hanya Pemilik yang boleh.' : `Semua transaksi sampai ${fmtDate(until)} dikunci.`}
            onConfirm={() => lock.mutate(until)}
          >
            <Button type="primary" danger={unlocking} icon={unlocking ? <UnlockOutlined /> : <LockOutlined />} loading={lock.isPending} disabled={!until || notEnded || alreadyLocked || (unlocking && !isOwner)}>
              {unlocking ? `Buka kembali sampai ${fmtDate(until)}` : `Kunci sampai ${until ? fmtDate(until) : '…'}`}
            </Button>
          </Popconfirm>
          <ul style={{ color: 'rgba(0,0,0,.55)', paddingLeft: 18, marginBottom: 0, marginTop: 12 }}>
            <li>Transaksi baru bertanggal setelah tanggal kunci tetap normal.</li>
            <li>Salah catat di bulan terkunci: Pemilik membuka kembali (tercatat di jejak audit), perbaiki, lalu kunci lagi.</li>
            <li>Pengguna lain yang mencatat transaksi bertanggal bulan terkunci akan ditolak; arahkan mencatatnya dengan tanggal bulan berjalan.</li>
          </ul>
        </Card>
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Peran Anda hanya dapat melihat halaman ini." />
      )}

      <Collapse
        items={[
          {
            key: 'year',
            label: 'Akhir tahun: tutup buku tahunan (sekali setahun)',
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  Membuat jurnal penutup per 31 Desember: saldo semua akun pendapatan dan beban dinolkan dan laba/rugi bersih dipindah ke Laba Ditahan. Laporan laba rugi tahun tersebut tetap bisa dibaca.
                  Lakukan setelah semua bulan tahun itu dikunci.
                </Typography.Paragraph>
                {bookkeeper && (
                  <Space wrap align="center">
                    <InputNumber value={year} min={2000} max={dayjs().year() - 1} onChange={(v) => v && setYear(v)} prefix="Tahun" style={{ width: 160 }} />
                    <Checkbox checked={lockYear} onChange={(e) => setLockYear(e.target.checked)}>
                      Sekaligus kunci sampai 31 Des
                    </Checkbox>
                    <Popconfirm title={`Tutup buku tahun ${year}?`} description="Pastikan semua transaksi tahun itu sudah lengkap." onConfirm={() => close.mutate(undefined)}>
                      <Button type="primary" loading={close.isPending}>
                        Tutup buku
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
                <Table
                  style={{ marginTop: 16 }}
                  rowKey="number"
                  size="small"
                  pagination={false}
                  dataSource={status.data?.closings}
                  locale={{ emptyText: 'Belum ada tahun yang ditutup' }}
                  columns={[
                    { title: 'Tahun', dataIndex: 'year' },
                    { title: 'Jurnal penutup', dataIndex: 'number' },
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'auto',
            label: 'Pengaturan otomatis (opsional): biarkan sistem mengerjakan sendiri',
            children: <AutoBookkeepingCard />,
          },
        ]}
      />
    </>
  );
}
