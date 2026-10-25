import { PrinterOutlined } from '@ant-design/icons';
import { BRAND, type WithholdingRecap, type WithholdingRow } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Empty, Modal, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import WithholdingSlip from '@/components/print/WithholdingSlip';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { withholdingSheets } from '@/lib/xlsx/reports';
import { t } from '@/lib/terms';

export function Withholding() {
  const { me } = useAuth();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(dayjs().subtract(1, 'month'));
  const period = mode === 'month' ? month.format('YYYY-MM') : month.format('YYYY');
  const [slips, setSlips] = useState<WithholdingRow[] | null>(null);
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
        <Button icon={<PrinterOutlined />} disabled={!q.data?.rows.length} onClick={() => setSlips(q.data!.rows)}>
          Cetak semua bukti potong
        </Button>
      </Space>
      <Modal
        open={!!slips}
        onCancel={() => setSlips(null)}
        width={900}
        title={`Bukti pemotongan (${slips?.length ?? 0})`}
        destroyOnHidden
        footer={[
          <Button key="x" onClick={() => setSlips(null)}>
            Tutup
          </Button>,
          <Button key="p" type="primary" icon={<PrinterOutlined />} onClick={() => printDoc(`Bukti pemotongan ${period}`)}>
            Cetak / simpan PDF
          </Button>,
        ]}
      >
        {slips?.map((r) => (
          <div key={r.id} style={{ marginBottom: 24 }}>
            <WithholdingSlip row={r} />
          </div>
        ))}
      </Modal>
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
                        description={t('Biasanya karena jurnal manual langsung ke akun utang PPh. Pastikan setiap potongan tercatat lewat tagihan supplier agar bukti potongnya lengkap.')}
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
                message={t('Supplier tanpa NPWP/NIK')}
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
                    title: t('Faktur'),
                    dataIndex: 'number',
                    render: (n, r) => (
                      <>
                        {n}
                        <div style={{ fontSize: 11, color: '#64748b' }}>{r.supplierInvoiceNo}</div>
                      </>
                    ),
                  },
                  { title: t('Supplier'), dataIndex: 'supplierName' },
                  {
                    title: 'NPWP / NIK',
                    dataIndex: 'supplierNpwp',
                    render: (v) => v || <Tag color="red">belum ada</Tag>,
                  },
                  { title: 'Uraian', dataIndex: 'description', ellipsis: true },
                  { title: 'DPP', dataIndex: 'base', align: 'right', render: fmtMoney },
                  { title: 'Tarif', dataIndex: 'rate', align: 'right', render: (v) => (v ? `${Number(v)}%` : '-') },
                  { title: 'PPh', dataIndex: 'amount', align: 'right', render: fmtMoney },
                  {
                    title: '',
                    width: 90,
                    render: (_, r) => (
                      <Button size="small" icon={<PrinterOutlined />} onClick={() => setSlips([r])}>
                        Cetak
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          </>
        )}
      </QueryState>
    </Space>
  );
}
