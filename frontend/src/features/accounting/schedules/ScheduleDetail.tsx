import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Space, Tabs, Tag, Typography } from 'antd';
import { get, qs } from '@/api/client';
import type { ScheduleResult } from '@/api/types';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import { fmtMoney } from '@/lib/format';
import { scheduleSheet } from '@/lib/xlsx/reports';
import ScheduleTableView from './ScheduleTableView';

/** Rincian satu akun: tab Rincian & perhitungan, Metode, dan Temuan; saldo akhir dibandingkan dengan laporan keuangan */
export default function ScheduleDetail({ accountId, year, company, extra }: { accountId: string; year: number; company?: string; extra?: React.ReactNode }) {
  const q = useQuery({
    queryKey: ['account-schedules', 'detail', accountId, year],
    queryFn: () => get<ScheduleResult>(`/account-schedules/${accountId}${qs({ year: String(year) })}`),
  });
  return (
    <QueryState q={q}>
      {(d) => (
        <>
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {d.account.code} {d.account.name}
              {d.needsDefinition && (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  Metode perlu ditentukan
                </Tag>
              )}
            </Typography.Title>
            <Space wrap>
              {extra}
              <ExportButtons filename={`rincian-${d.account.code || 'laba-belum-ditutup'}-${d.year}`} title={d.title} sheets={() => scheduleSheet(d, company)} />
            </Space>
          </Space>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Saldo akhir di laporan keuangan">{fmtMoney(d.reported)}</Descriptions.Item>
            <Descriptions.Item label="Saldo akhir menurut rincian">{fmtMoney(d.computed)}</Descriptions.Item>
            <Descriptions.Item label="Selisih">
              <Tag color={d.matches ? 'green' : 'red'}>{d.matches ? 'Cocok' : fmtMoney(d.difference)}</Tag>
            </Descriptions.Item>
          </Descriptions>
          {d.findings.map((f) => (
            <Alert key={f} type="warning" showIcon message={f} style={{ marginBottom: 8 }} />
          ))}
          <Tabs
            items={[
              { key: 'detail', label: 'Rincian & perhitungan', children: d.tables.map((t) => <ScheduleTableView key={t.key} table={t} />) },
              {
                key: 'method',
                label: 'Metode',
                children: (
                  <>
                    <Typography.Paragraph>{d.method.basis}</Typography.Paragraph>
                    <Typography.Title level={5}>Rumus dan perhitungan</Typography.Title>
                    <ul>
                      {d.method.formulas.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {!!d.method.policies?.length && (
                      <>
                        <Typography.Title level={5}>Kebijakan</Typography.Title>
                        <ul>
                          {d.method.policies.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </QueryState>
  );
}
