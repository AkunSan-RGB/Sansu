import { useQuery } from '@tanstack/react-query';
import { LEGAL_FORM_LABELS, REPORTING_FRAMEWORK_LABELS, TAX_SCHEME_LABELS, toOptions } from '@sansu/shared';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Radio, Row, Select, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CompanySettings, PayrollSettings, ReportingSettings } from '@/api/types';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import { rupiahInput } from '@/lib/format';
import BrandingCard from './BrandingCard';
import BusinessModelCard from './BusinessModelCard';
import EntityProfileWizard from './EntityProfileWizard';

export default function CompanySettingsPage() {
  const { can } = useApps();
  const { data } = useQuery({ queryKey: ['company'], queryFn: () => get<CompanySettings>('/settings/company') });
  const [company] = Form.useForm();
  const [payroll] = Form.useForm<PayrollSettings>();
  const [reporting] = Form.useForm<ReportingSettings>();
  const framework = Form.useWatch('framework', reporting);
  const scheme = Form.useWatch('taxScheme', reporting);
  const pkp = Form.useWatch('pkp', company) ?? true;
  // Wizard bisa dibuka dari panduan mulai lewat ?wizard=1
  const [params, setParams] = useSearchParams();
  const [wizard, setWizard] = useState(params.get('wizard') === '1');
  const closeWizard = () => {
    setWizard(false);
    if (params.has('wizard')) {
      params.delete('wizard');
      setParams(params, { replace: true });
    }
  };
  useEffect(() => {
    if (data) {
      company.setFieldsValue({ ...data, ppnRate: Number(data.ppnRate), ...data.taxProfile });
      payroll.setFieldsValue(data.payroll);
      if (data.reporting) reporting.setFieldsValue(data.reporting);
    }
  }, [data, company, payroll, reporting]);
  const saveReporting = useAction((v: ReportingSettings) => patch('/settings/reporting', v), {
    success: 'Pengaturan pelaporan disimpan',
    invalidate: ['company', 'framework', 'statements', 'notes', 'fiscal', 'tax-thresholds', 'entity-profile'],
  });

  const saveCompany = useAction(
    (v: { ppnRate: number; pkp?: boolean; posPricesIncludeVat?: boolean; salesPricesIncludeVat?: boolean; holidays?: string[]; vatRounding?: string }) => patch('/settings/company', { ...v, ppnRate: String(v.ppnRate) }),
    { success: 'Data perusahaan disimpan', invalidate: ['company', 'me', 'tax-thresholds'] },
  );
  const savePayroll = useAction((v: PayrollSettings) => patch('/settings/payroll', v), { success: 'Pengaturan penggajian disimpan', invalidate: ['company'] });

  return (
    <>
      <PageHeader title="Perusahaan" />
      <EntityProfileWizard open={wizard} onClose={closeWizard} />
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <BusinessModelCard />
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Identitas & pajak">
            <Form form={company} layout="vertical" onFinish={(v) => saveCompany.mutate(v)}>
              <Form.Item name="name" label="Nama perusahaan" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="npwp" label="NPWP" extra="Tampil di penawaran, slip gaji, dan rekap pajak">
                <Input />
              </Form.Item>
              <Form.Item name="address" label="Alamat">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item
                name="pkp"
                label="Pengusaha Kena Pajak (PKP)"
                valuePropName="checked"
                extra={
                  pkp
                    ? 'Penjualan dipungut PPN keluaran; PPN dari supplier dikreditkan (PPN Masukan).'
                    : 'Belum PKP (omzet ≤ Rp4,8 miliar/tahun dan belum dikukuhkan): penjualan tanpa PPN; PPN dari supplier masuk ke harga pokok barang / biaya.'
                }
              >
                <Switch checkedChildren="PKP" unCheckedChildren="Non-PKP" />
              </Form.Item>
              <Form.Item name="ppnRate" label="Tarif PPN" extra="Berlaku untuk dokumen baru (tarif efektif 11% = 12% × DPP nilai lain 11/12)">
                <InputNumber min={0} max={100} suffix="%" />
              </Form.Item>
              {pkp && (can('sales') || can('crm')) && (
                <Form.Item
                  name="salesPricesIncludeVat"
                  label="Harga di penawaran & pesanan penjualan"
                  extra="Bawaan pilihan 'harga termasuk PPN' saat membuat dokumen baru. Faktur tetap menampilkan DPP dan PPN."
                >
                  <Radio.Group
                    options={[
                      { value: true, label: 'Sudah termasuk PPN' },
                      { value: false, label: 'Belum termasuk PPN' },
                    ]}
                  />
                </Form.Item>
              )}
              {pkp && can('pos') && (
                <Form.Item
                  name="posPricesIncludeVat"
                  label="Harga di kasir"
                  extra="Termasuk PPN: harga rak = harga bayar; struk menampilkan DPP dan PPN yang terkandung."
                >
                  <Radio.Group
                    options={[
                      { value: true, label: 'Sudah termasuk PPN' },
                      { value: false, label: 'Belum termasuk PPN' },
                    ]}
                  />
                </Form.Item>
              )}
              {pkp && (
                <Form.Item
                  name="vatRounding"
                  label="Pembulatan PPN"
                  extra="Faktur pajak memuat PPN dalam rupiah penuh. Berlaku untuk dokumen dengan harga belum termasuk PPN; harga yang sudah termasuk PPN tetap sama dengan harga yang dibayar. Tanyakan konsultan pajak bila ragu."
                >
                  <Select
                    options={[
                      { value: 'NONE', label: 'Tanpa pembulatan (dua desimal)' },
                      { value: 'NEAREST', label: 'Bulatkan ke rupiah terdekat' },
                      { value: 'DOWN', label: 'Bulatkan ke bawah' },
                    ]}
                  />
                </Form.Item>
              )}
              {can('accounting') && (
                <Form.Item
                  name="holidays"
                  label="Hari libur nasional & cuti bersama"
                  extra="Tenggat setor/lapor pajak yang jatuh di Sabtu, Minggu, atau tanggal di sini digeser ke hari kerja berikutnya. Ketik tanggal berformat 2026-12-25 lalu Enter; perbarui tiap tahun sesuai SKB tiga menteri."
                  rules={[{ validator: (_, v: string[] | undefined) => ((v ?? []).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? Promise.resolve() : Promise.reject(new Error('Format tanggal YYYY-MM-DD'))) }]}
                >
                  <Select mode="tags" tokenSeparators={[',', ' ']} open={false} placeholder="2026-12-25" />
                </Form.Item>
              )}
              <Button type="primary" htmlType="submit" loading={saveCompany.isPending}>
                Simpan
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <BrandingCard />
        </Col>
        {can('accounting') && (
          <Col xs={24} lg={12}>
            <Card
              title="Pelaporan keuangan & PPh Badan"
              extra={
                <Button size="small" onClick={() => setWizard(true)}>
                  Wizard rekomendasi
                </Button>
              }
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Bingung memilih SAK EMKM atau SAK EP, atau skema PPh? Wizard menghitung ukuran usaha dari pembukuan lalu menyarankan pilihan yang sesuai."
              />
              <Form form={reporting} layout="vertical" onFinish={(v) => saveReporting.mutate(v)}>
                <Form.Item
                  name="framework"
                  label="Standar akuntansi"
                  extra={
                    framework === 'SAK_EMKM'
                      ? 'SAK EMKM: untuk usaha mikro/kecil — laporan posisi keuangan, laba rugi, dan CALK; aset tetap dengan biaya historis.'
                      : 'SAK EP (berlaku sejak 1 Januari 2025): untuk entitas tanpa akuntabilitas publik — 5 laporan lengkap dengan pembanding.'
                  }
                >
                  <Radio.Group options={toOptions(REPORTING_FRAMEWORK_LABELS)} />
                </Form.Item>
                <Row gutter={12}>
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
                </Row>
                <Form.Item name="businessActivity" label="Kegiatan usaha utama" extra="Dipakai di CALK bagian Umum">
                  <Input placeholder="Distribusi dan perdagangan besar barang konsumsi" />
                </Form.Item>
                <Row gutter={12}>
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
                <Form.Item name="taxScheme" label="Skema PPh">
                  <Radio.Group options={toOptions(TAX_SCHEME_LABELS)} />
                </Form.Item>
                {scheme === 'FINAL_UMKM' && (
                  <Form.Item name="taxRegisteredYear" label="Tahun terdaftar sebagai wajib pajak" extra="Untuk mengecek batas waktu PPh final 0,5%">
                    <InputNumber min={1980} max={2100} style={{ width: '100%' }} />
                  </Form.Item>
                )}
                <Form.Item
                  name="capitalizationThreshold"
                  label="Batas kapitalisasi aset tetap (per unit)"
                  extra="Pembelian aset di bawah batas ini langsung dibebankan ke 'Beban Peralatan Kecil', tidak didaftarkan sebagai aset. Isi 0 untuk mengapitalisasi semuanya. Tanah selalu dikapitalisasi."
                >
                  <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%' }} prefix="Rp" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={saveReporting.isPending}>
                  Simpan pengaturan pelaporan
                </Button>
              </Form>
            </Card>
          </Col>
        )}
        {can('payroll') && (
          <Col xs={24} lg={12}>
            <Card title="Penggajian & BPJS">
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Nilai bawaan mengikuti ketentuan 2026. Perbarui bila pemerintah mengubah batas upah atau kelompok risiko JKK perusahaan Anda berbeda."
              />
              <Form form={payroll} layout="vertical" onFinish={(v) => savePayroll.mutate(v)}>
                <Form.Item name="workDaysPerWeek" label="Hari kerja">
                  <Radio.Group
                    options={[
                      { value: 6, label: 'Senin–Sabtu (6 hari)' },
                      { value: 5, label: 'Senin–Jumat (5 hari)' },
                    ]}
                  />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="bpjsKesCap" label="Batas upah BPJS Kesehatan">
                      <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="jpCap" label="Batas upah Jaminan Pensiun">
                      <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="jkkRate" label="Tarif JKK">
                      <InputNumber min={0} max={5} step={0.01} suffix="%" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="jkmRate" label="Tarif JKM">
                      <InputNumber min={0} max={5} step={0.01} suffix="%" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="overtimeDivisor" label="Pembagi upah lembur" extra="UU: 1/173">
                      <InputNumber min={1} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={savePayroll.isPending}>
                  Simpan pengaturan gaji
                </Button>
              </Form>
            </Card>
          </Col>
        )}
      </Row>
    </>
  );
}
