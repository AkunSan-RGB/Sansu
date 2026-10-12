import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Statistic, Tag, Tooltip } from 'antd';
import { get } from '@/api/client';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';

export const VARIANCE_REASONS: Record<string, string> = {
  MARKET_VOLATILITY: 'Harga pasar bergejolak',
  SUPPLIER_INCREASE: 'Supplier menaikkan harga',
  SPEC_CHANGE: 'Perubahan spesifikasi / kemasan',
  DISCOUNT_ADJUST: 'Diskon / potongan berubah',
  OTHER: 'Lainnya',
};

const FLAGS: Record<string, { label: string; color: string; hint: string }> = {
  ABOVE_MARKET: { label: 'Di atas harga pasar', color: 'red', hint: 'Harga faktur melebihi rata-rata harga beli 90 hari terakhir melampaui batas pembanding' },
  RATE_ABOVE_MARKET: { label: 'Kurs di atas pasar', color: 'red', hint: 'Kurs faktur yang diketik melebihi kurs pasar tersimpan melampaui toleransi' },
  FX_RATE: { label: 'Selisih kurs', color: 'blue', hint: 'Harga dalam mata uang PO sama; selisih Rupiah hanya karena kurs faktur berbeda dari kurs PO' },
  SAME_USER: { label: 'Pembuat PO = pembuat faktur', color: 'orange', hint: 'Orang yang sama membuat PO dan mencatat fakturnya yang lebih mahal — tidak ada pemisahan tugas' },
  NO_APPROVAL: { label: 'Tanpa persetujuan', color: 'default', hint: 'Kenaikan harga dicatat tanpa persetujuan (di bawah toleransi, atau dicatat oleh pemilik/admin)' },
};

interface Row_ {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  supplierInvoiceNo: string;
  supplier: string;
  sku: string;
  product: string;
  poNumber: string | null;
  poPrice: number | null;
  invoicePrice: number;
  qty: number;
  variance: number;
  pct: number | null;
  reason: string | null;
  note: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  flags: string[];
}
interface Group {
  name: string;
  count: number;
  total: number;
  increase: number;
  flagged: number;
}
interface Report {
  rows: Row_[];
  bySupplier: Group[];
  byUser: Group[];
  totals: { count: number; net: number; increase: number; flagged: number };
}

/** Laporan selisih harga faktur vs PO dengan penanda untuk ditinjau — alat kendali anti-fraud pembelian */
export default function PriceVarianceReport() {
  const q = useQuery({ queryKey: ['purchase-invoices', 'price-variances'], queryFn: () => get<Report>('/purchase-invoices/reports/price-variances') });
  const r = q.data;
  const groupCols = (label: string) => [
    { title: label, dataIndex: 'name' },
    { title: 'Faktur', dataIndex: 'count', align: 'right' as const },
    { title: 'Total kenaikan', dataIndex: 'increase', align: 'right' as const, render: fmtMoney },
    { title: 'Bersih', dataIndex: 'total', align: 'right' as const, render: (v: number) => fmtMoney(v) },
    { title: 'Ditandai', dataIndex: 'flagged', align: 'right' as const, render: (v: number) => (v ? <Tag color="red">{v}</Tag> : 0) },
  ];
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Setiap faktur yang harganya berbeda dari PO tercatat di sini beserta alasan, pembuat, dan penyetujunya. Penanda merah/oranye perlu ditinjau pemilik. Batas toleransi diatur di Pengaturan › Perusahaan › Persetujuan transaksi besar."
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Faktur ber-selisih" value={r?.totals.count ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Total kenaikan harga" value={fmtMoney(r?.totals.increase ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Selisih bersih" value={fmtMoney(r?.totals.net ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Perlu ditinjau" value={r?.totals.flagged ?? 0} valueStyle={{ color: r?.totals.flagged ? '#cf1322' : undefined }} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Per supplier">
            <ResponsiveTable rowKey="name" size="small" pagination={false} dataSource={r?.bySupplier} columns={groupCols('Supplier')} scroll={{ x: 460 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Per pencatat faktur">
            <ResponsiveTable rowKey="name" size="small" pagination={false} dataSource={r?.byUser} columns={groupCols('Pencatat')} scroll={{ x: 460 }} />
          </Card>
        </Col>
      </Row>
      <ResponsiveTable
        rowKey={(x: Row_) => `${x.invoiceId}-${x.sku}`}
        loading={q.isLoading}
        dataSource={r?.rows}
        scroll={{ x: 1150 }}
        columns={[
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 100 },
          { title: 'Faktur', render: (_, x: Row_) => `${x.invoiceNumber} (${x.supplierInvoiceNo})` },
          { title: 'Supplier', dataIndex: 'supplier' },
          { title: 'Barang', render: (_, x: Row_) => `${x.sku} · ${x.product}` },
          { title: 'Harga PO', align: 'right', render: (_, x: Row_) => (x.poPrice != null ? fmtMoney(x.poPrice) : '-') },
          { title: 'Harga faktur', align: 'right', render: (_, x: Row_) => fmtMoney(x.invoicePrice) },
          {
            title: 'Selisih',
            align: 'right',
            render: (_, x: Row_) => (
              <span style={{ color: x.variance > 0 ? '#d46b08' : '#389e0d' }}>
                {x.variance > 0 ? '+' : '−'}
                {fmtMoney(Math.abs(x.variance))}
                {x.pct != null && ` (${x.pct > 0 ? '+' : ''}${x.pct}%)`}
              </span>
            ),
          },
          {
            title: 'Alasan',
            render: (_, x: Row_) => (
              <Tooltip title={x.note}>
                <span>{x.reason ? (VARIANCE_REASONS[x.reason] ?? x.reason) : '-'}</span>
              </Tooltip>
            ),
          },
          { title: 'Dicatat oleh', dataIndex: 'createdBy', render: (v) => v ?? '-' },
          { title: 'Disetujui', dataIndex: 'approvedBy', render: (v) => v ?? '-' },
          {
            title: 'Penanda',
            render: (_, x: Row_) =>
              x.flags.map((f) => (
                <Tooltip key={f} title={FLAGS[f]?.hint}>
                  <Tag color={FLAGS[f]?.color}>{FLAGS[f]?.label ?? f}</Tag>
                </Tooltip>
              )),
          },
        ]}
      />
    </>
  );
}
