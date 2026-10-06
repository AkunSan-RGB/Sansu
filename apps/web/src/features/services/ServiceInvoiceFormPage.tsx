/**
 * Faktur jasa: tagihan pekerjaan / termin proyek tanpa stok barang.
 * PPh 23 / PPh 4(2) yang dipotong pelanggan dihitung otomatis dari DPP.
 */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { CUSTOMER_WITHHOLDING_PRESETS, type Project } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction, useCustomers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, today } from '@/lib/format';
import { outputVatRate, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';

interface Line {
  description?: string;
  qty?: number;
  unit?: string;
  price?: number;
  accountId?: string;
}
interface FormValues {
  customerId: string;
  projectId?: string;
  termLabel?: string;
  date: string;
  dueDate?: string;
  description?: string;
  withVat: boolean;
  pricesIncludeVat: boolean;
  preset?: string;
  lines: Line[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ServiceInvoiceFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { me } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects') });
  const [termPct, setTermPct] = useState<number | null>(null);

  const customerId = Form.useWatch('customerId', form);
  const projectId = Form.useWatch('projectId', form);
  const preset = Form.useWatch('preset', form);
  const withVat = Form.useWatch('withVat', form) ?? true;
  const inclusive = Form.useWatch('pricesIncludeVat', form) ?? false;
  const lines: Line[] = Form.useWatch('lines', form) ?? [];

  const revenueAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === 'REVENUE' && a.isPostable && a.isActive),
    [accounts],
  );
  const accountByCode = (code: string) => revenueAccounts.find((a) => a.code === code)?.id;
  const presetInfo = CUSTOMER_WITHHOLDING_PRESETS.find((p) => p.key === preset);
  const project = projects.data?.find((p) => p.id === projectId);
  const customerProjects = (projects.data ?? []).filter((p) => p.customerId === customerId && p.status === 'ACTIVE');

  // dari halaman proyek: ?projectId=
  useEffect(() => {
    const pid = params.get('projectId');
    const p = projects.data?.find((x) => x.id === pid);
    if (p && !form.getFieldValue('projectId')) form.setFieldsValue({ customerId: p.customerId, projectId: p.id });
  }, [params, projects.data, form]);

  // ganti jenis PPh → akun pendapatan baris yang masih bawaan ikut berganti
  useEffect(() => {
    const acc = accountByCode(presetInfo?.account ?? '4-2000');
    if (!acc) return;
    const cur = (form.getFieldValue('lines') as Line[]) ?? [];
    const defaults = new Set(['4-2000', '4-2100', '4-2200'].map(accountByCode));
    form.setFieldValue(
      'lines',
      cur.map((l) => (!l.accountId || defaults.has(l.accountId) ? { ...l, accountId: acc } : l)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, revenueAccounts.length]);

  const rate = withVat ? outputVatRate(me) : 0;
  const sum = lines.reduce((a, l) => a + round2((l.qty ?? 0) * (l.price ?? 0)), 0);
  const { subtotal, tax, total } = vatTotals(sum, rate, inclusive && rate > 0);
  const whRate = presetInfo?.rate ?? 0;
  const withholding = round2((subtotal * whRate) / 100);

  const fillTerm = () => {
    if (!project || !termPct) return;
    const amount = round2((Number(project.contractValue) * termPct) / 100);
    const label = form.getFieldValue('termLabel') || `Termin ${termPct}%`;
    form.setFieldsValue({
      termLabel: label,
      pricesIncludeVat: false,
      lines: [
        {
          description: `${label} — ${termPct}% nilai kontrak ${project.name}`,
          qty: 1,
          unit: 'Paket',
          price: amount,
          accountId: accountByCode(presetInfo?.account ?? '4-2000'),
        },
      ],
    });
  };

  const create = useAction(
    (v: FormValues) =>
      post<{ id: string; number: string; journalNumber: string }>('/services/invoices', {
        customerId: v.customerId,
        projectId: v.projectId,
        termLabel: v.termLabel,
        date: v.date,
        dueDate: v.dueDate || undefined,
        description: v.description,
        withVat: v.withVat,
        pricesIncludeVat: v.pricesIncludeVat,
        withholdingType: presetInfo?.type,
        withholdingRate: presetInfo ? String(presetInfo.rate) : undefined,
        lines: v.lines.map((l) => ({
          description: l.description,
          qty: String(l.qty ?? 1),
          unit: l.unit,
          price: String(l.price),
          accountId: l.accountId,
        })),
      }),
    {
      success: (r) => `Faktur jasa ${r.number} dibuat · jurnal ${r.journalNumber}`,
      invalidate: ['invoices', 'projects', 'customers', ...LEDGER_KEYS],
      onSuccess: (r) => navigate(`/invoices/${r.id}`),
    },
  );

  return (
    <>
      <PageHeader title={t('Faktur jasa baru')} />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          date: today(),
          withVat: true,
          pricesIncludeVat: !!me?.taxProfile?.salesPricesIncludeVat,
          lines: [{ qty: 1, unit: 'Paket' }],
        }}
        onFinish={(v) => create.mutate(v)}
      >
        <Card>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="customerId" label={t('Pelanggan')} rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  onChange={() => form.setFieldValue('projectId', undefined)}
                  options={customers
                    ?.filter((c) => c.isActive)
                    .map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="projectId" label="Proyek / kontrak" extra="Opsional — untuk tagihan per termin">
                <Select
                  allowClear
                  disabled={!customerId}
                  placeholder={customerId && !customerProjects.length ? 'Belum ada proyek aktif' : undefined}
                  options={customerProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="dueDate" label="Jatuh tempo" extra={t('Kosong = termin pelanggan')}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          {project && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Nilai kontrak ${fmtMoney(project.contractValue)} · sudah ditagih ${fmtMoney(project.billed)} (${project.billedPct}%) · sisa ${fmtMoney(Number(project.contractValue) - Number(project.billed))}`}
              description={
                <Space wrap>
                  <span>Tagih termin:</span>
                  <InputNumber
                    min={0.01}
                    max={100}
                    value={termPct}
                    onChange={setTermPct}
                    suffix="%"
                    style={{ width: 110 }}
                  />
                  <span>dari nilai kontrak</span>
                  <Button size="small" onClick={fillTerm} disabled={!termPct}>
                    Isi baris
                  </Button>
                </Space>
              }
            />
          )}

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="termLabel" label="Termin / tahap">
                <Input placeholder="Mis. Termin 1 (30%)" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item
                name="preset"
                label={t('PPh yang dipotong pelanggan')}
                extra={t('Pelanggan badan / instansi biasanya memotong PPh atas pembayaran jasa')}
              >
                <Select
                  allowClear
                  placeholder={t('Tidak dipotong (pelanggan perorangan)')}
                  options={CUSTOMER_WITHHOLDING_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Row key={f.key} gutter={8} align="top">
                    <Col xs={24} md={8}>
                      <Form.Item
                        name={[f.name, 'description']}
                        rules={[{ required: true, message: 'Isi uraian pekerjaan' }]}
                      >
                        <Input placeholder="Uraian pekerjaan / jasa" />
                      </Form.Item>
                    </Col>
                    <Col xs={8} md={2}>
                      <Form.Item name={[f.name, 'qty']} rules={[{ required: true }]}>
                        <InputNumber min={0.0001} placeholder="Qty" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={8} md={2}>
                      <Form.Item name={[f.name, 'unit']}>
                        <Input placeholder="Satuan" />
                      </Form.Item>
                    </Col>
                    <Col xs={8} md={4}>
                      <Form.Item name={[f.name, 'price']} rules={[{ required: true, message: 'Isi harga' }]}>
                        <InputNumber min={1} placeholder="Harga" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={20} md={7}>
                      <Form.Item name={[f.name, 'accountId']}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Akun pendapatan"
                          options={revenueAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={4} md={1}>
                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        disabled={fields.length === 1}
                        onClick={() => remove(f.name)}
                      />
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({ qty: 1, unit: 'Paket', accountId: accountByCode(presetInfo?.account ?? '4-2000') })
                  }
                >
                  Tambah baris
                </Button>
              </>
            )}
          </Form.List>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Form.Item name="description" label="Keterangan">
                <Input.TextArea
                  rows={3}
                  placeholder="Mis. sesuai SPK No. 12/2026 dan berita acara kemajuan pekerjaan"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              {outputVatRate(me) > 0 && (
                <Space direction="vertical" size={0} style={{ marginBottom: 8 }}>
                  <Form.Item name="withVat" valuePropName="checked" noStyle>
                    <Checkbox>Dikenai PPN {outputVatRate(me)}%</Checkbox>
                  </Form.Item>
                  <Form.Item name="pricesIncludeVat" valuePropName="checked" noStyle>
                    <Checkbox disabled={!withVat}>Harga yang diketik sudah termasuk PPN</Checkbox>
                  </Form.Item>
                </Space>
              )}
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="DPP">{fmtMoney(subtotal)}</Descriptions.Item>
                <Descriptions.Item label={rate ? `PPN ${rate}%` : 'PPN'}>{fmtMoney(tax)}</Descriptions.Item>
                <Descriptions.Item label={t('Total faktur')}>
                  <strong>{fmtMoney(total)}</strong>
                </Descriptions.Item>
                {presetInfo && (
                  <>
                    <Descriptions.Item
                      label={`Dipotong PPh ${presetInfo.type === 'PPH23' ? '23' : '4(2)'} ${presetInfo.rate}%`}
                    >
                      ({fmtMoney(withholding)})
                    </Descriptions.Item>
                    <Descriptions.Item label="Akan diterima">
                      <strong>{fmtMoney(total - withholding)}</strong>
                    </Descriptions.Item>
                  </>
                )}
              </Descriptions>
            </Col>
          </Row>

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => navigate('/invoices')}>Batal</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              Posting faktur
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
