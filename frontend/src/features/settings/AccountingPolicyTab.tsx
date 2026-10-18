import { AppstoreOutlined, AuditOutlined } from '@ant-design/icons';
import { FRAMEWORK_REFS, REPORTING_FRAMEWORK_LABELS, REPORTING_FRAMEWORK_SHORT, type ReportingFramework } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, type FormInstance, InputNumber, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { ReportingSettings } from '@/api/types';
import { fmtMoney, rupiahInput } from '@/lib/format';
import InventoryMethodCard from './InventoryMethodCard';
import PettyCashPolicyCard from './PettyCashPolicyCard';
import PolicyCard, { ChoiceCards } from './PolicyCard';

const FRAMEWORK_CHOICES: { value: ReportingFramework; audience: string; desc: string }[] = [
  { value: 'SAK_EMKM', audience: 'Usaha mikro dan kecil', desc: 'Laporan sederhana: posisi keuangan, laba rugi, dan CALK. Aset tetap dengan biaya historis, tanpa nilai residu.' },
  { value: 'SAK_EP', audience: 'Entitas tanpa akuntabilitas publik (umumnya UKM)', desc: '5 laporan lengkap dengan pembanding. Berlaku sejak 1 Januari 2025.' },
  { value: 'IFRS', audience: 'Akuntabilitas publik, grup asing, atau syarat bank/investor', desc: 'PSAK berbasis IFRS dengan pengungkapan paling lengkap.' },
];

const THRESHOLD_PRESETS = [0, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

function FrameworkPicker({ value, onChange, disabled }: { value?: ReportingFramework; onChange?: (v: ReportingFramework) => void; disabled?: boolean }) {
  return <ChoiceCards value={value} onChange={onChange} disabled={disabled} options={FRAMEWORK_CHOICES.map((c) => ({ value: c.value, title: REPORTING_FRAMEWORK_SHORT[c.value] ?? REPORTING_FRAMEWORK_LABELS[c.value], audience: c.audience, desc: c.desc }))} />;
}

/**
 * Tab Kebijakan akuntansi: ringkasan kebijakan yang berlaku, lalu kelompok kebijakan dengan tampilan seragam
 * (standar akuntansi, aset tetap, persediaan, kas kecil). `policy` adalah form milik halaman induk.
 */
export default function AccountingPolicyTab({
  policy,
  saved,
  canEdit,
  saving,
  onSave,
  showCash,
}: {
  policy: FormInstance<ReportingSettings>;
  saved?: ReportingSettings;
  canEdit: boolean;
  saving: boolean;
  onSave: (v: ReportingSettings) => void;
  showCash: boolean;
}) {
  const navigate = useNavigate();
  const framework = Form.useWatch('framework', policy) as ReportingFramework | undefined;
  const threshold = (Form.useWatch('capitalizationThreshold', policy) as number | undefined) ?? 0;
  const method = useQuery({ queryKey: ['inventory-method'], queryFn: () => get<{ method: string; options: { key: string; label: string }[] }>('/settings/inventory-method') });
  const funds = useQuery({ queryKey: ['petty', 'funds'], queryFn: () => get<{ imprestAmount: string }[]>('/petty-cash/funds'), enabled: showCash });
  const methodLabel = method.data?.options.find((o) => o.key === method.data?.method)?.label?.replace(/\s*\(.*\)$/, '');
  const changedFramework = !!saved?.framework && !!framework && saved.framework !== framework;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tile = (title: string, value: string, id: string, hint?: string) => (
    <Col xs={12} md={6}>
      <Card size="small" hoverable onClick={() => jump(id)} style={{ height: '100%' }} styles={{ body: { padding: '12px 14px' } }}>
        <Statistic title={title} value={value} valueStyle={{ fontSize: 16, lineHeight: 1.3, whiteSpace: 'normal' }} />
        {hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text>}
      </Card>
    </Col>
  );

  return (
    <Space direction="vertical" size={16} style={{ maxWidth: 860, width: '100%' }}>
      <div>
        <Typography.Title level={5} style={{ margin: '0 0 4px' }}>Kebijakan yang berlaku sekarang</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Ringkasan pilihan yang dipakai SANSU untuk menyusun laporan. Klik kotak untuk melompat ke pengaturannya. Pilihan ini tercantum otomatis di Catatan atas Laporan Keuangan (CALK).
        </Typography.Paragraph>
        <Row gutter={[12, 12]}>
          {tile('Standar akuntansi', saved?.framework ? REPORTING_FRAMEWORK_SHORT[saved.framework] ?? saved.framework : '—', 'kebijakan-standar')}
          {tile('Batas kapitalisasi', (saved?.capitalizationThreshold ?? 0) > 0 ? fmtMoney(saved!.capitalizationThreshold) : 'Semua jadi aset', 'kebijakan-aset', 'per unit aset')}
          {tile('Biaya persediaan', methodLabel ?? '—', 'kebijakan-persediaan')}
          {showCash && tile('Kas kecil', funds.data?.[0] ? `Plafon ${fmtMoney(funds.data[0].imprestAmount)}` : 'Belum dibuat', 'kebijakan-kas-kecil')}
        </Row>
      </div>

      <Form form={policy} layout="vertical" onFinish={(v) => onSave({ framework: v.framework, capitalizationThreshold: v.capitalizationThreshold } as ReportingSettings)} requiredMark={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <PolicyCard
            id="kebijakan-standar"
            icon={<AuditOutlined />}
            title="Standar akuntansi"
            tag={framework && <Tag color="blue">{FRAMEWORK_REFS[framework]?.inventory ? REPORTING_FRAMEWORK_SHORT[framework] : framework}</Tag>}
            desc="Menentukan susunan laporan, catatan (CALK), akun yang ditampilkan, dan fitur yang tersedia. Pilih yang sesuai ukuran dan kewajiban usaha Anda; bingung? Wizard di tab Pelaporan & PPh menyarankannya dari pembukuan."
            footer={null}
          >
            <Form.Item name="framework" noStyle>
              <FrameworkPicker disabled={!canEdit} />
            </Form.Item>
            {changedFramework && <Alert type="warning" showIcon style={{ marginTop: 14 }} message="Standar akuntansi diubah" description="Mengubah standar mengubah susunan laporan, CALK, akun yang ditampilkan, dan fitur yang tersedia. Pastikan sudah sesuai sebelum menyimpan." />}
          </PolicyCard>

          <PolicyCard
            id="kebijakan-aset"
            icon={<AppstoreOutlined />}
            title="Aset tetap"
            desc="Pembelian di bawah batas kapitalisasi langsung dibebankan ke ‘Beban Peralatan Kecil’, tidak didaftarkan sebagai aset. Tanah selalu dikapitalisasi."
            footer={
              canEdit ? (
                <>
                  <span style={{ opacity: 0.7 }}>Menyimpan juga menyimpan pilihan standar akuntansi di atas.</span>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    Simpan perubahan
                  </Button>
                </>
              ) : null
            }
          >
            <Form.Item name="capitalizationThreshold" label="Batas kapitalisasi (per unit)" extra="Isi 0 untuk mengapitalisasi semuanya.">
              <InputNumber {...rupiahInput} min={0} max={1_000_000_000_000} step={500_000} style={{ width: '100%', maxWidth: 320 }} prefix="Rp" disabled={!canEdit} />
            </Form.Item>
            {canEdit && (
              <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary">Pilihan cepat:</Typography.Text>
                {THRESHOLD_PRESETS.map((v) => (
                  <Button key={v} size="small" type={threshold === v ? 'primary' : 'default'} onClick={() => policy.setFieldsValue({ capitalizationThreshold: v })}>
                    {v === 0 ? 'Semua jadi aset' : fmtMoney(v)}
                  </Button>
                ))}
              </Space>
            )}
            <Alert
              type="info"
              showIcon
              message={
                threshold > 0
                  ? `Contoh: barang Rp${Math.round(threshold * 0.8).toLocaleString('id-ID')} per unit → dibebankan sebagai beban; barang Rp${Math.round(threshold * 1.5).toLocaleString('id-ID')} per unit → dicatat sebagai aset dan disusutkan.`
                  : 'Saat ini semua pembelian aset dicatat sebagai aset tetap berapa pun nilainya.'
              }
              description={
                <span>
                  Metode penyusutan (garis lurus, saldo menurun, jumlah angka tahun, unit produksi) diatur per kategori di{' '}
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/fixed-assets')}>
                    Akuntansi › Aset tetap › Kategori
                  </Button>
                  .
                </span>
              }
            />
          </PolicyCard>
        </Space>
      </Form>

      <InventoryMethodCard />
      {showCash && <PettyCashPolicyCard />}
    </Space>
  );
}
