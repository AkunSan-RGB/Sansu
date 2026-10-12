import { DeleteOutlined } from '@ant-design/icons';
import { currencyName, FOREIGN_CURRENCIES, type ExchangeRate } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { del, get, post, put, qs } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtCurrency, fmtDate, fmtMoney, fmtRate, today } from '@/lib/format';

interface ExposureRow {
  kind: 'AR' | 'AP';
  id: string;
  number: string;
  party: string;
  currency: string;
  date: string;
  outstandingForeign: string;
  carrying: string;
  rate: string | null;
  valueAtRate: string | null;
  unrealized: string | null;
}
interface Exposure {
  asOf: string;
  rows: ExposureRow[];
  byCurrency: { currency: string; rate: string | null; receivable: string; payable: string; net: string; unrealized: string }[];
  unrealized: string;
  missingRates: string[];
}

const gainTag = (v: string | null) => (v == null ? '-' : Number(v) === 0 ? fmtMoney(0) : <span style={{ color: Number(v) > 0 ? '#15803d' : '#b91c1c' }}>{Number(v) > 0 ? '+' : '−'}{fmtMoney(Math.abs(Number(v)))}</span>);

export default function FxPage() {
  const { me } = useAuth();
  const canEdit = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'FINANCE';
  const [form] = Form.useForm();
  const [asOf, setAsOf] = useState(today());
  const rates = useQuery({ queryKey: ['fx-rates'], queryFn: () => get<ExchangeRate[]>('/fx/rates') });
  const exposure = useQuery({ queryKey: ['fx-exposure', asOf], queryFn: () => get<Exposure>(`/fx/exposure${qs({ date: asOf })}`), enabled: canEdit });

  const save = useAction((v: { currency: string; rate: number; date: string; note?: string }) => put<ExchangeRate>('/fx/rates', { ...v, rate: String(v.rate) }), {
    success: 'Kurs disimpan',
    invalidate: ['fx-rates', 'fx-exposure'],
  });
  const remove = useAction((id: string) => del(`/fx/rates/${id}`), { success: 'Kurs dihapus', invalidate: ['fx-rates', 'fx-exposure'] });
  const revalue = useAction(() => post<{ journalNumber: string; reversalNumber: string; net: string }>('/fx/revaluation', { date: asOf }), {
    success: (r) => `Penilaian ulang dicatat (${r.journalNumber}), dibalik otomatis esok hari (${r.reversalNumber})`,
    invalidate: ['fx-exposure', 'journals', ...LEDGER_KEYS],
  });

  return (
    <>
      <PageHeader title="Mata uang asing" />
      <Tabs
        items={[
          {
            key: 'rates',
            label: 'Kurs',
            children: (
              <Card>
                <Typography.Paragraph type="secondary">
                  Kurs harian (Rupiah per 1 satuan valas), mis. kurs JISDOR Bank Indonesia atau kurs pajak (KMK). Dokumen valas memakai kurs terbaru pada atau sebelum tanggal dokumennya; kurs bisa ditimpa di dokumen.
                </Typography.Paragraph>
                {canEdit && (
                  <Form form={form} layout="inline" initialValues={{ date: today(), currency: 'USD' }} onFinish={(v) => save.mutate(v, { onSuccess: () => form.setFieldsValue({ rate: undefined, note: undefined }) })} style={{ marginBottom: 16, rowGap: 8 }}>
                    <Form.Item name="currency" rules={[{ required: true }]}>
                      <Select style={{ width: 200 }} options={FOREIGN_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
                    </Form.Item>
                    <Form.Item name="date" rules={[{ required: true }]}>
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item name="rate" rules={[{ required: true, message: 'Isi kurs' }]}>
                      <InputNumber min={0.000001} placeholder="Kurs" prefix="Rp" style={{ width: 170 }} />
                    </Form.Item>
                    <Form.Item name="note">
                      <Input placeholder="Sumber (mis. JISDOR)" style={{ width: 200 }} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={save.isPending}>
                      Simpan kurs
                    </Button>
                  </Form>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  loading={rates.isLoading}
                  dataSource={rates.data}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                    { title: 'Mata uang', dataIndex: 'currency', render: (c: string) => <Tag>{c}</Tag> },
                    { title: 'Kurs (Rp)', dataIndex: 'rate', align: 'right', render: fmtRate },
                    { title: 'Sumber', dataIndex: 'note' },
                    ...(canEdit
                      ? [{ width: 50, render: (_: unknown, r: ExchangeRate) => <Popconfirm title="Hapus kurs ini?" onConfirm={() => remove.mutate(r.id)}><Button type="text" danger icon={<DeleteOutlined />} /></Popconfirm> }]
                      : []),
                  ]}
                />
              </Card>
            ),
          },
          ...(canEdit
            ? [
                {
                  key: 'exposure',
                  label: 'Posisi valas & penilaian ulang',
                  children: (
                    <Card>
                      <Space wrap style={{ marginBottom: 12 }}>
                        <span>Per tanggal</span>
                        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} style={{ width: 170 }} />
                        <Popconfirm
                          title="Catat penilaian ulang?"
                          description={`Piutang dan utang valas dinilai pada kurs penutup per ${fmtDate(asOf)}; jurnal dibalik otomatis esok harinya.`}
                          onConfirm={() => revalue.mutate(undefined)}
                          disabled={!exposure.data?.rows.length || !!exposure.data?.missingRates.length}
                        >
                          <Button type="primary" loading={revalue.isPending} disabled={!exposure.data?.rows.length || !!exposure.data?.missingRates.length}>
                            Catat penilaian ulang
                          </Button>
                        </Popconfirm>
                      </Space>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="Penilaian ulang akhir periode (PSAK 10 / IAS 21)"
                        description="Saldo piutang dan utang valas dinilai pada kurs penutup. Selisihnya dicatat sebagai laba/rugi kurs belum terealisasi di akun terpisah (Penyesuaian Kurs Piutang/Utang Valas), lalu dibalik otomatis keesokan harinya. Selisih terealisasi dihitung saat pelunasan dari nilai tercatat awal, jadi tidak ada penghitungan ganda."
                      />
                      {!!exposure.data?.missingRates.length && (
                        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Kurs ${exposure.data.missingRates.join(', ')} belum ada pada atau sebelum ${fmtDate(asOf)}. Isi di tab Kurs.`} />
                      )}
                      <Table
                        rowKey="currency"
                        size="small"
                        pagination={false}
                        loading={exposure.isLoading}
                        dataSource={exposure.data?.byCurrency}
                        style={{ marginBottom: 16 }}
                        columns={[
                          { title: 'Mata uang', dataIndex: 'currency', render: (c: string) => `${c} · ${currencyName(c)}` },
                          { title: 'Kurs', dataIndex: 'rate', align: 'right', render: (v: string | null) => (v ? fmtRate(v) : '-') },
                          { title: 'Piutang', dataIndex: 'receivable', align: 'right', render: (v: string, r) => fmtCurrency(v, r.currency) },
                          { title: 'Utang', dataIndex: 'payable', align: 'right', render: (v: string, r) => fmtCurrency(v, r.currency) },
                          { title: 'Posisi bersih', dataIndex: 'net', align: 'right', render: (v: string, r) => fmtCurrency(v, r.currency) },
                          { title: 'Selisih belum terealisasi', dataIndex: 'unrealized', align: 'right', render: gainTag },
                        ]}
                        summary={() =>
                          exposure.data?.byCurrency.length ? (
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={5}>
                                <strong>Total laba (rugi) kurs belum terealisasi</strong>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={1} align="right">
                                <strong>{gainTag(exposure.data.unrealized)}</strong>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          ) : null
                        }
                      />
                      <Table
                        rowKey={(r) => `${r.kind}-${r.id}`}
                        size="small"
                        pagination={{ pageSize: 15 }}
                        loading={exposure.isLoading}
                        dataSource={exposure.data?.rows}
                        scroll={{ x: 900 }}
                        columns={[
                          { title: 'Jenis', dataIndex: 'kind', render: (k: string) => <Tag color={k === 'AR' ? 'blue' : 'orange'}>{k === 'AR' ? 'Piutang' : 'Utang'}</Tag> },
                          { title: 'Faktur', dataIndex: 'number' },
                          { title: 'Pihak', dataIndex: 'party' },
                          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                          { title: 'Sisa (valas)', dataIndex: 'outstandingForeign', align: 'right', render: (v: string, r) => fmtCurrency(v, r.currency) },
                          { title: 'Nilai tercatat', dataIndex: 'carrying', align: 'right', render: fmtMoney },
                          { title: 'Nilai pada kurs penutup', dataIndex: 'valueAtRate', align: 'right', render: (v: string | null) => (v ? fmtMoney(v) : '-') },
                          { title: 'Selisih', dataIndex: 'unrealized', align: 'right', render: gainTag },
                        ]}
                      />
                    </Card>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
