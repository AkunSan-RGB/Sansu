import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Input, InputNumber, Popconfirm, Row, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PeriodStatus } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

export default function ClosingPage() {
  const { me } = useAuth();
  const isOwner = me?.role === 'OWNER';
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

  return (
    <>
      <PageHeader title="Tutup Buku" />
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
              Setelah laporan bulanan final (sudah lapor pajak / dikirim ke pemilik), kunci periodenya. Transaksi bertanggal sampai tanggal kunci
              tidak bisa dibuat, dibatalkan, atau dikoreksi — termasuk faktur, pembayaran, retur, kas, dan stok.
            </Typography.Paragraph>
            <Space wrap>
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 170 }} />
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
            {unlocking && !isOwner && <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Membuka kembali periode yang sudah dikunci hanya bisa dilakukan Pemilik." />}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Tutup buku akhir tahun">
            <Typography.Paragraph type="secondary">
              Membuat jurnal penutup per 31 Desember: saldo semua akun pendapatan & beban dinolkan dan laba/rugi bersih dipindah ke Laba Ditahan.
              Laporan laba rugi tahun tersebut tetap bisa dibaca.
            </Typography.Paragraph>
            <Space wrap align="center">
              <InputNumber value={year} min={2000} max={2100} onChange={(v) => v && setYear(v)} prefix="Tahun" style={{ width: 160 }} />
              <Checkbox checked={lockYear} onChange={(e) => setLockYear(e.target.checked)}>
                Sekaligus kunci sampai 31 Des
              </Checkbox>
              <Popconfirm title={`Tutup buku tahun ${year}?`} description="Pastikan semua transaksi tahun itu sudah lengkap." onConfirm={() => close.mutate(undefined)}>
                <Button type="primary" loading={close.isPending}>
                  Tutup buku
                </Button>
              </Popconfirm>
            </Space>
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
