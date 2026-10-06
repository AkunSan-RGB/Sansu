import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { WITHHOLDING_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Col, Descriptions, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Typography } from 'antd';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import type { AssetCategory, CompanySettings, Project, PurchaseInvoice } from '@/api/types';
import { useApps } from '@/lib/apps';
import { fmtMoney, today } from '@/lib/format';

type LineV = { type: 'EXPENSE' | 'ASSET'; description?: string; accountId?: string; assetCategoryId?: string; qty?: number; price?: number; withholding?: boolean };

/** Tagihan supplier untuk biaya (jasa, sewa, servis, listrik…) atau pembelian aset tetap — tanpa PO */
export default function BillModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ id: string; code: string; name: string }[]>('/suppliers'), enabled: open });
  const cats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<AssetCategory[]>('/assets/categories'), enabled: open });
  const company = useQuery({ queryKey: ['company'], queryFn: () => get<CompanySettings>('/settings/company'), enabled: open });
  const ppn = Number(company.data?.ppnRate ?? 11);
  const nonPkp = company.data?.taxProfile?.pkp === false;
  const { can } = useApps();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: open && can('sales') });
  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'ACTIVE');

  const lines: LineV[] = Form.useWatch('lines', form) ?? [];
  const withVat: boolean = Form.useWatch('withVat', form) ?? true;
  const whType: string | undefined = Form.useWatch('withholdingType', form);
  const whRate: number = Form.useWatch('withholdingRate', form) ?? 0;
  const lineTotal = (l: LineV) => (l?.qty ?? 1) * (l?.price ?? 0);
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const tax = withVat ? Math.round((subtotal * ppn) / 100) : 0;
  const whBase = lines.filter((l) => l && (l.withholding ?? l.type === 'EXPENSE')).reduce((a, l) => a + lineTotal(l), 0);
  const wh = whType ? Math.round((whBase * whRate) / 100) : 0;

  // Batas kapitalisasi: sama dengan aturan di server (per unit, setelah PPN non-PKP, tanah dikecualikan)
  const threshold = company.data?.reporting?.capitalizationThreshold ?? 0;
  const belowThreshold = (l: LineV) => {
    if (l?.type !== 'ASSET' || threshold <= 0 || !l.price) return false;
    const cat = cats.data?.find((c) => c.id === l.assetCategoryId);
    if (!cat || cat.method === 'NONE' || cat.fiscalGroup === 'LAND') return false;
    const qty = l.qty ?? 1;
    const units = Number.isInteger(qty) && qty <= 50 ? qty : 1;
    const cost = lineTotal(l) * (nonPkp && withVat ? 1 + ppn / 100 : 1);
    return cost / units < threshold;
  };

  const expenseOptions = accounts.data
    ?.filter((a) => a.isPostable && a.isActive !== false && !a.isCashAccount && ['EXPENSE', 'ASSET'].includes(a.type) && a.systemKey !== 'INVENTORY')
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));

  const save = useAction(
    (v: Record<string, unknown> & { lines: LineV[] }) =>
      post<PurchaseInvoice & { journalNumber: string; expensedLines?: number }>('/purchase-invoices/bills', {
        ...v,
        withholdingRate: v.withholdingType ? String(v.withholdingRate ?? 0) : undefined,
        lines: v.lines.map((l) => ({ ...l, qty: String(l.qty ?? 1), price: String(l.price ?? 0), withholding: l.withholding ?? l.type === 'EXPENSE' })),
      }),
    {
      success: (r) =>
        `Tagihan ${r.number} diposting · jurnal ${r.journalNumber}` +
        (r.expensedLines ? ` · ${r.expensedLines} baris di bawah batas kapitalisasi dibebankan` : ''),
      invalidate: ['purchase-invoices', 'suppliers', 'assets', ...LEDGER_KEYS],
      onSuccess: onClose,
    },
  );

  return (
    <Modal
      title="Tagihan biaya / aset dari supplier"
      open={open}
      width={980}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Posting"
      confirmLoading={save.isPending}
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue({ date: today(), withVat: true, lines: [{ type: 'EXPENSE', qty: 1 }] })}
    >
      <Typography.Paragraph type="secondary">
        Untuk tagihan jasa, sewa, servis, utilitas, atau pembelian aset (kendaraan, mesin, komputer). Baris aset otomatis masuk daftar Aset Tetap dan mulai disusutkan; utangnya
        tercatat ke supplier dan dibayar dari menu ini seperti faktur biasa.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="supplierId" label="Supplier" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={suppliers.data?.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
            </Form.Item>
          </Col>
          <Col xs={12} md={5}>
            <Form.Item name="supplierInvoiceNo" label="No. faktur supplier" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={5}>
            <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="dueDate" label="Jatuh tempo" extra="Kosong = termin supplier">
              <Input type="date" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="description" label="Keterangan">
          <Input placeholder="Servis AC gudang & pembelian laptop admin" />
        </Form.Item>
        {activeProjects.length > 0 && (
          <Form.Item
            name="projectId"
            label="Biaya langsung proyek (opsional)"
            extra="Biaya proyek yang pendapatannya kena PPh final (konstruksi/sewa) otomatis dikoreksi di Rekonsiliasi fiskal"
          >
            <Select allowClear options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
          </Form.Item>
        )}
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => {
                const t = lines[f.name]?.type ?? 'EXPENSE';
                return (
                  <Space key={f.key} align="baseline" wrap style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'type']} initialValue="EXPENSE">
                      <Radio.Group
                        size="small"
                        optionType="button"
                        options={[
                          { value: 'EXPENSE', label: 'Biaya' },
                          { value: 'ASSET', label: 'Aset tetap' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'description']} rules={[{ required: true, message: 'Isi uraian' }]}>
                      <Input placeholder="Uraian" style={{ width: 220 }} />
                    </Form.Item>
                    {t === 'ASSET' ? (
                      <Form.Item name={[f.name, 'assetCategoryId']} rules={[{ required: true, message: 'Pilih kategori' }]}>
                        <Select placeholder="Kategori aset" style={{ width: 200 }} options={cats.data?.map((c) => ({ value: c.id, label: c.name }))} />
                      </Form.Item>
                    ) : (
                      <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]}>
                        <Select showSearch optionFilterProp="label" placeholder="Akun beban" style={{ width: 200 }} options={expenseOptions} />
                      </Form.Item>
                    )}
                    <Form.Item name={[f.name, 'qty']} initialValue={1}>
                      <InputNumber min={1} placeholder="Qty" style={{ width: 70 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'price']} rules={[{ required: true, message: 'Isi harga' }]}>
                      <InputNumber min={1} placeholder="Harga (sebelum PPN)" style={{ width: 160 }} />
                    </Form.Item>
                    {whType && (
                      <Form.Item name={[f.name, 'withholding']} valuePropName="checked" initialValue={t === 'EXPENSE'}>
                        <Checkbox>Dipotong PPh</Checkbox>
                      </Form.Item>
                    )}
                    {belowThreshold(lines[f.name]) && (
                      <Typography.Text type="warning">Di bawah batas kapitalisasi {fmtMoney(threshold)} → dibebankan, bukan aset</Typography.Text>
                    )}
                    {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                  </Space>
                );
              })}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ type: 'EXPENSE', qty: 1 })}>
                Tambah baris
              </Button>
            </>
          )}
        </Form.List>
        <Row gutter={12} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Form.Item name="withVat" valuePropName="checked">
              <Checkbox>Faktur dikenai PPN {ppn}% (supplier PKP)</Checkbox>
            </Form.Item>
            {nonPkp && withVat && (
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Perusahaan belum PKP: PPN tidak bisa dikreditkan, jadi otomatis ditambahkan ke biaya / harga perolehan aset.
              </Typography.Text>
            )}
            <Space wrap>
              <Form.Item name="withholdingType" label="PPh yang Anda potong">
                <Select
                  allowClear
                  placeholder="Tidak ada"
                  style={{ width: 220 }}
                  options={Object.entries(WITHHOLDING_LABELS).map(([value, label]) => ({ value, label }))}
                  onChange={(v) => form.setFieldValue('withholdingRate', v === 'PPH4_2' ? 10 : v ? 2 : undefined)}
                />
              </Form.Item>
              {whType && (
                <Form.Item name="withholdingRate" label="Tarif">
                  <InputNumber min={0} max={30} step={0.5} suffix="%" style={{ width: 110 }} />
                </Form.Item>
              )}
            </Space>
            {whType && <Alert type="info" showIcon message="PPh yang dipotong menjadi utang pajak Anda — setor lewat menu Setoran Pajak dan beri bukti potong ke supplier." />}
          </Col>
          <Col xs={24} md={12}>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(subtotal)}</Descriptions.Item>
              <Descriptions.Item label={`PPN ${withVat ? `${ppn}%` : ''}`}>{fmtMoney(tax)}</Descriptions.Item>
              {whType && <Descriptions.Item label="PPh dipotong">({fmtMoney(wh)})</Descriptions.Item>}
              <Descriptions.Item label="Dibayar ke supplier">
                <strong>{fmtMoney(subtotal + tax - wh)}</strong>
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
