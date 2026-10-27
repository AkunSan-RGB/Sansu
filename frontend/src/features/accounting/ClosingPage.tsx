import { CheckCircleFilled, ClockCircleFilled, InfoCircleFilled, LockOutlined, MinusCircleOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Input, InputNumber, List, Popconfirm, Row, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PeriodStatus } from '@/api/types';
import { canBookkeep } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import AutoBookkeepingCard from './AutoBookkeepingCard';
import { fmtDate, fmtMoney } from '@/lib/format';

type CheckItem = { key: string; title: string; status: 'DONE' | 'TODO' | 'INFO' | 'NA'; message: string; link?: string; waiting?: boolean };
const ICON = {
  DONE: <CheckCircleFilled style={{ color: '#52c41a' }} />,
  TODO: <ClockCircleFilled style={{ color: '#faad14' }} />,
  INFO: <InfoCircleFilled style={{ color: '#111111' }} />,
  NA: <MinusCircleOutlined style={{ color: '#bfbfbf' }} />,
};

export default function ClosingPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const isOwner = me?.role === 'OWNER';
  const bookkeeper = canBookkeep(me?.role);
  const status = useQuery({ queryKey: ['period'], queryFn: () => get<PeriodStatus>('/accounting/period') });
  const lockedUntil = status.data?.lockedUntil ?? null;

  const [until, setUntil] = useState(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'));
  const [year, setYear] = useState<number>(dayjs().year() - 1);
  const [lockYear, setLockYear] = useState(true);

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

  const unlocking = !!lockedUntil && until < lockedUntil;
  const today = dayjs().format('YYYY-MM-DD');
  const endOfMonth = dayjs(until).endOf('month').format('YYYY-MM-DD');
  const notMonthEnd = !!until && until !== endOfMonth;
  const notEnded = !!until && until >= today;
  // pekerjaan akhir bulan untuk bulan dari tanggal yang dipilih (daftar periksa yang sama dengan Jurnal Penyesuaian)
  const period = (until || today).slice(0, 7);
  const checklist = useQuery({
    queryKey: ['closing-checklist', period],
    queryFn: () => get<{ items: CheckItem[] }>(`/accounting/adjustments/checklist?period=${period}`),
    enabled: bookkeeper && !!until,
  });
  const open = (checklist.data?.items ?? []).filter((i) => i.status === 'TODO' && !i.waiting);

  return (
    <>
      <PageHeader title="Tutup Buku" />
      <AutoBookkeepingCard />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Dua hal yang berbeda di halaman ini"
        description={
          <span>
            <b>Kunci periode</b> menyegel bulan yang sudah final supaya angkanya tidak bisa diubah lagi (dilakukan tiap bulan, opsional tetapi disarankan).{' '}
            <b>Tutup buku akhir tahun</b> membuat jurnal penutup yang memindahkan laba/rugi tahun itu ke Laba Ditahan (sekali setahun).
            Memastikan transaksi masuk ke bulan yang benar (cut-off) dikerjakan lebih dulu lewat <a onClick={() => navigate('/adjustments')}>Jurnal penyesuaian</a>.
          </span>
        }
      />
      {bookkeeper && (
        <Card title={`Sebelum mengunci: periksa bulan ${dayjs(`${period}-01`).format('MMMM YYYY')}`} style={{ marginBottom: 16 }} loading={checklist.isLoading}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            Dicentang otomatis dari data Anda. Selesaikan baris oranye lebih dulu; kunci hanya setelah bulan berakhir dan laporannya final.
          </Typography.Paragraph>
          <List
            size="small"
            dataSource={checklist.data?.items ?? []}
            renderItem={(i) => (
              <List.Item
                actions={i.link ? [<Button key="b" size="small" onClick={() => navigate(i.link!)}>Buka</Button>] : []}
              >
                <List.Item.Meta
                  avatar={ICON[i.status]}
                  title={<Space>{i.title}{i.waiting && <Tag>Belum waktunya</Tag>}{i.status === 'TODO' && !i.waiting && <Tag color="orange">Perlu dikerjakan</Tag>}</Space>}
                  description={i.message}
                />
              </List.Item>
            )}
          />
          {open.length > 0 ? (
            <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`${open.length} pekerjaan akhir bulan masih perlu dikerjakan: ${open.map((i) => i.title).join(', ')}. Sebaiknya selesaikan sebelum mengunci.`} />
          ) : (
            <Alert style={{ marginTop: 12 }} type="success" showIcon message="Tidak ada pekerjaan akhir bulan yang tertunda untuk bulan ini." />
          )}
        </Card>
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Kunci periode" loading={status.isLoading}>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Status">
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
            <Typography.Paragraph type="secondary">
              Setelah laporan bulanan final (sudah lapor pajak / dikirim ke pemilik), kunci periodenya. Tanggal yang dipilih adalah <b>akhir</b> periode yang dikunci:
              semua transaksi bertanggal sampai tanggal itu tidak bisa dibuat, dibatalkan, atau dikoreksi oleh siapa pun — termasuk faktur, pembayaran, retur, kas, dan stok.
              Transaksi bertanggal setelahnya tetap normal.
            </Typography.Paragraph>
            <ul style={{ color: 'rgba(0,0,0,.55)', paddingLeft: 18, marginTop: 0 }}>
              <li>Salah catat di bulan yang terkunci: minta <b>Pemilik</b> membuka kembali (tercatat di jejak audit), perbaiki, lalu kunci lagi.</li>
              <li>Pengguna lain yang mencatat transaksi bertanggal bulan terkunci akan ditolak; arahkan mencatatnya dengan tanggal bulan berjalan.</li>
              <li>Periode yang belum berakhir tidak bisa dikunci.</li>
            </ul>
            {bookkeeper ? (
            <Space wrap>
              <Input type="date" value={until} max={dayjs().format("YYYY-MM-DD")} onChange={(e) => setUntil(e.target.value)} style={{ width: 170 }} />
              <Button size="small" onClick={() => setUntil(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'))}>Akhir bulan lalu</Button>
              <Button size="small" onClick={() => setUntil(dayjs().subtract(2, 'month').endOf('month').format('YYYY-MM-DD'))}>Akhir 2 bulan lalu</Button>
              <Popconfirm
                title={unlocking ? 'Buka kembali periode?' : 'Kunci periode?'}
                description={unlocking ? 'Transaksi lama bisa diubah lagi. Hanya Pemilik yang boleh.' : `Semua transaksi sampai ${fmtDate(until)} dikunci.`}
                onConfirm={() => lock.mutate(until)}
              >
                <Button type="primary" danger={unlocking} icon={unlocking ? <UnlockOutlined /> : <LockOutlined />} loading={lock.isPending} disabled={unlocking && !isOwner}>
                  {unlocking ? 'Buka kembali sampai tanggal ini' : 'Kunci sampai tanggal ini'}
                </Button>
              </Popconfirm>
            </Space>
            ) : (
              <Typography.Text type="secondary">Peran Anda hanya dapat melihat halaman ini.</Typography.Text>
            )}
            {bookkeeper && !unlocking && notMonthEnd && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`${fmtDate(until)} bukan akhir bulan. Biasanya periode dikunci sampai akhir bulan (${fmtDate(endOfMonth)}).`} />}
            {bookkeeper && !unlocking && notEnded && <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Periode ini belum berakhir; sistem akan menolak tanggal yang belum lewat." />}
            {bookkeeper && unlocking && !isOwner && <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Membuka kembali periode yang sudah dikunci hanya bisa dilakukan Pemilik." />}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Tutup buku akhir tahun">
            <Typography.Paragraph type="secondary">
              Membuat jurnal penutup per 31 Desember: saldo semua akun pendapatan & beban dinolkan dan laba/rugi bersih dipindah ke Laba Ditahan.
              Laporan laba rugi tahun tersebut tetap bisa dibaca.
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
          </Card>
        </Col>
      </Row>
    </>
  );
}
