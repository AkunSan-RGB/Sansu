import { WarningOutlined } from '@ant-design/icons';
import {
  BRAND,
  type AnnualTaxRecap,
  type BpjsRecap,
  type TaxRecapCell,
  type TaxRecapStatus,
  type WithholdingRecap,
} from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  InputNumber,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { useApps } from '@/lib/apps';
import { fmtDate, fmtMoney } from '@/lib/format';
import { annualTaxSheets, bpjsSheets, withholdingSheets } from '@/lib/xlsx/reports';

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

/** Rekap pajak & BPJS: tahunan per masa, PPh 23/4(2) dipotong, dan iuran BPJS */
export default function TaxRecapPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useApps();
  const tab = params.get('tab') ?? 'annual';
  return (
    <>
      <PageHeader title="Rekap pajak & BPJS" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'annual', label: 'Rekap tahunan', children: <Annual /> },
          { key: 'withholding', label: 'PPh 23 & 4(2) dipotong', children: <Withholding /> },
          ...(can('payroll') ? [{ key: 'bpjs', label: 'Iuran BPJS', children: <BpjsReport /> }] : []),
        ]}
      />
    </>
  );
}

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

function Annual() {
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

function Withholding() {
  const { me } = useAuth();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(dayjs().subtract(1, 'month'));
  const period = mode === 'month' ? month.format('YYYY-MM') : month.format('YYYY');
  const q = useQuery({
    queryKey: ['tax-recap', 'withholding', period],
    queryFn: () => get<WithholdingRecap>(`/tax/reports/withholding${qs({ period })}`),
  });
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as 'month' | 'year')}
          options={[
            { value: 'month', label: 'Per masa' },
            { value: 'year', label: 'Setahun' },
          ]}
        />
        <DatePicker
          picker={mode}
          value={month}
          onChange={(v) => v && setMonth(v)}
          allowClear={false}
          format={mode === 'month' ? 'MMMM YYYY' : 'YYYY'}
          style={{ width: 180 }}
        />
        <ExportButtons
          filename={`pph23-42-${period}`}
          title={`Pemotongan PPh 23 & 4(2) ${period}`}
          sheets={() => (q.data ? withholdingSheets(q.data, me?.tenantName) : null)}
        />
      </Space>
      <QueryState q={q}>
        {(w) => (
          <>
            <Row gutter={[16, 16]}>
              {w.summary.map((s) => (
                <Col key={s.type} xs={24} md={12}>
                  <Card size="small" title={s.label}>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Statistic title="Transaksi" value={s.count} valueStyle={{ fontSize: 18 }} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="DPP" value={fmtMoney(s.base)} valueStyle={{ fontSize: 18 }} />
                      </Col>
                      <Col span={8}>
                        <Statistic
                          title="PPh dipotong"
                          value={fmtMoney(s.amount)}
                          valueStyle={{ fontSize: 18, color: BRAND.colors.primary }}
                        />
                      </Col>
                    </Row>
                    {s.dueDate && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Setor paling lambat {fmtDate(s.dueDate)} · buat bukti potong & lapor paling lambat{' '}
                        {fmtDate(s.reportDue)}
                      </Typography.Text>
                    )}
                    {Number(s.unexplained) !== 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 8 }}
                        message={`Buku besar ${fmtMoney(s.ledger)} berbeda ${fmtMoney(s.unexplained)} dari daftar faktur`}
                        description="Biasanya karena jurnal manual langsung ke akun utang PPh. Pastikan setiap potongan tercatat lewat tagihan supplier agar bukti potongnya lengkap."
                      />
                    )}
                  </Card>
                </Col>
              ))}
            </Row>
            {w.missingNpwp.length > 0 && (
              <Alert
                type="error"
                showIcon
                message="Supplier tanpa NPWP/NIK"
                description={`${w.missingNpwp.join(', ')}. Bukti potong membutuhkan NPWP atau NIK penerima penghasilan; tanpa NPWP tarif PPh 23 menjadi 100% lebih tinggi (4%). Lengkapi di menu Supplier.`}
              />
            )}
            <Card size="small" title="Daftar pemotongan (bahan bukti potong e-Bupot Unifikasi di Coretax)">
              <Table
                rowKey="id"
                size="small"
                dataSource={w.rows}
                scroll={{ x: 1000 }}
                pagination={{ pageSize: 50, hideOnSinglePage: true }}
                locale={{ emptyText: <Empty description="Tidak ada pemotongan PPh pada periode ini" /> }}
                columns={[
                  {
                    title: 'Jenis',
                    dataIndex: 'type',
                    render: (t) => (
                      <Tag color={t === 'PPH23' ? 'blue' : 'purple'}>{t === 'PPH23' ? 'PPh 23' : 'PPh 4(2)'}</Tag>
                    ),
                  },
                  { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                  {
                    title: 'Faktur',
                    dataIndex: 'number',
                    render: (n, r) => (
                      <>
                        {n}
                        <div style={{ fontSize: 11, color: '#64748b' }}>{r.supplierInvoiceNo}</div>
                      </>
                    ),
                  },
                  { title: 'Supplier', dataIndex: 'supplierName' },
                  {
                    title: 'NPWP / NIK',
                    dataIndex: 'supplierNpwp',
                    render: (v) => v || <Tag color="red">belum ada</Tag>,
                  },
                  { title: 'Uraian', dataIndex: 'description', ellipsis: true },
                  { title: 'DPP', dataIndex: 'base', align: 'right', render: fmtMoney },
                  { title: 'Tarif', dataIndex: 'rate', align: 'right', render: (v) => (v ? `${Number(v)}%` : '-') },
                  { title: 'PPh', dataIndex: 'amount', align: 'right', render: fmtMoney },
                ]}
              />
            </Card>
          </>
        )}
      </QueryState>
    </Space>
  );
}

export function BpjsReport() {
  const { me } = useAuth();
  const [month, setMonth] = useState(dayjs().subtract(1, 'month'));
  const period = month.format('YYYY-MM');
  const q = useQuery({
    queryKey: ['tax-recap', 'bpjs', period],
    queryFn: () => get<BpjsRecap>(`/payroll/reports/bpjs${qs({ period })}`),
  });
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <DatePicker
          picker="month"
          value={month}
          onChange={(v) => v && setMonth(v)}
          allowClear={false}
          format="MMMM YYYY"
          style={{ width: 180 }}
        />
        <ExportButtons
          filename={`bpjs-${period}`}
          title={`Rekap BPJS ${period}`}
          sheets={() => (q.data ? bpjsSheets(q.data, me?.tenantName) : null)}
        />
      </Space>
      <QueryState q={q}>
        {(b) =>
          !b.rows.length ? (
            <Empty
              description={b.run ? 'Penggajian masa ini belum diposting' : 'Belum ada penggajian untuk masa ini'}
            />
          ) : (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic
                      title="Bayar ke BPJS Kesehatan"
                      value={fmtMoney(b.kesehatan)}
                      valueStyle={{ fontSize: 18 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      jatuh tempo {fmtDate(b.dueKesehatan)}
                    </Typography.Text>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic
                      title="Bayar ke BPJS Ketenagakerjaan"
                      value={fmtMoney(b.ketenagakerjaan)}
                      valueStyle={{ fontSize: 18 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      jatuh tempo {fmtDate(b.dueKetenagakerjaan)}
                    </Typography.Text>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card size="small">
                    <Statistic
                      title="Sudah dicatat disetor"
                      value={fmtMoney(b.paid.amount)}
                      valueStyle={{
                        fontSize: 18,
                        color: Number(b.paid.amount) >= Number(b.total) ? BRAND.colors.accent : undefined,
                      }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      dari total {fmtMoney(b.total)}
                      {b.paid.date && ` · ${fmtDate(b.paid.date)}`}
                    </Typography.Text>
                  </Card>
                </Col>
              </Row>
              {b.changes.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  message="Perubahan peserta bulan ini — pastikan sudah dilaporkan ke BPJS"
                  description={b.changes
                    .map((c) => `${c.kind === 'MASUK' ? 'Masuk' : 'Keluar'}: ${c.code} ${c.name} (${fmtDate(c.date)})`)
                    .join(' · ')}
                />
              )}
              <Card size="small" title={`Rincian per karyawan · ${b.run?.number ?? ''}`}>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={b.rows}
                  pagination={false}
                  scroll={{ x: 1300 }}
                  columns={[
                    {
                      title: 'Karyawan',
                      dataIndex: 'name',
                      fixed: 'left',
                      render: (n, r) => (
                        <>
                          {n}
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {r.code}
                            {r.nik ? ` · ${r.nik}` : ''}
                          </div>
                        </>
                      ),
                    },
                    { title: 'Dasar upah', dataIndex: 'wage', align: 'right', render: fmtMoney },
                    {
                      title: 'BPJS Kesehatan',
                      children: [
                        { title: 'Perusahaan', dataIndex: 'kesCompany', align: 'right', render: fmtMoney },
                        { title: 'Karyawan', dataIndex: 'kesEmployee', align: 'right', render: fmtMoney },
                      ],
                    },
                    {
                      title: 'BPJS Ketenagakerjaan',
                      children: [
                        { title: 'JHT 3,7%', dataIndex: 'jhtCompany', align: 'right', render: fmtMoney },
                        { title: 'JHT 2%', dataIndex: 'jhtEmployee', align: 'right', render: fmtMoney },
                        { title: 'JKK', dataIndex: 'jkkCompany', align: 'right', render: fmtMoney },
                        { title: 'JKM', dataIndex: 'jkmCompany', align: 'right', render: fmtMoney },
                        { title: 'JP 2%', dataIndex: 'jpCompany', align: 'right', render: fmtMoney },
                        { title: 'JP 1%', dataIndex: 'jpEmployee', align: 'right', render: fmtMoney },
                      ],
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0}>
                        <strong>Jumlah</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} />
                      {(
                        [
                          'kesCompany',
                          'kesEmployee',
                          'jhtCompany',
                          'jhtEmployee',
                          'jkkCompany',
                          'jkmCompany',
                          'jpCompany',
                          'jpEmployee',
                        ] as const
                      ).map((k, i) => (
                        <Table.Summary.Cell key={k} index={i + 2} align="right">
                          <strong>{fmtMoney(b.totals[k])}</strong>
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  )}
                />
              </Card>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                Cocokkan total di atas dengan tagihan di SIPP (Ketenagakerjaan) dan e-Dabu (Kesehatan) sebelum membayar.
                Batas upah yang dipakai: Kesehatan {fmtMoney(b.caps.kesehatan)}, Jaminan Pensiun {fmtMoney(b.caps.jp)} —
                perbarui di Pengaturan penggajian setiap ada pengumuman batas baru. Setelah membayar, catat di{' '}
                <Link to="/tax">Setoran pajak & BPJS</Link>.
              </Typography.Paragraph>
            </>
          )
        }
      </QueryState>
    </Space>
  );
}
