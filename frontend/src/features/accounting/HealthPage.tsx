import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Collapse, Descriptions, Input, Progress, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { HealthReport, HealthStatus } from '@/api/types';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, today } from '@/lib/format';

const ICON: Record<HealthStatus, React.ReactNode> = {
  OK: <CheckCircleFilled style={{ color: '#52c41a' }} />,
  WARN: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
  ERROR: <CloseCircleFilled style={{ color: '#ff4d4f' }} />,
  INFO: <InfoCircleFilled style={{ color: '#1677ff' }} />,
};
const COLOR: Record<HealthStatus, string> = { OK: 'green', WARN: 'orange', ERROR: 'red', INFO: 'blue' };
const LABEL: Record<HealthStatus, string> = { OK: 'Baik', WARN: 'Perhatikan', ERROR: 'Perlu diperbaiki', INFO: 'Info' };

const fmtRatio = (v: number | null, unit: string) =>
  v == null ? '—' : unit === '%' ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : unit === 'hari' ? `${Math.round(v)} hari` : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}×`;

export default function HealthPage() {
  const navigate = useNavigate();
  const [asOf, setAsOf] = useState(today());
  const q = useQuery({ queryKey: ['health', asOf], queryFn: () => get<HealthReport>(`/accounting/health?asOf=${asOf}`) });
  const d = q.data;
  const order: HealthStatus[] = ['ERROR', 'WARN', 'INFO', 'OK'];
  const checks = d ? [...d.checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)) : [];
  const groups = d ? [...new Set(d.ratios.map((r) => r.group))] : [];

  return (
    <>
      <PageHeader
        title="Cek Kesehatan Pembukuan"
        extra={
          <Space>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} prefix="Per" />
            <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} loading={q.isFetching}>
              Periksa ulang
            </Button>
          </Space>
        }
      />
      <QueryState q={q}>{(d) => (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}>
              <Card style={{ textAlign: 'center', height: '100%' }}>
                <Progress
                  type="dashboard"
                  percent={d.score}
                  format={(p) => (
                    <span>
                      {p}
                      <br />
                      <span style={{ fontSize: 14 }}>Nilai {d.grade}</span>
                    </span>
                  )}
                  strokeColor={d.score >= 85 ? '#52c41a' : d.score >= 65 ? '#faad14' : '#ff4d4f'}
                />
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  Skor kesiapan pembukuan per {fmtDate(d.asOf)}
                </Typography.Paragraph>
              </Card>
            </Col>
            <Col xs={24} md={16}>
              <Card style={{ height: '100%' }}>
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="Lolos" value={d.summary.ok} valueStyle={{ color: '#52c41a' }} prefix={ICON.OK} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Perhatikan" value={d.summary.warn} valueStyle={{ color: '#faad14' }} prefix={ICON.WARN} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Perlu diperbaiki" value={d.summary.error} valueStyle={{ color: '#ff4d4f' }} prefix={ICON.ERROR} />
                  </Col>
                </Row>
                <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
                  SANSU memeriksa keseimbangan buku, kecocokan buku pembantu (piutang, utang, persediaan, aset tetap) dengan buku besar, kelengkapan penyusutan, saldo yang
                  tidak wajar, bukti transaksi, dan penutupan periode — seperti pemeriksaan awal oleh auditor, otomatis setiap saat.
                </Typography.Paragraph>
              </Card>
            </Col>
          </Row>
          <Card title="Pemeriksaan" style={{ marginBottom: 16 }}>
            <Collapse
              items={checks.map((c) => ({
                key: c.key,
                label: (
                  <Space>
                    {ICON[c.status]}
                    <span>{c.title}</span>
                    <Tag color={COLOR[c.status]}>{LABEL[c.status]}</Tag>
                    <Typography.Text type="secondary">{c.category}</Typography.Text>
                  </Space>
                ),
                children: (
                  <>
                    <Typography.Paragraph>{c.message}</Typography.Paragraph>
                    {c.detail && c.detail.length > 0 && (
                      <Descriptions size="small" bordered column={1} style={{ marginBottom: 12 }}>
                        {c.detail.map((x, i) => (
                          <Descriptions.Item key={i} label={x.label}>
                            {x.value}
                          </Descriptions.Item>
                        ))}
                      </Descriptions>
                    )}
                    {c.link && (
                      <Button size="small" onClick={() => navigate(c.link!)}>
                        Buka
                      </Button>
                    )}
                  </>
                ),
              }))}
            />
          </Card>
          <Card title="Rasio keuangan — dijelaskan dengan bahasa sederhana">
            {groups.map((g) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <Typography.Title level={5}>{g}</Typography.Title>
                <Table
                  size="small"
                  rowKey="key"
                  pagination={false}
                  dataSource={d.ratios.filter((r) => r.group === g)}
                  scroll={{ x: 700 }}
                  columns={[
                    { title: 'Rasio', dataIndex: 'label', width: 220 },
                    {
                      title: 'Nilai',
                      width: 120,
                      align: 'right',
                      render: (_, r) => (
                        <Tooltip title={LABEL[r.status]}>
                          <Tag color={COLOR[r.status]}>{fmtRatio(r.value, r.unit)}</Tag>
                        </Tooltip>
                      ),
                    },
                    { title: 'Artinya', dataIndex: 'explanation' },
                  ]}
                />
              </div>
            ))}
          </Card>
        </>
      )}</QueryState>
    </>
  );
}
