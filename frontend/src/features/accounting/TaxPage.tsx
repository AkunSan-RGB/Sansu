import { DeleteOutlined } from '@ant-design/icons';
import { TAX_PAYMENT_LABELS, type TaxPaymentType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { TaxObligation, TaxPayment } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { taxPaymentsSheet } from '@/lib/xlsx/reports';
import { useAuth } from '@/auth/AuthContext';

const STATUS: Record<TaxObligation['status'], { color: string; label: string }> = {
  NIHIL: { color: 'default', label: 'Nihil' },
  BELUM: { color: 'orange', label: 'Belum disetor' },
  LUNAS: { color: 'green', label: 'Sudah disetor' },
  TERLAMBAT: { color: 'red', label: 'Lewat jatuh tempo' },
  LEBIH_BAYAR: { color: 'blue', label: 'Lebih bayar' },
  OPSIONAL: { color: 'default', label: 'Tidak ada angsuran' },
};
const DETAIL_LABEL: Record<string, string> = {
  ppnKeluaran: 'PPN keluaran belum dikompensasi',
  ppnMasukan: 'PPN masukan tersedia',
  peredaranBruto: 'Peredaran bruto bulan ini',
  angsuranTahunLalu: 'Angsuran dari SPT tahun lalu',
};

const periodOptions = () =>
  Array.from({ length: 18 }, (_, i) => dayjs().subtract(i, 'month').format('YYYY-MM')).map((p) => ({
    value: p,
    label: dayjs(`${p}-01`).toDate().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
  }));

export default function TaxPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(params.get('period') ?? '') ? params.get('period')! : dayjs().subtract(1, 'month').format('YYYY-MM'));
  const [year, setYear] = useState(dayjs().year());
  const [paying, setPaying] = useState<TaxObligation | null>(null);
  const [form] = Form.useForm();
  const obligations = useQuery({ queryKey: ['tax', 'obligations', period], queryFn: () => get<TaxObligation[]>(`/tax/obligations?period=${period}`) });
  const payments = useQuery({ queryKey: ['tax', 'payments', year], queryFn: () => get<TaxPayment[]>(`/tax/payments?year=${year}`) });

  const pay = useAction(
    (v: { date: string; amount?: number; cashAccountId?: string; billingCode?: string; ntpn?: string; notes?: string }) =>
      post<{ number: string; journalNumber: string; amount: string }>('/tax/payments', {
        ...v,
        type: paying!.type,
        period: paying!.period,
        amount: v.amount != null && paying!.type !== 'PPN' ? String(v.amount) : undefined,
      }),
    {
      success: (r) => (Number(r.amount) > 0 ? `Setoran ${r.number} dicatat · jurnal ${r.journalNumber}` : `Kompensasi PPN dicatat · jurnal ${r.journalNumber}`),
      invalidate: ['tax', ...LEDGER_KEYS],
      onSuccess: () => setPaying(null),
    },
  );
  const remove = useAction((id: string) => api(`/tax/payments/${id}`, { method: 'DELETE' }), { success: 'Setoran dibatalkan, jurnal dibalik', invalidate: ['tax', ...LEDGER_KEYS] });

  const rows = obligations.data ?? [];
  const totalDue = rows.filter((o) => Number(o.outstanding) > 0).reduce((a, o) => a + Number(o.outstanding), 0);
  const late = rows.filter((o) => o.status === 'TERLAMBAT').length;
  const yearTotal = (payments.data ?? []).reduce((a, p) => a + Number(p.amount), 0);

  return (
    <>
      <PageHeader
        title="Setoran Pajak & BPJS"
        extra={<Select value={period} onChange={setPeriod} options={periodOptions()} style={{ width: 200 }} prefix="Masa" />}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="Perlu disetor untuk masa ini" value={totalDue} formatter={(v) => fmtMoney(Number(v))} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title="Lewat jatuh tempo" value={late} valueStyle={{ color: late ? '#cf1322' : undefined }} suffix="jenis" />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={`Total disetor ${year}`} value={yearTotal} formatter={(v) => fmtMoney(Number(v))} />
          </Card>
        </Col>
      </Row>
      <Card title="Kewajiban masa ini" style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary">
          Dihitung otomatis dari buku besar: PPN dari faktur jual & beli, PPh 21 & BPJS dari penggajian, PPh 23 / 4(2) dari tagihan supplier yang Anda potong, PPh 25 dari
          Rekonsiliasi Fiskal tahun lalu. Catat setoran setelah membayar kode billing — jurnalnya dibuat otomatis.
        </Typography.Paragraph>
        <Table
          rowKey="type"
          loading={obligations.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: 'Jenis',
              render: (_, o) => (
                <>
                  <strong>{TAX_PAYMENT_LABELS[o.type]}</strong>
                  {o.period !== period && <Typography.Text type="secondary"> · tahun {o.period.slice(0, 4)}</Typography.Text>}
                  {o.note && (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {o.note}
                      </Typography.Text>
                    </div>
                  )}
                </>
              ),
            },
            {
              title: 'Rincian',
              render: (_, o) =>
                o.detail &&
                Object.entries(o.detail).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 12 }}>
                    {DETAIL_LABEL[k] ?? k}: {fmtMoney(v)}
                  </div>
                )),
            },
            { title: 'Jatuh tempo', dataIndex: 'dueDate', render: fmtDate, width: 120 },
            { title: 'Terutang', dataIndex: 'outstanding', align: 'right', render: (v) => <strong>{fmtMoney(Math.max(0, Number(v)))}</strong> },
            { title: 'Sudah disetor', dataIndex: 'paid', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'status', render: (s: TaxObligation['status']) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag> },
            {
              render: (_, o) => {
                const canPay = Number(o.outstanding) > 0 || (o.type === 'PPN' && Number(o.detail?.ppnKeluaran ?? 0) > 0) || o.type === 'PPH25';
                // PPN lebih bayar tanpa PPN keluaran tidak punya yang dikompensasi: masukan dibawa otomatis ke masa berikutnya
                const nothingToDo = o.type === 'PPN' && Number(o.outstanding) <= 0 && Number(o.detail?.ppnKeluaran ?? 0) <= 0;
                return (
                  canPay &&
                  !nothingToDo && (
                    <Button
                      size="small"
                      type={Number(o.outstanding) > 0 ? 'primary' : 'default'}
                      onClick={() => {
                        form.resetFields();
                        form.setFieldsValue({ date: today(), amount: Number(o.outstanding) > 0 ? Number(o.outstanding) : undefined });
                        setPaying(o);
                      }}
                    >
                      {o.type === 'PPN' && Number(o.outstanding) <= 0 ? 'Kompensasi' : 'Catat setoran'}
                    </Button>
                  )
                );
              },
            },
          ]}
        />
      </Card>
      <Card
        title="Riwayat setoran"
        extra={
          <Space>
            <InputNumber value={year} min={2000} max={2100} onChange={(v) => v && setYear(v)} style={{ width: 100 }} />
            <ExportButtons
              filename={`setoran-pajak-${year}`}
              title={`Setoran pajak ${year}`}
              sheets={() => (payments.data ? taxPaymentsSheet(payments.data, year, me?.tenantName) : null)}
            />
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={payments.isLoading}
          dataSource={payments.data}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Jenis', dataIndex: 'type', render: (t: TaxPaymentType) => TAX_PAYMENT_LABELS[t] },
            { title: 'Masa', dataIndex: 'period' },
            {
              title: 'Jumlah',
              dataIndex: 'amount',
              align: 'right',
              render: (v, p) => (p.type === 'PPN' && Number(v) === 0 ? <Tag color="blue">Kompensasi {fmtMoney(p.vatOut)}</Tag> : fmtMoney(v)),
            },
            { title: 'Kode billing', dataIndex: 'billingCode', render: (v) => v ?? '-' },
            { title: 'NTPN', dataIndex: 'ntpn', render: (v) => v ?? <Typography.Text type="warning">belum diisi</Typography.Text> },
            { title: 'Dari', render: (_, p) => p.cashAccount?.name ?? '-' },
            {
              render: (_, p) => (
                <Popconfirm title="Batalkan setoran ini? Jurnalnya akan dibalik." onConfirm={() => remove.mutate(p.id)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={paying ? `${TAX_PAYMENT_LABELS[paying.type]} masa ${paying.period}` : ''}
        open={!!paying}
        onCancel={() => setPaying(null)}
        onOk={() => form.submit()}
        confirmLoading={pay.isPending}
        okText="Simpan & jurnal"
      >
        {paying?.type === 'PPN' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              Number(paying.outstanding) > 0
                ? `PPN keluaran ${fmtMoney(paying.detail?.ppnKeluaran)} dikompensasi dengan masukan ${fmtMoney(paying.detail?.ppnMasukan)}; kurang bayar ${fmtMoney(paying.outstanding)} disetor.`
                : `Masukan lebih besar: keluaran ${fmtMoney(paying.detail?.ppnKeluaran)} dinolkan, sisa masukan dibawa ke masa berikutnya. Tidak ada uang keluar.`
            }
          />
        )}
        <Form form={form} layout="vertical" onFinish={(v) => pay.mutate(v)}>
          <Form.Item name="date" label="Tanggal setor" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          {paying?.type !== 'PPN' && (
            <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          )}
          {!(paying?.type === 'PPN' && Number(paying.outstanding) <= 0) && (
            <>
              <Form.Item name="cashAccountId" label="Dibayar dari" extra="Kosong = rekening bank utama">
                <CashAccountSelect allowClear />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="billingCode" label="Kode billing">
                    <Input maxLength={30} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="ntpn" label="NTPN" extra="Dari bukti penerimaan negara">
                    <Input maxLength={30} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
          <Form.Item name="notes" label="Catatan">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
