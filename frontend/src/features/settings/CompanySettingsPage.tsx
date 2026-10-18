import { useQuery } from '@tanstack/react-query';
import { canBookkeep, LEGAL_FORM_LABELS, REPORTING_FRAMEWORK_LABELS, REPORTING_FRAMEWORK_SHORT, TAX_SCHEME_LABELS, toOptions } from '@sansu/shared';
import {
  AuditOutlined,
  BankOutlined,
  BgColorsOutlined,
  ClusterOutlined,
  BellOutlined,
  FileProtectOutlined,
  PercentageOutlined,
  SolutionOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { BUSINESS_MODEL_BY_KEY } from '@sansu/shared';
import { Alert, Button, Card, Col, Divider, Form, Grid, Input, InputNumber, Radio, Row, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, put } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CompanySettings, PayrollSettings, ReportingSettings } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import { rupiahInput } from '@/lib/format';
import BrandingCard from './BrandingCard';
import BranchFeatureCard from './BranchFeatureCard';
import RecipeTermCard from './RecipeTermCard';
import BusinessModelCard from './BusinessModelCard';
import InventoryMethodCard from './InventoryMethodCard';
import PettyCashPolicyCard from './PettyCashPolicyCard';
import ReminderSettingsCard from './ReminderSettingsCard';
import EntityProfileWizard from './EntityProfileWizard';
import { t } from '@/lib/terms';

/** SOP kas & bank: bukti wajib, blokir saldo negatif, batas simpanan kas tunai */
function CashControlCard() {
  type Cfg = { evidenceFrom: number; blockNegative: boolean; maxCashBalance: number };
  const [form] = Form.useForm<Cfg>();
  const cfg = useQuery({ queryKey: ['cash', 'settings'], queryFn: () => get<Cfg>('/cash/settings') });
  useEffect(() => {
    if (cfg.data) form.setFieldsValue(cfg.data);
  }, [cfg.data, form]);
  const save = useAction((v: Cfg) => put('/cash/settings', v), { success: 'Pengaturan kontrol kas disimpan', invalidate: ['cash'] });
  return (
    <Card title="Kontrol kas & bank (SOP)" style={{ marginTop: 16 }}>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} initialValues={{ evidenceFrom: 0, blockNegative: false, maxCashBalance: 0 }}>
        <Form.Item name="evidenceFrom" label="Nomor bukti wajib untuk uang keluar mulai dari" extra="Kas keluar/transfer di atas nilai ini harus diisi nomor referensi (kuitansi, nota, bukti transfer). 0 = tidak wajib.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={100_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="blockNegative" label="Tolak uang keluar yang membuat saldo negatif" valuePropName="checked" extra="Mencegah kas keluar melebihi saldo akun kas/bank.">
          <Switch />
        </Form.Item>
        <Form.Item name="maxCashBalance" label="Peringatan bila saldo kas melebihi" extra="Batas simpanan tunai yang aman di kantor. Di atas batas, muncul peringatan agar disetor ke bank. 0 = nonaktif.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={1_000_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Simpan
        </Button>
      </Form>
    </Card>
  );
}

/** Batas nilai yang memerlukan persetujuan pemilik / admin (0 = nonaktif) */
function ApprovalPolicyCard() {
  type Policy = { purchaseOrder: number; manualJournal: number; assetDisposal: number; cashOut: number; stockAdjustment: number; purchaseRequestAuto: number; priceControl: boolean; priceTolerancePct: number; priceBenchmarkPct: number; firstSupplierPayment: boolean; blindReceiving: boolean; blindDelivery: boolean; salesOrder: number; salesDiscountMaxPct: number; salesReturn: number; bankChangeHoldDays: number; budgetControl: 'OFF' | 'APPROVAL' | 'BLOCK'; telegramLinkHours: number };
  const [form] = Form.useForm<Policy>();
  const policy = useQuery({ queryKey: ['approvals', 'policy'], queryFn: () => get<Policy>('/approvals/policy') });
  useEffect(() => {
    if (policy.data) form.setFieldsValue(policy.data);
  }, [policy.data, form]);
  const save = useAction((v: Policy) => put('/approvals/policy', v), { success: 'Batas persetujuan disimpan', invalidate: ['approvals'] });
  return (
    <Card title="Persetujuan transaksi besar">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Transaksi bernilai di atas batas dari peran selain pemilik dan admin menunggu persetujuan. Isi 0 untuk mematikan."
      />
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} initialValues={{ purchaseOrder: 0, manualJournal: 0, purchaseRequestAuto: 0, priceControl: true, priceTolerancePct: 5, priceBenchmarkPct: 10, firstSupplierPayment: false, budgetControl: 'OFF', telegramLinkHours: 72 }}>
        <Form.Item name="purchaseOrder" label="Pesanan pembelian dengan total mulai dari" extra="Konfirmasi pesanan oleh keuangan menunggu persetujuan.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item
          name="purchaseRequestAuto"
          label="Permintaan pembelian disetujui otomatis sampai"
          extra="Permintaan dari gudang/divisi dengan perkiraan nilai sampai batas ini langsung disetujui tanpa menunggu (harga harus diketahui). Isi 0 bila semua permintaan harus diputuskan."
        >
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Typography.Title level={5} style={{ marginTop: 8 }}>
          Pengendalian harga faktur supplier (anti-fraud)
        </Typography.Title>
        <Form.Item name="priceControl" valuePropName="checked" extra="Selisih harga faktur terhadap PO wajib beralasan dan tercatat. Kenaikan di atas toleransi atau jauh di atas harga pasar harus disetujui pemilik/admin sebelum faktur dicatat.">
          <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
        </Form.Item>
        <Form.Item name="priceTolerancePct" label="Toleransi kenaikan harga faktur vs PO (%)" extra="Per baris barang. Di atas ini perlu persetujuan.">
          <InputNumber min={0} max={1000} step={1} style={{ width: '100%' }} suffix="%" />
        </Form.Item>
        <Form.Item name="priceBenchmarkPct" label="Toleransi di atas rata-rata harga beli 90 hari (%)" extra="Harga faktur yang melebihi rata-rata harga beli 90 hari terakhir sebesar ini juga perlu persetujuan, walau PO-nya sudah mahal.">
          <InputNumber min={0} max={1000} step={1} style={{ width: '100%' }} suffix="%" />
        </Form.Item>
        <Form.Item name="firstSupplierPayment" label="Pembayaran pertama ke supplier wajib disetujui" valuePropName="checked" extra="Anti pemasok fiktif: staf (selain pemilik dan admin) yang membayar supplier untuk pertama kali menunggu persetujuan. Pembayaran berikutnya ke supplier yang sama berjalan biasa.">
          <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
        </Form.Item>
        <Form.Item name="blindReceiving" label="Penerimaan buta (Gudang menghitung sendiri)" valuePropName="checked" extra="Gudang tidak melihat jumlah yang dipesan dan wajib mengisi hasil hitungannya. Selisih terhadap pesanan langsung dikabarkan ke Pembelian, Admin, dan Pemilik.">
          <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
        </Form.Item>
        <Form.Item name="salesOrder" label="Pesanan penjualan dengan total mulai dari" extra="Konfirmasi pesanan oleh staf (Sales/Keuangan) menunggu persetujuan Pemilik/Admin. 0 = tanpa persetujuan.">
          <InputNumber min={0} step={1_000_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="salesDiscountMaxPct" label="Diskon per baris di atas (%) butuh persetujuan" extra="Pesanan dengan diskon di atas persen ini, saat dikonfirmasi staf, menunggu persetujuan Pemilik/Admin. 0 = tanpa batas.">
          <InputNumber min={0} max={100} step={1} precision={0} style={{ width: '100%' }} suffix="%" />
        </Form.Item>
        <Form.Item name="salesReturn" label="Retur penjualan bernilai mulai dari" extra="Retur (kredit nota) oleh staf menunggu persetujuan Pemilik/Admin sebelum piutang dikurangi. 0 = tanpa persetujuan.">
          <InputNumber min={0} step={1_000_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="blindDelivery" label="Pengiriman buta (Gudang mengisi jumlah kemas sendiri)" valuePropName="checked" extra="Gudang tidak melihat jumlah pesanan dan wajib mengisi jumlah yang dikemas. Bila tidak sama dengan pesanan, pengiriman ditahan dan Penjualan, Admin, dan Pemilik diberi tahu.">
          <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
        </Form.Item>
        <Form.Item name="bankChangeHoldDays" label="Tahan pembayaran setelah rekening supplier diubah (hari)" extra="Pembayaran oleh staf ke supplier yang rekeningnya baru diubah menunggu persetujuan Pemilik/Admin. 0 = tidak ditahan.">
          <InputNumber min={0} max={60} step={1} precision={0} style={{ width: '100%' }} suffix="hari" />
        </Form.Item>
        <Form.Item name="telegramLinkHours" label="Masa berlaku tautan persetujuan lewat Telegram (jam)" extra="1–72 jam. Lebih pendek = lebih aman bila chat terbaca orang lain, tetapi pemberi persetujuan harus memutuskan lebih cepat. Tautan lewat email tetap 72 jam.">
          <InputNumber min={1} max={72} step={1} precision={0} style={{ width: '100%' }} suffix="jam" />
        </Form.Item>
        <Form.Item name="manualJournal" label="Jurnal manual dengan total debit mulai dari" extra="Jurnal baru diposting setelah disetujui.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="cashOut" label="Kas keluar / transfer dengan nilai mulai dari" extra="Uang keluar oleh staf (selain pemilik dan admin) di atas batas, termasuk pembayaran ke supplier, menunggu persetujuan lalu diposting setelah disetujui. 0 = tidak perlu persetujuan.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="stockAdjustment" label="Penyesuaian stok bernilai mulai dari" extra="Penyesuaian stok (masuk + keluar) oleh Gudang di atas batas menunggu persetujuan; stok berubah setelah disetujui. 0 = tidak perlu persetujuan.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="assetDisposal" label="Pelepasan aset tetap dengan harga perolehan mulai dari" extra="Penjualan/penghapusan aset oleh staf (selain pemilik dan admin) menunggu persetujuan. 0 = tidak perlu persetujuan.">
          <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Simpan
        </Button>
      </Form>
    </Card>
  );
}


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
  const framework = Form.useWatch('framework', policy);
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
              <Space direction="vertical" size={16} style={{ ...wide, width: '100%' }}>
                <Card>
                  <Form form={policy} layout="vertical" onFinish={(v) => saveReporting.mutate({ framework: v.framework, capitalizationThreshold: v.capitalizationThreshold } as ReportingSettings)} requiredMark={false}>
                  <Section title="Standar akuntansi" desc="Mengubah susunan laporan, catatan (CALK), akun yang ditampilkan, dan fitur yang tersedia.">
                    <Form.Item
                      name="framework"
                      extra={
                        framework === 'SAK_EMKM'
                          ? 'SAK EMKM: untuk usaha mikro/kecil — laporan posisi keuangan, laba rugi, dan CALK; aset tetap dengan biaya historis.'
                          : framework === 'IFRS'
                            ? 'IFRS (standar akuntansi umum, di Indonesia berbentuk PSAK berbasis IFRS): untuk entitas akuntabilitas publik, afiliasi grup asing, atau bila bank/investor mensyaratkannya — 5 laporan lengkap dengan judul dwibahasa dan CALK dengan pengungkapan IFRS (risiko keuangan, manajemen modal, sewa, instrumen keuangan). Pengungkapan khusus seperti laba per saham dan segmen operasi belum tercakup.'
                            : 'SAK EP (berlaku sejak 1 Januari 2025): untuk entitas tanpa akuntabilitas publik — 5 laporan lengkap dengan pembanding.'
                      }
                    >
                      <Radio.Group optionType="button" buttonStyle="solid" options={toOptions(REPORTING_FRAMEWORK_LABELS)} />
                    </Form.Item>
                  </Section>
                    <Divider />
                  <Section title="Aset tetap">
                    <Form.Item
                      name="capitalizationThreshold"
                      label="Batas kapitalisasi (per unit)"
                      extra="Pembelian di bawah batas ini langsung dibebankan ke 'Beban Peralatan Kecil', tidak didaftarkan sebagai aset. Isi 0 untuk mengapitalisasi semuanya. Tanah selalu dikapitalisasi."
                    >
                      <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%', maxWidth: 320 }} prefix="Rp" />
                    </Form.Item>
                  </Section>
                    {canBookkeep(me?.role) && <SaveBar loading={saveReporting.isPending} />}
                  </Form>
                </Card>
                <InventoryMethodCard />
                {can('cash') && <PettyCashPolicyCard />}
              </Space>
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
        <div style={wide}>
          <ApprovalPolicyCard />
          <CashControlCard />
        </div>
      ),
    },
    ...(can('payroll')
      ? [
          {
            key: 'gaji',
            label: 'Penggajian & BPJS',
            icon: <TeamOutlined />,
            children: (
              <Card style={wide}>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 20 }}
                  message="Nilai bawaan mengikuti ketentuan 2026. Perbarui bila pemerintah mengubah batas upah atau kelompok risiko JKK perusahaan Anda berbeda."
                />
                <Form form={payroll} layout="vertical" onFinish={(v) => savePayroll.mutate(v)} requiredMark={false}>
                  <Section title="Jam kerja">
                    <Form.Item name="workDaysPerWeek" label="Hari kerja">
                      <Radio.Group
                        options={[
                          { value: 6, label: 'Senin–Sabtu (6 hari)' },
                          { value: 5, label: 'Senin–Jumat (5 hari)' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="overtimeDivisor" label="Pembagi upah lembur" extra="Ketentuan: 1/173 upah sebulan" style={{ maxWidth: 240 }}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Section>
                  <Divider />
                  <Section title="BPJS" desc="Batas upah dan tarif iuran perusahaan.">
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="bpjsKesCap" label="Batas upah BPJS Kesehatan">
                          <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="jpCap" label="Batas upah Jaminan Pensiun">
                          <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name="jkkRate" label="Tarif JKK">
                          <InputNumber min={0} max={5} step={0.01} suffix="%" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name="jkmRate" label="Tarif JKM">
                          <InputNumber min={0} max={5} step={0.01} suffix="%" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Section>
                  <SaveBar loading={savePayroll.isPending} />
                </Form>
              </Card>
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
        items={tabs}
        destroyInactiveTabPane={false}
      />
    </>
  );
}
