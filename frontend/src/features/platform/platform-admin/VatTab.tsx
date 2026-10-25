import { BRAND, type VatReportRow } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, DatePicker, Row, Space, Statistic, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import { fmtDate, fmtMoney } from '@/lib/format';
import ExportButtons from '@/components/ExportButtons';
import { subscriptionVatSheet } from '@/lib/xlsx/reports';
import { KEYS, PSettings } from './shared';

// ---------------- Laporan PPN ----------------
export function VatTab() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const q = useQuery({
    queryKey: [...KEYS, 'vat', month],
    queryFn: () => get<VatReportRow[]>(`/platform-admin/vat-report${qs({ month })}`),
  });
  const settings = useQuery({
    queryKey: [...KEYS, 'settings'],
    queryFn: () => get<PSettings>('/platform-admin/settings'),
  });
  const rows = q.data ?? [];
  const sum = (k: 'subtotal' | 'vatAmount' | 'amount') => rows.reduce((a, r) => a + Number(r[k]), 0);
  return (
    <Card
      title="Rekap PPN keluaran langganan"
      extra={
        <Space wrap>
          <DatePicker
            picker="month"
            value={dayjs(`${month}-01`)}
            onChange={(v) => v && setMonth(v.format('YYYY-MM'))}
            allowClear={false}
            format="MMMM YYYY"
          />
          <ExportButtons
            filename={`ppn-langganan-${month}`}
            title={`PPN langganan ${month}`}
            sheets={() => (q.data ? subscriptionVatSheet(q.data, month, settings.data?.sellerName) : null)}
          />
        </Space>
      }
    >
      {settings.data && !settings.data.vatEnabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="PPN belum diaktifkan di tab Pengaturan — tagihan baru belum dikenai PPN."
        />
      )}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Statistic title="DPP" value={fmtMoney(sum('subtotal'))} />
        </Col>
        <Col xs={8}>
          <Statistic
            title="PPN keluaran"
            value={fmtMoney(sum('vatAmount'))}
            valueStyle={{ color: BRAND.colors.primary }}
          />
        </Col>
        <Col xs={8}>
          <Statistic title="Total diterima" value={fmtMoney(sum('amount'))} />
        </Col>
      </Row>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Lunas', dataIndex: 'paidAt', render: fmtDate },
          { title: 'Pembeli', dataIndex: 'buyer' },
          {
            title: 'NPWP',
            dataIndex: 'buyerNpwp',
            render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
          },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          {
            title: 'PPN',
            dataIndex: 'vatAmount',
            align: 'right',
            render: (v, r) => (r.vatRate ? `${fmtMoney(v)} (${Number(r.vatRate)}%)` : '—'),
          },
          { title: 'Total', dataIndex: 'amount', align: 'right', render: fmtMoney },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        Gunakan rekap ini untuk membuat faktur pajak keluaran di Coretax DJP. Pembeli tanpa NPWP memakai NIK / kode
        pembeli umum sesuai ketentuan.
      </Typography.Paragraph>
    </Card>
  );
}
