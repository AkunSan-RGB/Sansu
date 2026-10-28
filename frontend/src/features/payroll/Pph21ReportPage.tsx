import { useQuery } from '@tanstack/react-query';
import { Card, Col, InputNumber, Row, Space, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get } from '@/api/client';
import ExportButtons from '@/components/ExportButtons';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import { pph21Sheets } from '@/lib/xlsx/reports';
import { useAuth } from '@/auth/AuthContext';

interface Report {
  year: number;
  employees: { employee_id: string; code: string; name: string; nik: string | null; npwp: string | null; ptkp: string; months: number; gross: string; pension: string; pph21: string }[];
  monthly: { period: string; gross: string; pph21: string; n: number }[];
}

/** Rekap PPh 21: tab di halaman Rekap pajak (embedded) atau halaman sendiri untuk peran yang hanya memegang Penggajian */
export function Pph21Recap({ embedded }: { embedded?: boolean }) {
  const { me } = useAuth();
  const [year, setYear] = useState(dayjs().year());
  const { data, isLoading } = useQuery({ queryKey: ['pph21', year], queryFn: () => get<Report>(`/payroll/reports/pph21?year=${year}`) });
  const tools = (
    <Space wrap className="no-print">
      <InputNumber value={year} min={2020} max={2100} onChange={(v) => v && setYear(v)} prefix="Tahun" />
      <ExportButtons
        filename={`pph21-${year}`}
        title={`Rekap PPh 21 ${year}`}
        sheets={() => (data ? pph21Sheets(data, me?.tenantName) : null)}
      />
    </Space>
  );
  return (
    <>
      {embedded ? <div style={{ marginBottom: 12 }}>{tools}</div> : <PageHeader title="Rekap PPh 21" extra={tools} />}
      {!embedded && (
        <Typography.Paragraph type="secondary">
          Bahan pelaporan SPT Masa PPh 21 (per bulan) dan bukti potong 1721-A1 (per pegawai). Hanya penggajian yang sudah diposting.
        </Typography.Paragraph>
      )}
      {!isLoading && !!data?.employees.length && (
        <SummaryCards
          items={[
            { label: `Total PPh 21 tahun ${year}`, value: fmtMoney(data.monthly.reduce((a, m) => a + Number(m.pph21), 0)), hint: 'yang dipotong dari gaji' },
            { label: 'Total gaji kotor', value: fmtMoney(data.monthly.reduce((a, m) => a + Number(m.gross), 0)), hint: `${data.monthly.length} bulan` },
            { label: 'Jumlah pegawai', value: String(data.employees.length), hint: 'yang dipotong PPh 21' },
          ]}
        />
      )}
      <Row gutter={[16, 16]} className="print-area">
        <Col xs={24} lg={10}>
          <Card title="Per masa pajak">
            <Table
              rowKey="period"
              size="small"
              loading={isLoading}
              dataSource={data?.monthly}
              pagination={false}
              columns={[
                { title: 'Masa', dataIndex: 'period', render: (p) => dayjs(`${p}-01`).format('MMM YYYY') },
                { title: 'Pegawai', dataIndex: 'n', align: 'right' },
                { title: 'Bruto', dataIndex: 'gross', align: 'right', render: fmtMoney },
                { title: 'PPh 21', dataIndex: 'pph21', align: 'right', render: fmtMoney },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Per pegawai (1721-A1)">
            <Table
              rowKey="employee_id"
              size="small"
              loading={isLoading}
              dataSource={data?.employees}
              pagination={false}
              scroll={{ x: 700 }}
              columns={[
                { title: 'Pegawai', render: (_, e) => `${e.code} · ${e.name}` },
                { title: 'PTKP', dataIndex: 'ptkp' },
                { title: 'Bulan', dataIndex: 'months', align: 'right' },
                { title: 'Bruto', dataIndex: 'gross', align: 'right', render: fmtMoney },
                { title: 'JHT+JP', dataIndex: 'pension', align: 'right', render: fmtMoney },
                { title: 'PPh 21', dataIndex: 'pph21', align: 'right', render: fmtMoney },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

export default function Pph21ReportPage() {
  return <Pph21Recap />;
}
