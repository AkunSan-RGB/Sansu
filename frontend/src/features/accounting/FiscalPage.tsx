import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { canBookkeep, FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup, LEGAL_FORM_LABELS, type LegalForm, TAX_SCHEME_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { FiscalItem, FiscalReconciliation } from '@/api/types';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fiscalSheets } from '@/lib/xlsx/reports';
import { fmtMoney } from '@/lib/format';
import { acc } from './statements/format';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/lib/terms';

const SOURCE: Record<FiscalItem['source'], { label: string; color: string }> = {
  ACCOUNT: { label: 'Otomatis dari akun', color: 'blue' },
  DEPRECIATION: { label: 'Penyusutan', color: 'purple' },
  INVENTORY: { label: t('Persediaan (penurunan nilai)'), color: 'orange' },
  FINAL_COST: { label: 'Biaya penghasilan PPh final', color: 'magenta' },
  MANUAL: { label: 'Manual', color: 'default' },
};

function Items({ title, items, total, year, removable }: { title: string; items: FiscalItem[]; total: string; year: number; removable: boolean }) {
  const remove = useAction((id: string) => api(`/accounting/fiscal/${year}/adjustments/${id}`, { method: 'DELETE' }), { success: 'Dihapus', invalidate: ['fiscal'] });
  return (
    <Table
      size="small"
      rowKey={(r) => r.id ?? r.label}
      pagination={false}
      dataSource={items}
      title={() => <strong>{title}</strong>}
      locale={{ emptyText: 'Tidak ada' }}
      columns={[
        { title: 'Uraian', dataIndex: 'label' },
        { title: 'Sumber', dataIndex: 'source', width: 160, render: (s: FiscalItem['source']) => <Tag color={SOURCE[s].color}>{SOURCE[s].label}</Tag> },
        { title: 'Jumlah', dataIndex: 'amount', align: 'right', width: 160, render: acc },
        {
          width: 48,
          render: (_, r) =>
            removable &&
            r.source === 'MANUAL' &&
            r.id && (
              <Popconfirm title="Hapus koreksi ini?" onConfirm={() => remove.mutate(r.id!)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
        },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={2}>
            <strong>Jumlah</strong>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right">
            <strong>{acc(total)}</strong>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={3} />
        </Table.Summary.Row>
      )}
      style={{ marginBottom: 16 }}
    />
  );
}

export default function FiscalPage() {
  const { me } = useAuth();
  const bookkeeper = canBookkeep(me?.role);
  const navigate = useNavigate();
  const [year, setYear] = useState(dayjs().month() < 3 ? dayjs().year() - 1 : dayjs().year());
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm();
  const [yearForm] = Form.useForm();
  const q = useQuery({ queryKey: ['fiscal', year], queryFn: () => get<FiscalReconciliation>(`/accounting/fiscal/${year}`) });
  const d = q.data;
  const add = useAction((v: { description: string; kind: string; amount: number }) => post(`/accounting/fiscal/${year}/adjustments`, { ...v, amount: String(v.amount) }), {
    success: 'Koreksi ditambahkan',
    invalidate: ['fiscal'],
    onSuccess: () => setAdding(false),
  });
  const saveYear = useAction(
    (v: { lossCarryforward?: number; grossRevenueOverride?: number | null; finalCostOverride?: number | null }) =>
      api(`/accounting/fiscal/${year}`, {
        method: 'PUT',
        json: {
          lossCarryforward: String(v.lossCarryforward ?? 0),
          grossRevenueOverride: v.grossRevenueOverride == null ? null : String(v.grossRevenueOverride),
          finalCostOverride: v.finalCostOverride == null ? null : String(v.finalCostOverride),
        },
      }),
    { success: 'Disimpan', invalidate: ['fiscal'] },
  );
  const postTax = useAction(() => post<{ number: string }>(`/accounting/fiscal/${year}/journal`), {
    success: (j) => `Jurnal pajak ${j.number} diposting per 31 Desember ${year}`,
    invalidate: LEDGER_KEYS,
  });

  const general = d?.scheme === 'GENERAL';
  const sheets = () => (d ? fiscalSheets(d, me?.tenantName) : null);

  return (
    <>
      <PageHeader
        title="Rekonsiliasi Fiskal & PPh Badan"
        extra={
          <Space wrap>
            <InputNumber prefix="Tahun pajak" value={year} min={2000} max={2100} onChange={(v) => v && setYear(v)} style={{ width: 180 }} />
            <ExportButtons filename={`rekonsiliasi-fiskal-${year}`} title={`Rekonsiliasi Fiskal ${year}`} sheets={sheets} />
          </Space>
        }
      />
      <QueryState q={q}>{(d) => (
        <div className="print-area">
          <Space wrap style={{ marginBottom: 12 }} className="no-print">
            <Tag color="blue">{TAX_SCHEME_LABELS[d.scheme]}</Tag>
            <Tag>Bentuk usaha: {LEGAL_FORM_LABELS[d.legalForm as LegalForm] ?? d.legalForm}</Tag>
            {bookkeeper && (
              <Button size="small" type="link" onClick={() => navigate('/settings/company?tab=pelaporan')}>
                Ubah skema pajak
              </Button>
            )}
          </Space>
          {d.warnings.map((w, i) => (
            <Alert key={i} type="warning" showIcon message={w} style={{ marginBottom: 8 }} />
          ))}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title={general ? 'Dari laba komersial ke penghasilan kena pajak' : 'Dasar pengenaan PPh final'}>
                <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="Laba sebelum pajak (laporan laba rugi)">{acc(d.profitBeforeTax)}</Descriptions.Item>
                </Descriptions>
                {general && (
                  <>
                    <Items title="Koreksi fiskal positif (menambah laba)" items={d.positive} total={d.totalPositive} year={year} removable={bookkeeper} />
                    <Items title="Koreksi fiskal negatif (mengurangi laba)" items={d.negative} total={d.totalNegative} year={year} removable={bookkeeper} />
                    {bookkeeper && (
                    <Button
                      icon={<PlusOutlined />}
                      className="no-print"
                      style={{ marginBottom: 16 }}
                      onClick={() => {
                        form.resetFields();
                        form.setFieldsValue({ kind: 'POSITIVE' });
                        setAdding(true);
                      }}
                    >
                      Koreksi manual
                    </Button>
                    )}
                  </>
                )}
                <Descriptions size="small" column={1} bordered styles={{ content: { whiteSpace: 'nowrap', textAlign: 'right' } }}>
                  {general && (
                    <>
                      <Descriptions.Item label="Laba (rugi) fiskal">{acc(d.fiscalProfit)}</Descriptions.Item>
                      <Descriptions.Item label="Kompensasi kerugian tahun lalu">{acc(-Number(d.lossCarryforward))}</Descriptions.Item>
                      <Descriptions.Item label="Penghasilan kena pajak (dibulatkan ribuan)">
                        <strong>{acc(d.pkp)}</strong>
                      </Descriptions.Item>
                    </>
                  )}
                  <Descriptions.Item label="Peredaran bruto setahun">
                    {acc(d.grossRevenue)} {d.grossRevenueOverridden && <Tag>manual</Tag>}
                  </Descriptions.Item>
                  {general && Number(d.facilitatedPkp) > 0 && <Descriptions.Item label="PKP yang mendapat fasilitas Pasal 31E">{acc(d.facilitatedPkp)}</Descriptions.Item>}
                  <Descriptions.Item label="Cara hitung">{d.method}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="Pajak terutang" style={{ marginBottom: 16 }}>
                <Descriptions size="small" column={1} bordered styles={{ content: { whiteSpace: 'nowrap', textAlign: 'right' } }}>
                  <Descriptions.Item label={general ? 'PPh Badan terutang' : 'PPh final setahun'}>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {fmtMoney(d.taxDue)}
                    </Typography.Text>
                  </Descriptions.Item>
                  {general && (
                    <>
                      <Descriptions.Item label="Kredit pajak (PPh 22/23/25 dibayar dimuka)">{fmtMoney(d.credits)}</Descriptions.Item>
                      <Descriptions.Item label={Number(d.pph29) >= 0 ? 'PPh Pasal 29 kurang bayar' : 'Lebih bayar'}>
                        <strong>{fmtMoney(Math.abs(Number(d.pph29)))}</strong>
                      </Descriptions.Item>
                      <Descriptions.Item label="Kredit pihak lain (PPh 21/22/23/24 dipotong)">{fmtMoney(d.withheldCredits)}</Descriptions.Item>
                      <Descriptions.Item label="Angsuran PPh 25 tahun depan / bulan">
                        {fmtMoney(d.installment25)}
                        <div style={{ color: '#8c8c8c' }}>(PPh terutang − kredit pihak lain) ÷ 12; PPh 25 yang sudah disetor tidak mengurangi dasar ini.</div>
                      </Descriptions.Item>
                    </>
                  )}
                </Descriptions>
                {general && (
                  <div style={{ marginTop: 16 }} className="no-print">
                    {d.journal ? (
                      <Alert type="success" showIcon message={`Sudah dijurnal: ${d.journal.number}`} description="Untuk menghitung ulang, balik dulu jurnal tersebut di Jurnal Umum." />
                    ) : !bookkeeper ? null : (
                      <Popconfirm title={`Posting beban pajak kini${d.deferred ? ' & tangguhan' : ''} per 31 Desember ${year}?`} onConfirm={() => postTax.mutate(undefined)}>
                        <Button type="primary" block loading={postTax.isPending} disabled={Number(d.taxDue) <= 0 && !d.deferred}>
                          Jurnal beban pajak penghasilan
                        </Button>
                      </Popconfirm>
                    )}
                  </div>
                )}
              </Card>
              {d.deferred && (
                <Card title="Pajak tangguhan (SAK EP)" style={{ marginBottom: 16 }}>
                  <Descriptions size="small" column={1} bordered styles={{ content: { whiteSpace: 'nowrap', textAlign: 'right' } }}>
                    <Descriptions.Item label={t('Beda temporer aset tetap & persediaan (fiskal − komersial)')}>{acc(d.deferred.temporaryDifference)}</Descriptions.Item>
                    <Descriptions.Item label="Aset (liabilitas) pajak tangguhan seharusnya">{acc(d.deferred.target)}</Descriptions.Item>
                    <Descriptions.Item label="Saldo di buku saat ini">{acc(d.deferred.current)}</Descriptions.Item>
                    <Descriptions.Item label="Penyesuaian tahun ini">{acc(d.deferred.adjustment)}</Descriptions.Item>
                  </Descriptions>
                </Card>
              )}
              <Card title="Data tahun pajak" className="no-print">
                <Form
                  form={yearForm}
                  layout="vertical"
                  key={`${year}-${d.lossCarryforward}-${d.grossRevenueOverridden}-${d.finalCost?.override}`}
                  initialValues={{
                    lossCarryforward: Number(d.lossCarryforward),
                    grossRevenueOverride: d.grossRevenueOverridden ? Number(d.grossRevenue) : null,
                    finalCostOverride: d.finalCost?.override != null ? Number(d.finalCost.override) : null,
                  }}
                  onFinish={(v) => saveYear.mutate(v)}
                >
                  {general && (
                    <Form.Item name="lossCarryforward" label="Sisa kerugian fiskal 5 tahun terakhir yang bisa dikompensasi">
                      <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                    </Form.Item>
                  )}
                  <Form.Item name="grossRevenueOverride" label="Peredaran bruto (kosongkan = otomatis dari pendapatan)" extra={`Otomatis: ${fmtMoney(d.grossRevenueAuto)}`}>
                    <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                  </Form.Item>
                  {general && d.finalCost && (
                    <Form.Item
                      name="finalCostOverride"
                      label="Biaya untuk penghasilan PPh final (kosongkan = otomatis)"
                      extra={`Otomatis ${fmtMoney(d.finalCost.auto)}: biaya langsung proyek ber-PPh final ${fmtMoney(d.finalCost.direct)} + biaya bersama ${fmtMoney(d.finalCost.common)} × ${d.finalCost.ratio}% (pendapatan final ${fmtMoney(d.finalCost.finalRevenue)} ÷ pendapatan usaha ${fmtMoney(d.finalCost.totalRevenue)}). Isi manual bila Anda punya pemisahan biaya yang lebih tepat.`}
                    >
                      <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                    </Form.Item>
                  )}
                  {bookkeeper && (
                    <Button htmlType="submit" loading={saveYear.isPending}>
                      Simpan
                    </Button>
                  )}
                </Form>
              </Card>
            </Col>
          </Row>
          {general && d.depreciation.length > 0 && (
            <Card title="Penyusutan komersial vs fiskal per aset" style={{ marginTop: 16 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ x: 1100 }}
                dataSource={d.depreciation}
                columns={[
                  { title: 'Aset', render: (_, r) => `${r.code} · ${r.name}` },
                  { title: 'Kelompok fiskal', dataIndex: 'fiscalGroup', render: (g: FiscalAssetGroup) => FISCAL_ASSET_GROUP_INFO[g]?.label ?? g },
                  { title: 'Harga perolehan', dataIndex: 'cost', align: 'right', render: acc },
                  { title: 'Komersial', dataIndex: 'commercial', align: 'right', render: acc },
                  { title: 'Fiskal', dataIndex: 'fiscal', align: 'right', render: acc },
                  { title: 'Koreksi', dataIndex: 'difference', align: 'right', render: (v) => <strong>{acc(v)}</strong> },
                  { title: 'NB komersial', dataIndex: 'commercialBookValue', align: 'right', render: acc },
                  { title: 'NB fiskal', dataIndex: 'fiscalBookValue', align: 'right', render: acc },
                ]}
              />
            </Card>
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
            Perhitungan ini membantu menyiapkan SPT Tahunan PPh Badan (lampiran rekonsiliasi fiskal). Akun beban yang ditandai "tidak dapat dikurangkan" dan pendapatan yang
            "dikenai PPh final" di Bagan Akun dikoreksi otomatis. Tetap konsultasikan dengan konsultan pajak sebelum pelaporan.
          </Typography.Paragraph>
        </div>
      )}</QueryState>
      <Modal title="Koreksi fiskal manual" open={adding} onCancel={() => setAdding(false)} onOk={() => form.submit()} confirmLoading={add.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => add.mutate(v)}>
          <Form.Item name="kind">
            <Radio.Group
              optionType="button"
              options={[
                { value: 'POSITIVE', label: 'Positif (+)' },
                { value: 'NEGATIVE', label: 'Negatif (−)' },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="Uraian" rules={[{ required: true }]}>
            <Input placeholder="Biaya jamuan tanpa daftar nominatif" />
          </Form.Item>
          <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
