import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

interface Line {
  accountId?: string;
  debit?: number;
  credit?: number;
}

export default function OpeningBalancePage() {
  const navigate = useNavigate();
  const accounts = useAccounts();
  const [form] = Form.useForm<{ date: string; lines: Line[] }>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];

  const save = useAction(
    (v: { date: string; lines: Line[] }) =>
      post<{ number: string }>('/accounting/opening-balances', {
        date: v.date,
        lines: v.lines.map((l) => ({ accountId: l.accountId, debit: String(l.debit ?? 0), credit: String(l.credit ?? 0) })),
      }),
    {
      success: (r) => `Saldo awal diposting · jurnal ${r.number}`,
      invalidate: LEDGER_KEYS,
      onSuccess: () => navigate('/reports'),
    },
  );

  const totalD = lines.reduce((a, l) => a + (l?.debit ?? 0), 0);
  const totalC = lines.reduce((a, l) => a + (l?.credit ?? 0), 0);
  const diff = totalD - totalC;

  const options = accounts.data
    ?.filter((a) => a.isPostable && a.systemKey !== 'INVENTORY' && a.systemKey !== 'OPENING_EQUITY')
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <>
      <PageHeader title="Saldo Awal" />
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Isi saldo setiap akun per tanggal mulai memakai SANSU (biasanya akhir bulan sebelumnya)."
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Aset (kas, bank, piutang, peralatan) di kolom Debit; hutang & modal di kolom Kredit.</li>
              <li>Selisih otomatis masuk ke akun Ekuitas Saldo Awal, jadi jurnal selalu seimbang.</li>
              <li>Saldo persediaan diisi lewat Inventori → Penyesuaian stok (alasan: Saldo awal) agar stok & HPP ikut tercatat.</li>
              <li>
                Pindah dari sistem lain? Piutang & utang per faktur, stok awal, dan saldo akun bisa diimpor sekaligus dari Excel lewat{' '}
                <Link to="/settings/import?kind=receivables">Pengaturan → Impor data</Link>.
              </li>
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
                          <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Kredit',
                      width: 180,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'credit']} noStyle>
                          <InputNumber min={0} style={{ width: '100%' }} />
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
