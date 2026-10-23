import { useQuery } from '@tanstack/react-query';
import { canBookkeep, LEGAL_FORM_LABELS, REPORTING_FRAMEWORK_SHORT, TAX_SCHEME_LABELS, toOptions } from '@sansu/shared';
import {
  AuditOutlined,
  BankOutlined,
  BgColorsOutlined,
  ClusterOutlined,
  BellOutlined,
  FileProtectOutlined,
  PercentageOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { BUSINESS_MODEL_BY_KEY } from '@sansu/shared';
import { Alert, Button, Card, Col, Divider, Form, Grid, Input, InputNumber, Radio, Row, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CompanySettings, PayrollSettings, ReportingSettings } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import BrandingCard from './BrandingCard';
import BranchFeatureCard from './BranchFeatureCard';
import RecipeTermCard from './RecipeTermCard';
import BusinessModelCard from './BusinessModelCard';
import AccountingPolicyTab from './AccountingPolicyTab';
import ApprovalPolicyTab from './ApprovalPolicyTab';
import PayrollSettingsTab from './PayrollSettingsTab';
import ReminderSettingsCard from './ReminderSettingsCard';
import SupportThresholdsCard from './SupportThresholdsCard';
import DataPrivacyCard from './DataPrivacyCard';
import EntityProfileWizard from './EntityProfileWizard';
import { t } from '@/lib/terms';

/** Kelompok isian dengan judul dan penjelasan singkat, agar form panjang mudah dipindai */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Typography.Title level={5} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {desc && (
        <Typography.Paragraph type="secondary" style={{ margin: '2px 0 16px' }}>
          {desc}
        </Typography.Paragraph>
      )}
      {!desc && <div style={{ height: 12 }} />}
      {children}
    </div>
  );
}

/** Batang simpan menempel di bawah layar saat form panjang */
function SaveBar({ loading, label = 'Simpan perubahan' }: { loading: boolean; label?: string }) {
  return (
    <div className="save-bar">
      <Button type="primary" htmlType="submit" size="large" loading={loading}>
        {label}
      </Button>
    </div>
  );
}

export default function CompanySettingsPage() {
  const { can } = useApps();
  const { me } = useAuth();
  const screens = Grid.useBreakpoint();
  const { data } = useQuery({ queryKey: ['company'], queryFn: () => get<CompanySettings>('/settings/company') });
  const [company] = Form.useForm();
  const [tax] = Form.useForm();
  const [payroll] = Form.useForm<PayrollSettings>();
  const [reporting] = Form.useForm<ReportingSettings>();
  const [policy] = Form.useForm<ReportingSettings>();
  const scheme = Form.useWatch('taxScheme', reporting);
  const pkp = Form.useWatch('pkp', tax) ?? true;
  const localTax = Form.useWatch('localTaxEnabled', tax) ?? false;
  // Wizard bisa dibuka dari panduan mulai lewat ?wizard=1
  const [params, setParams] = useSearchParams();
  const [wizard, setWizard] = useState(params.get('wizard') === '1');
  const [tab, setTab] = useState(params.get('wizard') === '1' ? 'pelaporan' : (params.get('tab') ?? 'profil'));
  const pickTab = (k: string) => {
    setTab(k);
    params.set('tab', k);
    setParams(params, { replace: true });
  };
  const closeWizard = () => {
    setWizard(false);
    if (params.has('wizard')) {
      params.delete('wizard');
      setParams(params, { replace: true });
    }
  };
  useEffect(() => {
    if (data) {
      company.setFieldsValue(data);
      tax.setFieldsValue({ ...data, ppnRate: Number(data.ppnRate), ...data.taxProfile });
      payroll.setFieldsValue(data.payroll);
      if (data.reporting) {
        reporting.setFieldsValue(data.reporting);
        policy.setFieldsValue(data.reporting);
      }
    }
  }, [data, company, tax, payroll, reporting, policy]);
  const saveReporting = useAction((v: ReportingSettings) => patch('/settings/reporting', v), {
    success: 'Pengaturan pelaporan disimpan',
    invalidate: ['company', 'framework', 'statements', 'notes', 'fiscal', 'tax-thresholds', 'entity-profile'],
  });

  const saveCompany = useAction(
    (v: { name?: string; npwp?: string; address?: string; ppnRate?: number; pkp?: boolean; posPricesIncludeVat?: boolean; salesPricesIncludeVat?: boolean; holidays?: string[]; vatRounding?: string; localTaxEnabled?: boolean; localTaxRate?: number | string }) => patch('/settings/company', { ...v, ...(v.ppnRate !== undefined && { ppnRate: String(v.ppnRate) }), ...(v.localTaxRate !== undefined && v.localTaxRate !== null && { localTaxRate: String(v.localTaxRate) }) }),
    { success: 'Data perusahaan disimpan', invalidate: ['company', 'me', 'tax-thresholds'] },
  );
  const savePayroll = useAction((v: PayrollSettings) => patch('/settings/payroll', v), { success: 'Pengaturan penggajian disimpan', invalidate: ['company'] });

  const radioVat = [
    { value: true, label: 'Sudah termasuk PPN' },
    { value: false, label: 'Belum termasuk PPN' },
  ];
  const model = me?.businessModel ? BUSINESS_MODEL_BY_KEY[me.businessModel] : undefined;
  const wide = { maxWidth: 860 };

  const tabs = [
    {
      key: 'profil',
      label: 'Profil perusahaan',
      icon: <BankOutlined />,
      children: (
        <Card style={wide}>
          <Form form={company} layout="vertical" onFinish={(v) => saveCompany.mutate(v)} requiredMark={false}>
            <Section title="Identitas perusahaan" desc="Tampil di penawaran, faktur, slip gaji, dan rekap pajak.">
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="name" label="Nama perusahaan" rules={[{ required: true, message: 'Nama perusahaan wajib diisi' }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="npwp" label="NPWP">
                    <Input placeholder="00.000.000.0-000.000" />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item name="address" label="Alamat">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </Col>
              </Row>
            </Section>
            <SaveBar loading={saveCompany.isPending} />
          </Form>
        </Card>
      ),
    },
    {
      key: 'pajak',
      label: 'Pajak',
      icon: <PercentageOutlined />,
      children: (
        <Card style={wide}>
          <Form form={tax} layout="vertical" onFinish={(v) => saveCompany.mutate(v)} requiredMark={false}>
            <Section title="Pajak Pertambahan Nilai (PPN)" desc="Menentukan cara faktur, kasir, dan pembelian menghitung PPN.">
              <Form.Item
                name="pkp"
                label="Status Pengusaha Kena Pajak (PKP)"
                valuePropName="checked"
                extra={
                  pkp
                    ? 'Penjualan dipungut PPN keluaran; PPN dari supplier dikreditkan (PPN Masukan).'
                    : 'Belum PKP (omzet ≤ Rp4,8 miliar/tahun dan belum dikukuhkan): penjualan tanpa PPN; PPN dari supplier masuk ke harga pokok barang / biaya.'
                }
              >
                <Switch checkedChildren="PKP" unCheckedChildren="Non-PKP" />
              </Form.Item>
              {pkp && (
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Form.Item name="ppnRate" label="Tarif PPN" extra="Berlaku untuk dokumen baru">
                      <InputNumber min={0} max={100} suffix="%" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16}>
                    <Form.Item
                      name="vatRounding"
                      label="Pembulatan PPN"
                      extra={t('Faktur pajak memuat PPN dalam rupiah penuh. Berlaku untuk dokumen dengan harga belum termasuk PPN; harga yang sudah termasuk PPN tetap sama dengan harga yang dibayar. Tanyakan konsultan pajak bila ragu.')}
                    >
                      <Select
                        options={[
                          { value: 'NONE', label: 'Tanpa pembulatan (dua desimal)' },
                          { value: 'NEAREST', label: 'Bulatkan ke rupiah terdekat' },
                          { value: 'DOWN', label: 'Bulatkan ke bawah' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {pkp && (can('sales') || can('crm')) && (
                <Form.Item
                  name="salesPricesIncludeVat"
                  label={t('Harga di penawaran & pesanan penjualan')}
                  extra="Bawaan pilihan 'harga termasuk PPN' saat membuat dokumen baru. Faktur tetap menampilkan DPP dan PPN."
                >
                  <Radio.Group options={radioVat} />
                </Form.Item>
              )}
              {can('pos') && (
                <>
                  <Form.Item
                    name="localTaxEnabled"
                    label="Pajak restoran daerah (PB1/PBJT)"
                    valuePropName="checked"
                    extra="Untuk kafe dan restoran: penjualan kasir dikenai pajak daerah atas makanan dan minuman, bukan PPN. Dicatat di Utang Pajak Restoran dan disetor ke pemerintah daerah. Tarif dan tenggat mengikuti peraturan daerah Anda (maksimal 10%); usaha dengan omzet kecil bisa dikecualikan daerahnya."
                  >
                    <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
                  </Form.Item>
                  {localTax && (
                    <Form.Item name="localTaxRate" label="Tarif pajak daerah" extra="0–10 persen sesuai peraturan daerah. Berlaku untuk penjualan kasir berikutnya.">
                      <InputNumber min={0} max={10} step={0.5} suffix="%" style={{ width: 160 }} />
                    </Form.Item>
                  )}
                </>
              )}
              {(pkp || localTax) && can('pos') && (
                <Form.Item name="posPricesIncludeVat" label="Harga di kasir" extra={localTax ? 'Termasuk pajak: harga menu = harga bayar; struk menampilkan pajak yang terkandung. Belum termasuk: pajak ditambahkan di atas harga menu.' : 'Termasuk PPN: harga rak = harga bayar; struk menampilkan DPP dan PPN yang terkandung.'}>
                  <Radio.Group options={localTax ? [{ value: true, label: 'Sudah termasuk pajak' }, { value: false, label: 'Belum termasuk pajak' }] : radioVat} />
                </Form.Item>
              )}
              {!!me?.taxFeatures?.reasons.length && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="Menu pajak disesuaikan dengan usaha Anda"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {me.taxFeatures.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </Section>
            {can('accounting') && (
              <>
                <Divider />
                <Section title="Kalender pajak" desc="Tenggat setor/lapor yang jatuh di akhir pekan atau hari libur digeser ke hari kerja berikutnya.">
                  <Form.Item
                    name="holidays"
                    label="Hari libur nasional & cuti bersama"
                    extra="Ketik tanggal berformat 2026-12-25 lalu Enter. Perbarui tiap tahun sesuai SKB tiga menteri."
                    rules={[{ validator: (_, v: string[] | undefined) => ((v ?? []).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? Promise.resolve() : Promise.reject(new Error('Format tanggal YYYY-MM-DD'))) }]}
                  >
                    <Select mode="tags" tokenSeparators={[',', ' ']} open={false} placeholder="2026-12-25" />
                  </Form.Item>
                </Section>
              </>
            )}
            <SaveBar loading={saveCompany.isPending} />
          </Form>
        </Card>
      ),
    },
    {
      key: 'model',
      label: 'Jenis usaha',
      icon: <ClusterOutlined />,
      children: (
        <div style={wide}>
          <BusinessModelCard />
          <BranchFeatureCard />
          <RecipeTermCard />
        </div>
      ),
    },
    ...(can('accounting')
      ? [
          {
            key: 'kebijakan',
            label: 'Kebijakan akuntansi',
            icon: <SolutionOutlined />,
            children: (
              <AccountingPolicyTab
                policy={policy}
                saved={data?.reporting}
                canEdit={canBookkeep(me?.role)}
                saving={saveReporting.isPending}
                onSave={(v) => saveReporting.mutate(v)}
                showCash={can('cash')}
              />
            ),
          },
        ]
      : []),
    ...(can('accounting')
      ? [
          {
            key: 'pelaporan',
            label: 'Pelaporan & PPh',
            icon: <AuditOutlined />,
            children: (
              <Card style={wide}>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 20 }}
                  message="Bingung memilih SAK EMKM atau SAK EP, atau skema PPh?"
                  description="Wizard menghitung ukuran usaha dari pembukuan lalu menyarankan pilihan yang sesuai."
                  action={
                    <Button type="primary" onClick={() => setWizard(true)}>
                      Buka wizard
                    </Button>
                  }
                />
                <Form form={reporting} layout="vertical" onFinish={(v) => saveReporting.mutate(v)} requiredMark={false}>
                  <Section title="Profil badan usaha" desc="Dipakai di CALK bagian Umum dan tanda tangan laporan.">
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="legalForm" label="Bentuk badan usaha">
                          <Select options={toOptions(LEGAL_FORM_LABELS)} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="establishedYear" label="Tahun berdiri">
                          <InputNumber min={1900} max={2100} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24}>
                        <Form.Item name="businessActivity" label="Kegiatan usaha utama">
                          <Input placeholder="Distribusi dan perdagangan besar barang konsumsi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="city" label="Kota">
                          <Input placeholder="Bekasi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="directorName" label="Penandatangan">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="directorTitle" label="Jabatan">
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Section>
                  <Divider />
                  <Section title="Pajak penghasilan" desc="Skema PPh badan yang dipakai di rekonsiliasi fiskal dan peringatan batas pajak.">
                    <Form.Item name="taxScheme">
                      <Radio.Group optionType="button" buttonStyle="solid" options={toOptions(TAX_SCHEME_LABELS)} />
                    </Form.Item>
                    {scheme === 'FINAL_UMKM' && (
                      <Form.Item name="taxRegisteredYear" label="Tahun terdaftar sebagai wajib pajak" extra="Untuk mengecek batas waktu PPh final 0,5%">
                        <InputNumber min={1980} max={2100} style={{ width: 200 }} />
                      </Form.Item>
                    )}
                  </Section>
                  {canBookkeep(me?.role) && <SaveBar loading={saveReporting.isPending} />}
                </Form>
                <Divider />
                <SupportThresholdsCard canEdit={canBookkeep(me?.role)} />
              </Card>
            ),
          },
        ]
      : []),
    {
      key: 'tampilan',
      label: 'Logo & dokumen',
      icon: <BgColorsOutlined />,
      children: (
        <div style={wide}>
          <BrandingCard />
        </div>
      ),
    },
    {
      key: 'pengingat',
      label: 'Pengingat',
      icon: <BellOutlined />,
      children: (
        <div style={wide}>
          <ReminderSettingsCard />
        </div>
      ),
    },
    {
      key: 'persetujuan',
      label: 'Persetujuan',
      icon: <FileProtectOutlined />,
      children: (
        <ApprovalPolicyTab />
      ),
    },
    ...(me?.role === 'OWNER' || me?.role === 'ADMIN'
      ? [
          {
            key: 'data',
            label: 'Data & privasi',
            icon: <SafetyCertificateOutlined />,
            children: (
              <div style={wide}>
                <DataPrivacyCard companyName={data?.name ?? me?.tenantName ?? ''} />
              </div>
            ),
          },
        ]
      : []),
    ...(can('payroll')
      ? [
          {
            key: 'gaji',
            label: 'Penggajian & BPJS',
            icon: <TeamOutlined />,
            children: (
              <PayrollSettingsTab form={payroll} saving={savePayroll.isPending} onSave={(v) => savePayroll.mutate(v)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title="Pengaturan perusahaan" />
      <EntityProfileWizard open={wizard} onClose={closeWizard} />
      <div className="settings-summary">
        <div>
          <div className="settings-summary-name">{data?.name ?? me?.tenantName}</div>
          <Space size={6} wrap style={{ marginTop: 6 }}>
            {model && <Tag color="blue">{model.name}</Tag>}
            {data?.reporting && <Tag color="gold">{REPORTING_FRAMEWORK_SHORT[data.reporting.framework]}</Tag>}
            <Tag color={pkp ? 'green' : 'default'}>{pkp ? 'PKP' : 'Non-PKP'}</Tag>
          </Space>
        </div>
      </div>
      <Tabs
        className="settings-tabs"
        tabPosition={screens.lg ? 'left' : 'top'}
        activeKey={tab}
        onChange={pickTab}
        items={tabs.map((t) => (['pajak', 'pelaporan', 'gaji'].includes(t.key) ? { ...t, forceRender: true } : t))}
        destroyInactiveTabPane={false}
      />
    </>
  );
}
