import { WarningOutlined } from '@ant-design/icons';
import { BRAND, type AnnualTaxRecap, type TaxRecapCell, type TaxRecapStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Descriptions, InputNumber, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';
import { annualTaxSheets } from '@/lib/xlsx/reports';

const STATUS: Record<TaxRecapStatus, { color: string; label: string }> = {
  NIHIL: { color: 'default', label: 'Nihil' },
  TEPAT: { color: 'green', label: 'Tepat waktu' },
  TERLAMBAT: { color: 'orange', label: 'Disetor terlambat' },
  KURANG: { color: 'gold', label: 'Kurang setor' },
  KURANG_TERLAMBAT: { color: 'red', label: 'Kurang setor, lewat jatuh tempo' },
  BELUM: { color: 'blue', label: 'Belum disetor' },
  TERLAMBAT_BELUM: { color: 'red', label: 'Belum disetor, lewat jatuh tempo' },
  LEBIH_BAYAR: { color: 'cyan', label: 'Lebih bayar (dikompensasi)' },
  BELUM_MASA: { color: 'default', label: '—' },
};

const BAD: TaxRecapStatus[] = ['TERLAMBAT', 'KURANG_TERLAMBAT', 'TERLAMBAT_BELUM'];

function Cell({ c, type }: { c: TaxRecapCell; type: string }) {
  if (c.status === 'BELUM_MASA') return <Typography.Text type="secondary">—</Typography.Text>;
  const payable = type === 'PPN' && Number(c.payable) < 0 ? 0 : Number(c.payable);
  const st = STATUS[c.status];
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 12 }}>
          <div>Terutang: {fmtMoney(payable)}</div>
          <div>Disetor: {fmtMoney(c.paid)}</div>
          {c.detail?.keluaran && (
            <div>
              Keluaran {fmtMoney(c.detail.keluaran)} · masukan {fmtMoney(c.detail.masukan)}
              {Number(c.detail.kompensasi) > 0 && ` · kompensasi ${fmtMoney(c.detail.kompensasi)}`}
            </div>
          )}
          {type === 'PPN' && Number(c.payable) < 0 && (
            <div>Lebih bayar {fmtMoney(-Number(c.payable))} dibawa ke masa berikutnya</div>
          )}
          <div>Jatuh tempo setor: {fmtDate(c.dueDate)}</div>
          {c.paidDate && <div>Disetor: {fmtDate(c.paidDate)}</div>}
          {c.ntpn && <div>NTPN: {c.ntpn}</div>}
        </div>
      }
    >
      <div style={{ textAlign: 'right', cursor: 'help' }}>
        <div style={{ fontVariantNumeric: 'tabular-nums' }}>{payable ? fmtMoney(payable) : '-'}</div>
        {c.status !== 'NIHIL' && (
          <Tag color={st.color} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>
            {st.label}
          </Tag>
        )}
      </div>
    </Tooltip>
  );
}

export function Annual() {
  const { me } = useAuth();
  const [year, setYear] = useState(dayjs().year());
  const q = useQuery({
    queryKey: ['tax-recap', 'annual', year],
    queryFn: () => get<AnnualTaxRecap>(`/tax/reports/annual${qs({ year: String(year) })}`),
  });
  return (
    <QueryState q={q}>
      {(r) => {
        const problems = r.types.flatMap((t) =>
          t.months.filter((c) => BAD.includes(c.status)).map((c) => ({ t: t.label, c })),
        );
        const totals = r.types.reduce(
          (a, t) => ({
            payable: a.payable + t.months.reduce((s, c) => s + Math.max(0, Number(c.payable)), 0),
            paid: a.paid + Number(t.total.paid),
          }),
          { payable: 0, paid: 0 },
        );
        const data = Array.from({ length: 12 }, (_, i) => ({ i, period: `${year}-${String(i + 1).padStart(2, '0')}` }));
        return (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <InputNumber value={year} min={2020} max={2100} onChange={(v) => v && setYear(v)} prefix="Tahun" />
              <ExportButtons
                filename={`rekap-pajak-${year}`}
                title={`Rekap pajak & BPJS ${year}`}
                sheets={() => annualTaxSheets(r, me?.tenantName)}
              />
            </Space>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={8}>
                <Card size="small">
                  <Statistic
                    title={`Terutang ${year}`}
                    value={fmtMoney(totals.payable)}
                    valueStyle={{ fontSize: 18 }}
                  />
                </Card>
              </Col>
              <Col xs={12} md={8}>
                <Card size="small">
                  <Statistic title="Sudah disetor" value={fmtMoney(totals.paid)} valueStyle={{ fontSize: 18 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small">
                  <Statistic
                    title="Masa terlambat / kurang"
                    value={problems.length}
                    suffix="masa"
                    valueStyle={{ fontSize: 18, color: problems.length ? '#dc2626' : BRAND.colors.accent }}
                  />
                </Card>
              </Col>
            </Row>
            {problems.length > 0 && (
              <Alert
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message="Perlu perhatian"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {problems.slice(0, 8).map(({ t, c }) => (
                      <li key={t + c.period}>
                        {t} masa {dayjs(`${c.period}-01`).format('MMMM YYYY')}: {STATUS[c.status].label.toLowerCase()}{' '}
                        (jatuh tempo {fmtDate(c.dueDate)}). Sanksi bunga per bulan keterlambatan dapat dikenakan.
                      </li>
                    ))}
                  </ul>
                }
                action={<Link to="/tax">Catat setoran</Link>}
              />
            )}
            <Card size="small">
              <Table
                rowKey="period"
                size="small"
                pagination={false}
                scroll={{ x: 1100 }}
                dataSource={data}
                columns={[
                  {
                    title: 'Masa',
                    dataIndex: 'period',
                    fixed: 'left',
                    width: 110,
                    render: (p: string) => dayjs(`${p}-01`).format('MMM YYYY'),
                  },
                  ...r.types.map((t) => ({
                    title: t.label,
                    key: t.type,
                    align: 'right' as const,
                    render: (_: unknown, x: { i: number }) => <Cell c={t.months[x.i]} type={t.type} />,
                  })),
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <strong>Jumlah disetor</strong>
                    </Table.Summary.Cell>
                    {r.types.map((t, i) => (
                      <Table.Summary.Cell key={t.type} index={i + 1} align="right">
                        <strong>{fmtMoney(t.total.paid)}</strong>
                      </Table.Summary.Cell>
                    ))}
                  </Table.Summary.Row>
                )}
              />
            </Card>
            {r.corporate && (
              <Card
                size="small"
                title={`PPh Badan tahun ${year} (SPT Tahunan)`}
                extra={<Link to="/fiscal">Rekonsiliasi fiskal</Link>}
              >
                <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                  <Descriptions.Item label="Laba sebelum pajak">
                    {fmtMoney(r.corporate.profitBeforeTax)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Penghasilan kena pajak">{fmtMoney(r.corporate.pkp)}</Descriptions.Item>
                  <Descriptions.Item label="PPh terutang">{fmtMoney(r.corporate.taxDue)}</Descriptions.Item>
                  <Descriptions.Item label="Kredit pajak (PPh 22/23/25)">
                    {fmtMoney(r.corporate.credits)}
                  </Descriptions.Item>
                  <Descriptions.Item label="PPh 29 kurang bayar">{fmtMoney(r.corporate.pph29)}</Descriptions.Item>
                  <Descriptions.Item label="PPh 29 disetor">{fmtMoney(r.corporate.paid29)}</Descriptions.Item>
                  <Descriptions.Item label="Angsuran PPh 25 tahun depan">
                    {fmtMoney(r.corporate.installment25Next)} / bulan
                  </Descriptions.Item>
                  <Descriptions.Item label="Batas setor & lapor SPT">{fmtDate(r.corporate.dueDate)}</Descriptions.Item>
                </Descriptions>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.corporate.method}
                  {!r.corporate.journalPosted && ' · Jurnal beban pajak tahun ini belum dibuat.'}
                </Typography.Text>
              </Card>
            )}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              Jatuh tempo: PPh 21/23/4(2)/25 setor tgl 15 bulan berikutnya & lapor SPT Masa (Bukti Potong) tgl 20; PPN
              setor & lapor akhir bulan berikutnya; BPJS Kesehatan tgl 10 dan BPJS Ketenagakerjaan tgl 15 bulan
              berikutnya; PPh Badan akhir April tahun berikutnya. Rincian lain: <Link to="/vat">Rekap PPN</Link>
              {' · '}
              <Link to="/payroll/pph21">Rekap PPh 21</Link>.
            </Typography.Paragraph>
          </Space>
        );
      }}
    </QueryState>
  );
}
