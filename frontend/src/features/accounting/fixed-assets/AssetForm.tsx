import { DEPRECIATION_METHOD_LABELS, FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Col, Form, Input, InputNumber, Radio, Row, Select, Typography } from 'antd';
import { get, post } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import type { AssetCategory, CompanySettings, FixedAsset } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import { fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { KEYS } from './shared';

export function AssetForm({ categories, onDone }: { categories: AssetCategory[]; onDone: () => void }) {
  const [form] = Form.useForm();
  const funding = Form.useWatch('funding', form);
  const catId = Form.useWatch('categoryId', form);
  const cat = categories.find((c) => c.id === catId);
  const cost = Form.useWatch('cost', form) as number | undefined;
  const methodW = Form.useWatch('method', form) as string | undefined;
  const company = useQuery({ queryKey: ['company'], queryFn: () => get<CompanySettings>('/settings/company') });
  const threshold = company.data?.reporting?.capitalizationThreshold ?? 0;
  // Sama dengan aturan server: aset baru di bawah batas ditolak, kecuali tanah / aset lama / dipaksa
  const belowThreshold = threshold > 0 && !!cost && cost < threshold && funding !== 'EXISTING' && !!cat && cat.method !== 'NONE' && cat.fiscalGroup !== 'LAND';
  const branchList = useBranches();
  const activeBranches = (branchList.data?.branches ?? []).filter((b) => b.isActive);
  const create = useAction(
    (v: Record<string, unknown>) =>
      post<FixedAsset>('/assets', {
        ...v,
        cost: String(v.cost),
        residualValue: v.residualValue ? String(v.residualValue) : undefined,
        openingAccumulated: v.openingAccumulated ? String(v.openingAccumulated) : undefined,
        usefulLifeMonths: v.usefulLifeYears != null ? Math.round(Number(v.usefulLifeYears) * 12) : undefined,
        usefulLifeYears: undefined,
        totalUnits: v.totalUnits ? String(v.totalUnits) : undefined,
        depreciationStart: v.depreciationStart || undefined,
      }),
    { success: (a) => `Aset ${a.code} didaftarkan`, invalidate: KEYS, onSuccess: onDone },
  );
  return (
    <Form form={form} layout="vertical" initialValues={{ acquisitionDate: today(), funding: 'CASH' }} onFinish={(v) => create.mutate(v)} id="asset-form">
      <Row gutter={12}>
        <Col xs={24} md={16}>
          <Form.Item name="name" label="Nama aset" rules={[{ required: true }]}>
            <Input placeholder="Truk Colt Diesel B 9123 XY" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="code" label="Kode" extra="Kosong = otomatis">
            <Input placeholder="AT-0001" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="categoryId" label="Kategori" rules={[{ required: true }]}>
            <Select
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(id) => {
                const c = categories.find((x) => x.id === id);
                if (c) form.setFieldsValue({ usefulLifeYears: c.usefulLifeMonths / 12, method: c.method });
              }}
            />
          </Form.Item>
        </Col>
        {activeBranches.length > 0 && (
          <Col xs={24} md={12}>
            <Form.Item name="branchId" label="Cabang pemilik aset" extra="Penyusutan dibebankan ke cabang ini. Kosong = Pusat.">
              <Select allowClear placeholder="Pusat" options={activeBranches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Form.Item>
          </Col>
        )}
        <Col xs={12} md={6}>
          <Form.Item name="acquisitionDate" label="Tanggal perolehan" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item name="depreciationStart" label="Mulai disusutkan" extra="Kosong = bulan perolehan">
            <Input type="date" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="cost" label="Harga perolehan" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name="residualValue" label="Nilai sisa">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item name="usefulLifeYears" label="Umur (tahun)">
            <InputNumber min={0} max={50} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={4}>
          <Form.Item name="method" label="Metode">
            <Select options={toOptions(DEPRECIATION_METHOD_LABELS)} />
          </Form.Item>
        </Col>
      </Row>
      {methodW === 'UNITS_OF_PRODUCTION' && (
        <Row gutter={12}>
          <Col xs={14} md={8}>
            <Form.Item name="totalUnits" label="Total unit (kapasitas)" rules={[{ required: true, message: 'Isi kapasitas total aset' }]} extra="Misalnya 200000 km atau 50000 jam">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={10} md={6}>
            <Form.Item name="unitLabel" label="Satuan">
              <Input placeholder="km / jam / unit" maxLength={20} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 30 }}>
              Penyusutan dihitung dari pemakaian per bulan yang Anda catat di kartu aset, bukan dari waktu.
            </Typography.Paragraph>
          </Col>
        </Row>
      )}
      {cat && (
        <Typography.Paragraph type="secondary">
          Fiskal: {FISCAL_ASSET_GROUP_INFO[cat.fiscalGroup as FiscalAssetGroup]?.label} — dipakai otomatis di Rekonsiliasi Fiskal.
        </Typography.Paragraph>
      )}
      <Form.Item name="funding" label="Cara perolehan">
        <Radio.Group
          options={[
            { value: 'CASH', label: 'Dibayar dari kas / bank' },
            { value: 'PAYABLE', label: 'Utang (belum dibayar)' },
            { value: 'EXISTING', label: 'Aset lama (sudah ada di saldo awal)' },
          ]}
        />
      </Form.Item>
      {belowThreshold && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Harga perolehan di bawah batas kapitalisasi ${fmtMoney(threshold)}`}
          description={
            <>
              Pengeluaran sekecil ini lazimnya langsung dibebankan (catat lewat Tagihan Pembelian atau Jurnal). Jika tetap ingin menjadikannya aset:
              <Form.Item name="ignoreCapitalizationThreshold" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Tetap kapitalisasi sebagai aset tetap</Checkbox>
              </Form.Item>
            </>
          }
        />
      )}
      {funding === 'CASH' && (
        <Form.Item name="cashAccountId" label="Dibayar dari" rules={[{ required: true }]}>
          <CashAccountSelect />
        </Form.Item>
      )}
      {funding === 'EXISTING' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Aset lama tidak membuat jurnal — harga perolehan & akumulasi penyusutannya dianggap sudah masuk lewat Saldo Awal."
          />
          <Form.Item name="openingAccumulated" label="Akumulasi penyusutan sampai sebelum mulai disusutkan di SANSU">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </>
      )}
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="location" label="Lokasi / pemegang">
            <Input placeholder={t('Gudang Cikarang')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="notes" label="Catatan">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Button type="primary" htmlType="submit" loading={create.isPending} block>
        Simpan & posting
      </Button>
    </Form>
  );
}
