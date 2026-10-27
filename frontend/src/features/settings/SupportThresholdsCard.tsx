import { BarChartOutlined, CarOutlined, DollarOutlined, ShopOutlined, ToolOutlined } from '@ant-design/icons';
import type { SupportInsightThresholds } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, InputNumber, Space } from 'antd';
import { useEffect } from 'react';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import PolicyCard, { SettingRow, StickySave } from './PolicyCard';

interface Payload {
  values: SupportInsightThresholds;
  defaults: SupportInsightThresholds;
}

type Field = { name: keyof SupportInsightThresholds; label: string; desc?: string; unit: 'persen' | 'hari' | 'sesi'; min: number; max: number; step?: number };

const GROUPS: { icon: React.ReactNode; title: string; desc: string; fields: Field[] }[] = [
  {
    icon: <DollarOutlined />,
    title: 'Piutang, utang, dan konsentrasi',
    desc: 'Dipakai di laporan penjualan dan pembelian.',
    fields: [
      { name: 'agingWarnPct', label: 'Lewat 90 hari jadi perhatian bila ≥', desc: 'Persen dari total piutang/utang.', unit: 'persen', min: 1, max: 100 },
      { name: 'agingDangerPct', label: 'Lewat 90 hari jadi kritis bila ≥', unit: 'persen', min: 1, max: 100 },
      { name: 'lateSharePct', label: 'Lewat jatuh tempo jadi perhatian bila ≥', desc: 'Persen piutang/utang yang sudah lewat jatuh tempo.', unit: 'persen', min: 1, max: 100 },
      { name: 'receivableConcentrationPct', label: 'Piutang pada satu pelanggan jadi perhatian bila >', unit: 'persen', min: 1, max: 100 },
      { name: 'concentrationPct', label: 'Penjualan/pembelian pada satu pihak jadi perhatian bila ≥', unit: 'persen', min: 1, max: 100 },
    ],
  },
  {
    icon: <BarChartOutlined />,
    title: 'Penjualan dan pembelian',
    desc: 'Margin, retur, dan dokumen yang tertahan.',
    fields: [
      { name: 'marginWarnPct', label: 'Margin kotor di bawah', unit: 'persen', min: 0, max: 100 },
      { name: 'returnPct', label: 'Retur penjualan/pembelian jadi perhatian bila ≥', unit: 'persen', min: 0.1, max: 100, step: 0.1 },
      { name: 'deliveryDays', label: 'Surat jalan belum difaktur lebih dari', unit: 'hari', min: 1, max: 365 },
      { name: 'grniDays', label: 'Barang diterima belum ditagih lebih dari', unit: 'hari', min: 1, max: 365 },
    ],
  },
  {
    icon: <ShopOutlined />,
    title: 'Kasir dan F&B',
    desc: 'Selisih uang laci, retur kasir, dan pemakaian bahan.',
    fields: [
      { name: 'posShortWarnPct', label: 'Uang laci kurang jadi perhatian bila ≥', desc: 'Persen dari penjualan kasir.', unit: 'persen', min: 0.01, max: 100, step: 0.1 },
      { name: 'posShortDangerPct', label: 'Uang laci kurang jadi kritis bila ≥', unit: 'persen', min: 0.01, max: 100, step: 0.1 },
      { name: 'posRepeatSessions', label: 'Selisih kurang berulang pada satu kasir bila ≥', unit: 'sesi', min: 2, max: 50 },
      { name: 'posReturnPct', label: 'Retur per kasir jadi perhatian bila ≥', desc: 'Persen dari penjualan kasir itu.', unit: 'persen', min: 0.1, max: 100, step: 0.1 },
      { name: 'fnbUsagePct', label: 'Bahan menyimpang dari resep lebih dari', unit: 'persen', min: 0.1, max: 100, step: 0.1 },
    ],
  },
  {
    icon: <CarOutlined />,
    title: 'FMCG dan produksi',
    desc: 'Tukar-guling, rendemen, dan barang dalam proses.',
    fields: [
      { name: 'swapPct', label: 'Tukar-guling jadi perhatian bila ≥', desc: 'Persen dari penjualan neto.', unit: 'persen', min: 0.1, max: 100, step: 0.1 },
      { name: 'yieldPct', label: 'Rendemen produksi di bawah', unit: 'persen', min: 1, max: 100 },
      { name: 'wipWarnDays', label: 'Barang dalam proses jadi perhatian bila lebih dari', unit: 'hari', min: 1, max: 365 },
      { name: 'wipDangerDays', label: 'Barang dalam proses jadi kritis bila lebih dari', unit: 'hari', min: 1, max: 730 },
    ],
  },
  {
    icon: <ToolOutlined />,
    title: 'Utilitas',
    desc: 'Pencatatan meter dan penagihan.',
    fields: [
      { name: 'utilFlaggedPct', label: 'Catatan meter janggal jadi perhatian bila ≥', unit: 'persen', min: 0.1, max: 100, step: 0.1 },
      { name: 'utilCollectionPct', label: 'Pembayaran terkumpul di bawah', desc: 'Persen dari tagihan.', unit: 'persen', min: 1, max: 100 },
      { name: 'utilArrearsDays', label: 'Tunggakan lebih dari', unit: 'hari', min: 1, max: 365 },
    ],
  },
];

/** Ambang kesimpulan otomatis pada laporan pendukung: kapan sebuah angka dianggap perlu perhatian atau kritis */
export default function SupportThresholdsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [form] = Form.useForm<SupportInsightThresholds>();
  const { data } = useQuery({ queryKey: ['support-insights-thresholds'], queryFn: () => get<Payload>('/settings/support-insights') });
  useEffect(() => {
    if (data) form.setFieldsValue(data.values);
  }, [data, form]);
  const done = (r: Payload) => {
    qc.setQueryData(['support-insights-thresholds'], r);
    void qc.invalidateQueries({ queryKey: ['support-report'] });
    form.setFieldsValue(r.values);
  };
  const save = useAction((v: SupportInsightThresholds) => put<Payload>('/settings/support-insights', v), { success: 'Ambang kesimpulan disimpan', onSuccess: done });
  const reset = useAction(() => put<Payload>('/settings/support-insights', { reset: true }), { success: 'Dikembalikan ke standar', onSuccess: done });
  return (
    <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} requiredMark={false} disabled={!canEdit}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Ambang kesimpulan laporan pendukung"
          description="Bagian Kesimpulan dan saran di laporan pendukung menandai angka yang melewati ambang di bawah. Standar bersifat umum; sesuaikan dengan kebiasaan usaha Anda. Perubahan langsung berlaku di semua laporan."
        />
        {GROUPS.map((g) => (
          <PolicyCard key={g.title} icon={g.icon} title={g.title} desc={g.desc}>
            {g.fields.map((f) => (
              <SettingRow key={f.name} label={f.label} desc={f.desc ?? (data ? `Standar: ${data.defaults[f.name]} ${f.unit === 'persen' ? '%' : f.unit}` : undefined)}>
                <Form.Item name={f.name} noStyle>
                  <InputNumber min={f.min} max={f.max} step={f.step ?? 1} suffix={f.unit === 'persen' ? '%' : f.unit} style={{ width: '100%' }} />
                </Form.Item>
              </SettingRow>
            ))}
          </PolicyCard>
        ))}
        {canEdit && (
          <>
            <StickySave loading={save.isPending} />
            <div style={{ textAlign: 'right' }}>
              <Button loading={reset.isPending} onClick={() => reset.mutate(undefined)}>
                Kembalikan semua ke standar
              </Button>
            </div>
          </>
        )}
      </Space>
    </Form>
  );
}
