import { useQuery } from '@tanstack/react-query';
import { Alert, Form, Input, InputNumber, Modal, Select } from 'antd';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useCashAccounts } from '@/api/queries';
import { fmtCurrency, fmtRate, today } from '@/lib/format';

type Kind = 'BUY' | 'SELL' | 'MOVE' | 'IN' | 'OUT';
interface Values {
  kind: Kind;
  cashAccountId: string;
  toCashAccountId?: string;
  amountForeign: number;
  amountIdr?: number;
  fxRate?: number;
  counterAccountId?: string;
  date: string;
  description: string;
  reference?: string;
}
interface Counter {
  id: string;
  code: string;
  name: string;
  type: string;
}

export const FOREIGN_KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'BUY', label: 'Beli valas (Rupiah → valas)', hint: 'Uang Rupiah keluar dari rekening Rupiah, valas masuk ke rekening valas. Isi Rupiah yang benar-benar dibayar.' },
  { value: 'SELL', label: 'Jual valas (valas → Rupiah)', hint: 'Valas keluar dari rekening valas dinilai pada biaya rata-rata; selisih terhadap Rupiah yang diterima menjadi laba/rugi kurs terealisasi.' },
  { value: 'MOVE', label: 'Pindah antar rekening valas', hint: 'Antar rekening bermata uang sama. Nilai Rupiah tercatat ikut berpindah, tanpa selisih kurs.' },
  { value: 'IN', label: 'Terima valas (di luar penjualan)', hint: 'Mis. setoran modal atau pendapatan lain dalam valas. Penjualan dibayar lewat Faktur & piutang, pilih rekening valas di sana.' },
  { value: 'OUT', label: 'Bayar dari rekening valas', hint: 'Mis. biaya dalam valas. Pembayaran utang pemasok dilakukan lewat Pembelian › Pembayaran, pilih rekening valas di sana.' },
];

export default function ForeignTxModal({ open, initialKind, onClose }: { open: boolean; initialKind?: Kind; onClose: () => void }) {
  const [form] = Form.useForm<Values>();
  const kind: Kind = Form.useWatch('kind', form) ?? initialKind ?? 'BUY';
  const fromId = Form.useWatch('cashAccountId', form);
  const amountForeign = Form.useWatch('amountForeign', form);
  const amountIdr = Form.useWatch('amountIdr', form);
  const idr = useCashAccounts('idr').data ?? [];
  const fx = useCashAccounts('foreign').data ?? [];
  const counters = useQuery({ queryKey: ['cash', 'counter-accounts'], queryFn: () => get<Counter[]>('/cash/counter-accounts'), enabled: open && (kind === 'IN' || kind === 'OUT') });
  const run = useAction((v: Values) => post('/cash/foreign', { ...v, amountForeign: String(v.amountForeign), amountIdr: v.amountIdr === undefined ? undefined : String(v.amountIdr), fxRate: v.fxRate === undefined ? undefined : String(v.fxRate) }), {
    success: 'Transaksi valas dicatat',
    invalidate: ['cash-accounts', 'cash-tx', 'fx-exposure', 'bank', ...LEDGER_KEYS],
  });
  const opt = (rows: typeof fx) => rows.map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (${fmtCurrency(a.balanceForeign ?? 0, a.currency)})` }));
  const idrOpt = idr.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const hint = FOREIGN_KINDS.find((k) => k.value === kind)!.hint;
  const from = fx.find((a) => a.id === fromId);
  const effective = amountForeign && amountIdr ? amountIdr / amountForeign : null;
  const cur = from?.currency;

  return (
    <Modal
      open={open}
      title="Transaksi rekening valas"
      okText="Catat"
      cancelText="Batal"
      confirmLoading={run.isPending}
      onCancel={onClose}
      onOk={() => form.validateFields().then((v) => run.mutate(v, { onSuccess: () => { form.resetFields(); onClose(); } }))}
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" initialValues={{ kind: initialKind ?? 'BUY', date: today() }} preserve={false}>
        <Form.Item name="kind" label="Jenis transaksi" rules={[{ required: true }]}>
          <Select options={FOREIGN_KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={() => form.setFieldsValue({ cashAccountId: undefined, toCashAccountId: undefined, counterAccountId: undefined })} />
        </Form.Item>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={hint} />
        <Form.Item name="cashAccountId" label={kind === 'BUY' ? 'Dari rekening Rupiah' : kind === 'SELL' || kind === 'MOVE' ? 'Dari rekening valas' : 'Rekening valas'} rules={[{ required: true, message: 'Pilih rekening' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Pilih rekening" options={kind === 'BUY' ? idrOpt : opt(fx)} />
        </Form.Item>
        {(kind === 'BUY' || kind === 'SELL' || kind === 'MOVE') && (
          <Form.Item name="toCashAccountId" label={kind === 'SELL' ? 'Ke rekening Rupiah' : 'Ke rekening valas'} rules={[{ required: true, message: 'Pilih rekening tujuan' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Pilih rekening tujuan" options={kind === 'SELL' ? idrOpt : opt(kind === 'MOVE' ? fx.filter((a) => a.id !== fromId && (!cur || a.currency === cur)) : fx)} />
          </Form.Item>
        )}
        {(kind === 'IN' || kind === 'OUT') && (
          <Form.Item name="counterAccountId" label="Akun lawan" rules={[{ required: true, message: 'Pilih akun lawan' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Pendapatan, beban, modal, ..." options={(counters.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          </Form.Item>
        )}
        <Form.Item name="amountForeign" label="Jumlah dalam valas" rules={[{ required: true, message: 'Isi jumlah valas' }]}>
          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="mis. 1000" />
        </Form.Item>
        {(kind === 'BUY' || kind === 'SELL') && (
          <Form.Item name="amountIdr" label={kind === 'BUY' ? 'Rupiah yang dibayar' : 'Rupiah yang diterima'} rules={[{ required: true, message: 'Isi jumlah Rupiah' }]} extra={effective ? `Kurs efektif Rp${fmtRate(effective)} per 1 valas` : undefined}>
            <InputNumber min={1} precision={2} prefix="Rp" style={{ width: '100%' }} />
          </Form.Item>
        )}
        {(kind === 'IN' || kind === 'OUT') && (
          <Form.Item name="fxRate" label="Kurs transaksi (opsional)" extra="Kosong = kurs tersimpan terbaru pada tanggal transaksi (Valas & kurs › Kurs).">
            <InputNumber min={0.000001} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        )}
        <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="description" label="Keterangan" rules={[{ required: true, message: 'Isi keterangan' }]}>
          <Input maxLength={255} />
        </Form.Item>
        <Form.Item name="reference" label="Nomor bukti / referensi">
          <Input maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
