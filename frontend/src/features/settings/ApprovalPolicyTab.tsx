import { BankOutlined, CheckCircleFilled, DeploymentUnitOutlined, InboxOutlined, SafetyCertificateOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, InputNumber, Progress, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { rupiahInput } from '@/lib/format';
import PolicyCard, { SettingRow, StickySave } from './PolicyCard';

type Policy = {
  purchaseOrder: number; manualJournal: number; assetDisposal: number; cashOut: number; stockAdjustment: number; purchaseRequestAuto: number;
  priceControl: boolean; priceTolerancePct: number; priceBenchmarkPct: number; firstSupplierPayment: boolean; blindReceiving: boolean; blindDelivery: boolean;
  salesOrder: number; salesDiscountMaxPct: number; salesReturn: number; salesBelowCost: boolean; salesSeparateDuties: boolean; stockAlertValue: number;
  stockCountSod: boolean; blindCount: boolean; stockInCostTolerancePct: number; transferSod: boolean; bankChangeHoldDays: number;
  budgetControl: 'OFF' | 'APPROVAL' | 'BLOCK'; telegramLinkHours: number;
};

/** Pengaman utama yang dihitung di ringkasan + nilai rekomendasi (hanya diterapkan pada yang masih mati) */
const SAFEGUARDS: { key: keyof Policy; area: string; rec: number | boolean }[] = [
  { key: 'purchaseOrder', area: 'Pembelian', rec: 50_000_000 },
  { key: 'priceControl', area: 'Pembelian', rec: true },
  { key: 'firstSupplierPayment', area: 'Pembelian', rec: true },
  { key: 'bankChangeHoldDays', area: 'Pembelian', rec: 7 },
  { key: 'salesOrder', area: 'Penjualan', rec: 50_000_000 },
  { key: 'salesDiscountMaxPct', area: 'Penjualan', rec: 15 },
  { key: 'salesReturn', area: 'Penjualan', rec: 5_000_000 },
  { key: 'salesBelowCost', area: 'Penjualan', rec: true },
  { key: 'stockAdjustment', area: 'Persediaan', rec: 5_000_000 },
  { key: 'stockInCostTolerancePct', area: 'Persediaan', rec: 25 },
  { key: 'blindCount', area: 'Persediaan', rec: true },
  { key: 'cashOut', area: 'Kas, jurnal & aset', rec: 5_000_000 },
  { key: 'manualJournal', area: 'Kas, jurnal & aset', rec: 10_000_000 },
  { key: 'assetDisposal', area: 'Kas, jurnal & aset', rec: 5_000_000 },
];
const AREAS = ['Pembelian', 'Penjualan', 'Persediaan', 'Kas, jurnal & aset'];
const isOn = (v: unknown) => (typeof v === 'boolean' ? v : Number(v ?? 0) > 0);

/** Pengaturan kontrol kas & bank (SOP): bukti wajib, saldo negatif, batas simpanan tunai */
function CashControlCard() {
  type Cfg = { evidenceFrom: number; blockNegative: boolean; maxCashBalance: number };
  const [form] = Form.useForm<Cfg>();
  const cfg = useQuery({ queryKey: ['cash', 'settings'], queryFn: () => get<Cfg>('/cash/settings') });
  useEffect(() => {
    if (cfg.data) form.setFieldsValue(cfg.data);
  }, [cfg.data, form]);
  const save = useAction((v: Cfg) => put('/cash/settings', v), { success: 'Pengaturan kontrol kas disimpan', invalidate: ['cash'] });
  return (
    <Form form={form} onFinish={(v) => save.mutate(v)} initialValues={{ evidenceFrom: 0, blockNegative: false, maxCashBalance: 0 }}>
      <PolicyCard
        icon={<BankOutlined />}
        title="Kontrol kas & bank (SOP)"
        desc="Aturan baku untuk uang keluar dan saldo kas. Temuan pelanggarannya muncul di Kas & Bank › Kontrol keuangan."
        footer={
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            Simpan
          </Button>
        }
      >
        <SettingRow label="Nomor bukti wajib untuk uang keluar mulai dari" desc="Kas keluar/transfer di atas nilai ini harus diisi nomor referensi (kuitansi, nota, bukti transfer). 0 = tidak wajib.">
          <Form.Item name="evidenceFrom" noStyle>
            <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={100_000} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </SettingRow>
        <SettingRow label="Tolak uang keluar yang membuat saldo negatif" desc="Mencegah kas keluar melebihi saldo akun kas/bank.">
          <Form.Item name="blockNegative" valuePropName="checked" noStyle>
            <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
          </Form.Item>
        </SettingRow>
        <SettingRow label="Peringatan bila saldo kas melebihi" desc="Batas simpanan tunai yang aman di kantor. Di atas batas, muncul peringatan agar disetor ke bank. 0 = nonaktif.">
          <Form.Item name="maxCashBalance" noStyle>
            <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={1_000_000} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </SettingRow>
      </PolicyCard>
    </Form>
  );
}

/**
 * Tab Persetujuan: batas nilai dan saklar pengaman, dikelompokkan per alur kerja, dengan ringkasan pengaman yang aktif
 * dan tombol untuk menerapkan nilai rekomendasi pada yang masih mati. Semua kelompok memakai satu form dan satu tombol simpan.
 */
export default function ApprovalPolicyTab() {
  const navigate = useNavigate();
  const [form] = Form.useForm<Policy>();
  const policy = useQuery({ queryKey: ['approvals', 'policy'], queryFn: () => get<Policy>('/approvals/policy') });
  useEffect(() => {
    if (policy.data) form.setFieldsValue(policy.data);
  }, [policy.data, form]);
  const save = useAction((v: Policy) => put('/approvals/policy', v), { success: 'Pengaturan persetujuan disimpan', invalidate: ['approvals', 'cash', 'assets', 'inventory-controls', 'sales-controls'] });
  const values = (Form.useWatch([], form) ?? policy.data ?? {}) as Partial<Policy>;

  const stat = useMemo(() => {
    const on = SAFEGUARDS.filter((s) => isOn(values[s.key]));
    const byArea = AREAS.map((a) => {
      const all = SAFEGUARDS.filter((s) => s.area === a);
      return { area: a, on: all.filter((s) => isOn(values[s.key])).length, total: all.length };
    });
    return { on: on.length, total: SAFEGUARDS.length, byArea };
  }, [values]);

  const applyRecommended = () => {
    const patch: Partial<Policy> = {};
    for (const s of SAFEGUARDS) if (!isOn(form.getFieldValue(s.key))) (patch as Record<string, unknown>)[s.key] = s.rec;
    form.setFieldsValue(patch);
    form.submit();
  };

  const tag = (name: keyof Policy) => (isOn(values[name]) ? <Tag color="green">Aktif</Tag> : <Tag>Mati</Tag>);
  const amount = (name: keyof Policy, label: string, desc: string, step = 500_000) => (
    <SettingRow label={<Space size={8} wrap>{label}{tag(name)}</Space>} desc={desc}>
      <Form.Item name={name} noStyle>
        <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={step} style={{ width: '100%' }} prefix="Rp" />
      </Form.Item>
    </SettingRow>
  );
  const pct = (name: keyof Policy, label: string, desc: string, max = 1000, unit = '%', showTag = true) => (
    <SettingRow label={<Space size={8} wrap>{label}{showTag && tag(name)}</Space>} desc={desc}>
      <Form.Item name={name} noStyle>
        <InputNumber min={0} max={max} step={1} precision={0} style={{ width: '100%' }} suffix={unit} />
      </Form.Item>
    </SettingRow>
  );
  const toggle = (name: keyof Policy, label: string, desc: string, optional?: boolean) => (
    <SettingRow label={<Space size={8} wrap>{label}{optional && <Tag color="blue">Opsional</Tag>}</Space>} desc={desc}>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
      </Form.Item>
    </SettingRow>
  );

  return (
    <Space direction="vertical" size={16} style={{ maxWidth: 860, width: '100%' }}>
      <PolicyCard
        icon={<SafetyCertificateOutlined />}
        title="Pengaman transaksi"
        desc="Transaksi bernilai di atas batas dari peran selain Pemilik dan Admin menunggu persetujuan. Isi 0 untuk mematikan. Batas yang mati berarti transaksi berapa pun langsung tercatat."
        footer={
          stat.on < stat.total ? (
            <>
              <span style={{ opacity: 0.7 }}>Hanya mengisi pengaman yang masih mati; nilai yang sudah Anda atur tidak diubah.</span>
              <Button type="primary" loading={save.isPending} onClick={applyRecommended}>
                Terapkan rekomendasi
              </Button>
            </>
          ) : (
            <span style={{ color: '#2e9d5b' }}>
              <CheckCircleFilled /> Semua pengaman utama sudah aktif
            </span>
          )
        }
      >
        <Progress percent={Math.round((stat.on / stat.total) * 100)} format={() => `${stat.on} dari ${stat.total} aktif`} status={stat.on === stat.total ? 'success' : 'active'} />
        <Space wrap size={[8, 8]} style={{ marginTop: 10 }}>
          {stat.byArea.map((a) => (
            <Tag key={a.area} color={a.on === a.total ? 'green' : a.on ? 'orange' : 'default'}>
              {a.area}: {a.on}/{a.total}
            </Tag>
          ))}
        </Space>
      </PolicyCard>

      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} requiredMark={false} initialValues={{ purchaseOrder: 0, manualJournal: 0, purchaseRequestAuto: 0, priceControl: true, priceTolerancePct: 5, priceBenchmarkPct: 10, firstSupplierPayment: false, budgetControl: 'OFF', telegramLinkHours: 72 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <PolicyCard icon={<ShoppingCartOutlined />} title="Pembelian" desc="Pesanan pembelian, harga faktur supplier, dan pembayaran ke supplier.">
            {amount('purchaseOrder', 'Pesanan pembelian dengan total mulai dari', 'Konfirmasi pesanan oleh keuangan menunggu persetujuan.')}
            {amount('purchaseRequestAuto', 'Permintaan pembelian disetujui otomatis sampai', 'Permintaan dari gudang/divisi dengan perkiraan nilai sampai batas ini langsung disetujui (harga harus diketahui). 0 bila semua permintaan harus diputuskan.')}
            {toggle('priceControl', 'Pengendalian harga faktur supplier', 'Selisih harga faktur terhadap PO wajib beralasan dan tercatat. Kenaikan di atas toleransi atau jauh di atas harga pasar harus disetujui sebelum faktur dicatat.')}
            {pct('priceTolerancePct', 'Toleransi kenaikan harga faktur vs PO (%)', 'Per baris barang. Di atas ini perlu persetujuan.', 1000, '%', false)}
            {pct('priceBenchmarkPct', 'Toleransi di atas rata-rata harga beli 90 hari (%)', 'Harga faktur yang melebihi rata-rata harga beli 90 hari terakhir sebesar ini perlu persetujuan, walau PO-nya sudah mahal.', 1000, '%', false)}
            {toggle('firstSupplierPayment', 'Pembayaran pertama ke supplier wajib disetujui', 'Anti pemasok fiktif: staf yang membayar supplier untuk pertama kali menunggu persetujuan. Pembayaran berikutnya berjalan biasa.')}
            {pct('bankChangeHoldDays', 'Tahan pembayaran setelah rekening supplier diubah (hari)', 'Pembayaran oleh staf ke supplier yang rekeningnya baru diubah menunggu persetujuan. 0 = tidak ditahan.', 60, 'hari')}
            {toggle('blindReceiving', 'Penerimaan buta (Gudang menghitung sendiri)', 'Gudang tidak melihat jumlah yang dipesan dan wajib mengisi hasil hitungannya. Selisih langsung dikabarkan ke Pembelian, Admin, dan Pemilik.', true)}
          </PolicyCard>

          <PolicyCard icon={<ShopOutlined />} title="Penjualan" desc="Pesanan, diskon, retur, dan pembayaran pelanggan.">
            {amount('salesOrder', 'Pesanan penjualan dengan total mulai dari', 'Konfirmasi pesanan oleh staf (Sales/Keuangan) menunggu persetujuan Pemilik/Admin. 0 = tanpa persetujuan.', 1_000_000)}
            {pct('salesDiscountMaxPct', 'Diskon per baris di atas (%) butuh persetujuan', 'Pesanan dengan diskon di atas persen ini, saat dikonfirmasi staf, menunggu persetujuan. 0 = tanpa batas.', 100)}
            {amount('salesReturn', 'Retur penjualan bernilai mulai dari', 'Retur (kredit nota) oleh staf menunggu persetujuan sebelum piutang dikurangi. 0 = tanpa persetujuan.', 1_000_000)}
            {toggle('salesBelowCost', 'Penjualan di bawah harga pokok butuh persetujuan', 'Harga jual (setelah diskon) di bawah harga pokok rata-rata gudang, saat dikonfirmasi staf, menunggu persetujuan. Menutup celah menembus batas diskon lewat harga yang diketik langsung.')}
            {toggle('salesSeparateDuties', 'Pembuat faktur ≠ pencatat pembayaran/retur', 'Pembayaran atau retur atas faktur oleh orang yang membuat faktur itu sendiri (selain Pemilik/Admin) menunggu persetujuan. Cocok bila ada lebih dari satu Keuangan; bila hanya satu, semua pembayaran akan menunggu persetujuan.', true)}
            {toggle('blindDelivery', 'Pengiriman buta (Gudang mengisi jumlah kemas sendiri)', 'Gudang tidak melihat jumlah pesanan dan wajib mengisi jumlah yang dikemas. Bila tidak sama dengan sisa pesanan, pengiriman ditahan dan Penjualan, Admin, dan Pemilik diberi tahu.', true)}
          </PolicyCard>

          <PolicyCard icon={<InboxOutlined />} title="Persediaan" desc="Penyesuaian stok, stock opname, dan transfer antar gudang.">
            {amount('stockAdjustment', 'Penyesuaian stok / selisih opname bernilai mulai dari', 'Penyesuaian stok (masuk + keluar) dan selisih opname oleh Gudang di atas batas menunggu persetujuan; stok berubah setelah disetujui. 0 = tidak perlu persetujuan.')}
            {amount('stockAlertValue', 'Beri tahu Pemilik bila penyesuaian keluar / selisih opname mulai dari', 'Pemilik menerima Telegram/email saat nilainya di atas ini (kecuali ia sendiri pelakunya), dan selisih opname sebesar ini wajib diberi catatan alasan. Bawaan Rp5 juta; 0 = tidak diberi tahu.', 1_000_000)}
            {pct('stockInCostTolerancePct', 'Harga pokok stok MASUK di atas rata-rata (%) butuh persetujuan', 'Penyesuaian stok masuk (di luar saldo awal) oleh staf dengan harga pokok lebih tinggi dari rata-rata stok sebesar ini menunggu persetujuan. Mencegah penggelembungan nilai persediaan. 0 = tidak dicek.')}
            {toggle('blindCount', 'Opname buta (penghitung tidak melihat stok sistem)', 'Gudang yang menghitung tidak melihat stok sistem selama opname berjalan, sehingga tidak sekadar menyalin angka sistem.')}
            {toggle('stockCountSod', 'Penghitung ≠ pemosting selisih opname', 'Yang mengisi jumlah fisik opname tidak boleh memposting selisihnya sendiri (selain Pemilik). Nyalakan bila ada lebih dari satu Admin/Keuangan.', true)}
            {toggle('transferSod', 'Pembuat transfer gudang ≠ penerima', 'Yang membuat transfer antar gudang tidak boleh menerimanya sendiri (selain Pemilik). Nyalakan bila ada lebih dari satu orang Gudang/Admin.', true)}
          </PolicyCard>

          <PolicyCard icon={<DeploymentUnitOutlined />} title="Kas, jurnal & aset" desc="Uang keluar, jurnal manual, dan pelepasan aset tetap.">
            {amount('cashOut', 'Kas keluar / transfer dengan nilai mulai dari', 'Uang keluar oleh staf (selain Pemilik dan Admin) di atas batas, termasuk pembayaran ke supplier, menunggu persetujuan lalu diposting setelah disetujui. 0 = tidak perlu persetujuan.')}
            {amount('manualJournal', 'Jurnal manual dengan total debit mulai dari', 'Jurnal baru diposting setelah disetujui. 0 = tidak perlu persetujuan.')}
            {amount('assetDisposal', 'Pelepasan aset tetap dengan harga perolehan mulai dari', 'Penjualan/penghapusan aset oleh staf menunggu persetujuan. 0 = tidak perlu persetujuan.')}
          </PolicyCard>

          <PolicyCard icon={<SafetyCertificateOutlined />} title="Tautan persetujuan lewat Telegram" desc="Permintaan persetujuan dikirim ke Telegram pemberi persetujuan beserta tautan pribadi untuk memutuskan.">
            <SettingRow label="Masa berlaku tautan (jam)" desc="1–72 jam. Lebih pendek = lebih aman bila chat terbaca orang lain, tetapi pemberi persetujuan harus memutuskan lebih cepat. Tautan lewat email tetap 72 jam.">
              <Form.Item name="telegramLinkHours" noStyle>
                <InputNumber min={1} max={72} step={1} precision={0} style={{ width: '100%' }} suffix="jam" />
              </Form.Item>
            </SettingRow>
            <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
              Menghubungkan akun Telegram dilakukan tiap pengguna di{' '}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/account/security')}>
                Keamanan akun
              </Button>
              .
            </Typography.Paragraph>
          </PolicyCard>

          {stat.on < stat.total && <Alert type="warning" showIcon message={`${stat.total - stat.on} pengaman utama masih mati`} description="Gunakan tombol Terapkan rekomendasi di atas, atau isi batas yang sesuai kebutuhan Anda." />}
          <StickySave loading={save.isPending} />
        </Space>
      </Form>

      <CashControlCard />
    </Space>
  );
}
