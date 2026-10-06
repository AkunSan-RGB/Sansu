import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { CheckCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, rupiahInput } from '@/lib/format';

interface Part {
  amount: string;
  accounts: number;
}
interface OpeningStatus {
  openingDate: string | null;
  firstTransactionDate: string | null;
  components: Record<'cash' | 'otherAssets' | 'receivables' | 'inventory' | 'payables' | 'liabilities' | 'equity' | 'profitLoss' | 'fixedAssets', Part>;
  balancing: string;
  warnings: string[];
}

const STEPS: { key: keyof OpeningStatus['components']; title: string; hint: string; to?: string; cta?: string }[] = [
  { key: 'cash', title: '1. Kas dan bank', hint: 'Saldo per rekening. Isi di formulir di bawah.' },
  { key: 'receivables', title: '2. Piutang usaha', hint: 'Per pelanggan dan per faktur, lengkap dengan jatuh tempo, agar umur piutang benar.', to: '/settings/import?kind=receivables', cta: 'Impor piutang awal' },
  { key: 'inventory', title: '3. Persediaan', hint: 'Per barang dan gudang, jumlah dan harga pokok, agar kartu stok dan HPP benar.', to: '/settings/import?kind=stock', cta: 'Impor stok awal' },
  { key: 'fixedAssets', title: '4. Aset tetap', hint: 'Per aset: harga perolehan, tanggal perolehan, dan akumulasi penyusutan sampai saat ini.', to: '/fixed-assets', cta: 'Daftarkan aset lama' },
  { key: 'payables', title: '5. Utang usaha', hint: 'Per pemasok dan per faktur, lengkap dengan jatuh tempo.', to: '/settings/import?kind=payables', cta: 'Impor utang awal' },
  { key: 'liabilities', title: '6. Utang lain dan modal', hint: 'Pinjaman, pajak terutang, modal disetor, laba ditahan. Isi di formulir di bawah.' },
];

interface Line {
  accountId?: string;
  debit?: number;
  credit?: number;
}

export default function OpeningBalancePage() {
  const accounts = useAccounts();
  const [form] = Form.useForm<{ date: string; lines: Line[] }>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];

  const status = useQuery({ queryKey: ['opening-status'], queryFn: () => get<OpeningStatus>('/accounting/opening-balances/status') });
  const st = status.data;
  const save = useAction(
    (v: { date: string; lines: Line[] }) =>
      post<{ number: string }>('/accounting/opening-balances', {
        date: v.date,
        lines: v.lines.map((l) => ({ accountId: l.accountId, debit: String(l.debit ?? 0), credit: String(l.credit ?? 0) })),
      }),
    {
      success: (r) => `Saldo awal diposting · jurnal ${r.number}`,
      invalidate: [...LEDGER_KEYS, 'opening-status', 'onboarding'],
      onSuccess: () => {
        form.resetFields();
      },
    },
  );

  const totalD = lines.reduce((a, l) => a + (l?.debit ?? 0), 0);
  const totalC = lines.reduce((a, l) => a + (l?.credit ?? 0), 0);
  const diff = totalD - totalC;

  const options = accounts.data
    ?.filter((a) => a.isPostable && !['INVENTORY', 'OPENING_EQUITY', 'AR', 'AP'].includes(a.systemKey ?? ''))
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <>
      <PageHeader title="Saldo Awal" />
      <Card style={{ marginBottom: 16 }}>
        <Typography.Paragraph>
          Saldo awal adalah <strong>neraca penutup sistem lama</strong> per tanggal Anda mulai memakai SANSU (biasanya akhir bulan sebelumnya). Isi
          berurutan di bawah; akun yang punya rincian (piutang, utang, stok, aset tetap) diisi lewat rinciannya supaya buku besar selalu sama dengan daftar
          pendukungnya. Selisih ke neraca otomatis masuk ke Ekuitas Saldo Awal.
        </Typography.Paragraph>
        {st?.warnings.map((w) => (
          <Alert key={w} type="warning" showIcon style={{ marginBottom: 8 }} message={w} />
        ))}
        <Row gutter={[12, 12]}>
          {STEPS.map((p) => {
            const c = st?.components[p.key];
            const filled = !!c && (Number(c.amount) !== 0 || c.accounts > 0);
            return (
              <Col xs={24} md={12} xl={8} key={p.key}>
                <Card size="small" style={{ height: '100%' }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      {filled ? <CheckCircleFilled style={{ color: '#2e9d5b' }} /> : <MinusCircleOutlined style={{ color: '#999' }} />}
                      <Typography.Text strong>{p.title}</Typography.Text>
                      <Tag color={filled ? 'green' : 'default'}>{filled ? fmtMoney(c!.amount) : 'Belum diisi'}</Tag>
                    </Space>
                    <Typography.Text type="secondary">{p.hint}</Typography.Text>
                    {p.to && (
                      <Link to={p.to}>
                        <Button size="small">{p.cta}</Button>
                      </Link>
                    )}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
        {st?.openingDate && (
          <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }} type="secondary">
            Saldo awal tercatat per {fmtDate(st.openingDate)}. Penyeimbang Ekuitas Saldo Awal saat ini {fmtMoney(st.balancing)}
            {st.firstTransactionDate ? ` · transaksi pertama ${fmtDate(st.firstTransactionDate)}` : ''}.
          </Typography.Paragraph>
        )}
      </Card>
      <Card title="Kas, bank, dan akun neraca lain">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Aset di kolom Debit; utang, pinjaman, dan modal di kolom Kredit."
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Piutang usaha, utang usaha, persediaan, dan Ekuitas Saldo Awal tidak muncul di daftar akun: diisi lewat langkah di atas atau otomatis.</li>
              <li>
                Mulai di tengah tahun (misalnya 1 Juli)? Selain neraca, masukkan juga <strong>saldo pendapatan dan beban Januari sampai sebelum tanggal mulai</strong> di
                formulir ini supaya laporan setahun dan perhitungan pajak tahunan lengkap.
              </li>
              <li>Pindah dari sistem lain? Saldo semua akun sekaligus bisa diimpor dari Excel lewat <Link to="/settings/import?kind=accounts">Pengaturan → Impor data</Link>.</li>
            </ul>
          }
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'), lines: [{}, {}] }}
          onFinish={(v) => save.mutate(v)}
        >
          <Row>
            <Col xs={24} md={6}>
              <Form.Item name="date" label="Per tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={fields}
                  scroll={{ x: 700 }}
                  columns={[
                    {
                      title: 'Akun',
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]} noStyle>
                          <Select showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="Pilih akun" options={options} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Debit',
                      width: 180,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'debit']} noStyle>
                          <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Kredit',
                      width: 180,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'credit']} noStyle>
                          <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    {
                      width: 40,
                      render: (_, f) => fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />,
                    },
                  ]}
                />
                <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({})}>
                  Tambah akun
                </Button>
              </>
            )}
          </Form.List>
          <Space direction="vertical" style={{ marginTop: 16, width: '100%', alignItems: 'flex-end' }}>
            <Typography.Text>
              Total debit {fmtMoney(totalD)} · total kredit {fmtMoney(totalC)}
            </Typography.Text>
            {diff !== 0 && (
              <Typography.Text type="secondary">
                Selisih {fmtMoney(Math.abs(diff))} akan dicatat di Ekuitas Saldo Awal ({diff > 0 ? 'kredit' : 'debit'})
              </Typography.Text>
            )}
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              Posting saldo awal
            </Button>
          </Space>
        </Form>
      </Card>
    </>
  );
}
