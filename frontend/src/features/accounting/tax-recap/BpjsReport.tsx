import { BRAND, type BpjsRecap } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, DatePicker, Empty, Row, Space, Statistic, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';
import { bpjsSheets } from '@/lib/xlsx/reports';

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
