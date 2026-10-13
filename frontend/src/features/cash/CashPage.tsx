import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { BRAND, CASH_TX_TYPE_LABELS, type CashTxType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useCashAccounts } from '@/api/queries';
import type { CashTransaction, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import CashAccountSelect from '@/components/CashAccountSelect';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';

interface CounterAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}
interface FormValues {
  cashAccountId: string;
  toCashAccountId?: string;
  amount?: number;
  date: string;
  description: string;
  reference?: string;
  lines?: { accountId?: string; amount?: number; memo?: string; projectId?: string; assetCategoryId?: string; assetName?: string; assetUsefulLifeMonths?: number; assetLocation?: string }[];
}

const TYPE_COLOR: Record<CashTxType, string> = { IN: 'green', OUT: 'red', TRANSFER: 'blue' };
const TITLE: Record<CashTxType, string> = {
  IN: 'Kas masuk — terima uang di luar penjualan',
  OUT: 'Kas keluar — bayar biaya / pengeluaran',
  TRANSFER: 'Transfer antar kas & bank',
};

export default function CashPage() {
  const navigate = useNavigate();
  const accounts = useCashAccounts();
  const [filter, setFilter] = useState<string>();
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<CashTxType | null>(null);
  const [form] = Form.useForm<FormValues>();
  const lines = Form.useWatch('lines', form) ?? [];
  const { can } = useApps();
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');

  const txs = useQuery({
    queryKey: ['cash-tx', filter, from, to],
    queryFn: () => get<CashTransaction[]>(`/cash/transactions${qs({ cashAccountId: filter, from, to })}`),
  });
  // Akun aset tetap: pembelian tunai ke akun ini otomatis menjadi kartu aset di Aset Tetap
  const assetCats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<{ id: string; name: string; assetAccountId: string }[]>('/assets/categories') });
  const assetCatsByAccount = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const c of assetCats.data ?? []) m.set(c.assetAccountId, [...(m.get(c.assetAccountId) ?? []), c]);
    return m;
  }, [assetCats.data]);
  const counter = useQuery({
    queryKey: ['cash-counter-accounts'],
    queryFn: () => get<CounterAccount[]>('/cash/counter-accounts'),
    enabled: mode === 'IN' || mode === 'OUT',
  });

  const create = useAction(
    (v: FormValues) =>
      post<{ number: string; journalNumber: string }>('/cash/transactions', {
        type: mode,
        cashAccountId: v.cashAccountId,
        date: v.date,
        description: v.description,
        reference: v.reference || undefined,
        ...(mode === 'TRANSFER'
          ? { toCashAccountId: v.toCashAccountId, amount: String(v.amount) }
          : {
              lines: (v.lines ?? []).map((l) => ({
                accountId: l.accountId,
                amount: String(l.amount),
                memo: l.memo || undefined,
                projectId: mode === 'OUT' ? l.projectId || undefined : undefined,
                ...(mode === 'OUT' && l.accountId && assetCatsByAccount.has(l.accountId)
                  ? { assetCategoryId: l.assetCategoryId, assetName: l.assetName || undefined, assetUsefulLifeMonths: l.assetUsefulLifeMonths, assetLocation: l.assetLocation || undefined }
                  : {}),
              })),
            }),
      }),
    {
      success: (r) => `${r.number} diposting · jurnal ${r.journalNumber}`,
      invalidate: LEDGER_KEYS,
      onSuccess: () => setMode(null),
    },
  );

  const openForm = (m: CashTxType) => {
    form.resetFields();
    const cash = accounts.data?.find((a) => a.code.startsWith('1-11')) ?? accounts.data?.[0];
    form.setFieldsValue({ date: today(), cashAccountId: filter ?? cash?.id, lines: [{}] });
    setMode(m);
  };

  const total = (accounts.data ?? []).reduce((a, x) => a + Number(x.balance), 0);
  const withProject = mode === 'OUT' && activeProjects.length > 0;
  const linesTotal = lines.reduce((a, l) => a + (l?.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Kas & Bank"
        extra={
          <Space wrap>
            <Button icon={<ArrowDownOutlined />} onClick={() => openForm('IN')}>
              Kas masuk
            </Button>
            <Button icon={<ArrowUpOutlined />} onClick={() => openForm('OUT')}>
              Kas keluar
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => openForm('TRANSFER')}>
              Transfer
            </Button>
          </Space>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={accounts.isLoading} hoverable onClick={() => setFilter(undefined)} style={!filter ? { borderColor: BRAND.colors.primary } : undefined}>
            <Statistic title="Total kas & bank" value={fmtMoney(total)} />
            <Typography.Text type="secondary">Semua akun</Typography.Text>
          </Card>
        </Col>
        {accounts.data?.map((a) => (
          <Col xs={24} sm={12} xl={6} key={a.id}>
            <Card hoverable onClick={() => setFilter(a.id)} style={filter === a.id ? { borderColor: BRAND.colors.primary } : undefined}>
              <Statistic title={`${a.code} · ${a.name}`} value={fmtMoney(a.balance)} />
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/ledger?accountId=${a.id}`);
                }}
              >
                Lihat mutasi lengkap →
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Transaksi kas & bank">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>s/d</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Space>
        <Typography.Paragraph type="secondary">
          Penerimaan dari pelanggan & pembayaran ke supplier dicatat di menu Faktur. Di sini untuk biaya operasional, setoran modal, pinjaman, dan transfer.
        </Typography.Paragraph>
        <Table
          rowKey="id"
          loading={txs.isLoading}
          dataSource={txs.data}
          scroll={{ x: 900 }}
          expandable={{
            rowExpandable: (t) => t.lines.length > 0,
            expandedRowRender: (t) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={t.lines}
                columns={[
                  { title: 'Akun lawan', render: (_, l) => `${l.account.code} · ${l.account.name}` },
                  { title: 'Keterangan', dataIndex: 'memo' },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Jenis', dataIndex: 'type', render: (t: CashTxType) => <Tag color={TYPE_COLOR[t]}>{CASH_TX_TYPE_LABELS[t]}</Tag> },
            {
              title: 'Kas / bank',
              render: (_, t) => (t.toCashAccount ? `${t.cashAccount.name} → ${t.toCashAccount.name}` : t.cashAccount.name),
            },
            { title: 'Keterangan', dataIndex: 'description' },
            { title: 'Referensi', dataIndex: 'reference' },
            {
              title: 'Jumlah',
              dataIndex: 'amount',
              align: 'right',
              render: (v, t) => (
                <Typography.Text type={t.type === 'OUT' ? 'danger' : t.type === 'IN' ? 'success' : undefined}>
                  {t.type === 'OUT' ? '−' : ''}
                  {fmtMoney(v)}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={mode && TITLE[mode]}
        open={!!mode}
        width={mode === 'TRANSFER' ? 520 : 760}
        onCancel={() => setMode(null)}
        onOk={() => form.submit()}
        okText="Posting"
        confirmLoading={create.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Row gutter={16}>
            <Col xs={24} md={mode === 'TRANSFER' ? 24 : 14}>
              <Form.Item
                name="cashAccountId"
                label={mode === 'IN' ? 'Masuk ke' : mode === 'OUT' ? 'Keluar dari' : 'Dari'}
                rules={[{ required: true }]}
              >
                <CashAccountSelect />
              </Form.Item>
            </Col>
            {mode === 'TRANSFER' && (
              <>
                <Col xs={24}>
                  <Form.Item name="toCashAccountId" label="Ke" rules={[{ required: true }]}>
                    <CashAccountSelect />
                  </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                  <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
                    <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24} md={10}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item name="description" label="Keterangan" rules={[{ required: true }]}>
                <Input placeholder={mode === 'OUT' ? 'Bayar listrik gudang Oktober' : mode === 'IN' ? 'Setoran modal pemilik' : 'Setor kas ke bank'} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="reference" label="No. bukti / referensi">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          {(mode === 'IN' || mode === 'OUT') && (
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Text strong>{mode === 'OUT' ? 'Dibebankan ke akun' : 'Sumber dana (akun lawan)'}</Typography.Text>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginTop: 8 }}>
                      <Col xs={24} md={withProject ? 8 : 11}>
                        <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]} noStyle>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder="Pilih akun"
                            loading={counter.isLoading}
                            options={counter.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={withProject ? 5 : 6}>
                        <Form.Item name={[f.name, 'amount']} rules={[{ required: true, message: 'Isi jumlah' }]} noStyle>
                          <InputNumber min={1} style={{ width: '100%' }} placeholder="Jumlah" />
                        </Form.Item>
                      </Col>
                      <Col xs={10} md={withProject ? 5 : 6}>
                        <Form.Item name={[f.name, 'memo']} noStyle>
                          <Input placeholder="Catatan" />
                        </Form.Item>
                      </Col>
                      {withProject && (
                        <Col xs={22} md={5}>
                          <Form.Item name={[f.name, 'projectId']} noStyle>
                            <Select
                              allowClear
                              style={{ width: '100%' }}
                              placeholder="Proyek (opsional)"
                              options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                            />
                          </Form.Item>
                        </Col>
                      )}
                      {mode === 'OUT' && lines[f.name]?.accountId && assetCatsByAccount.has(lines[f.name]!.accountId!) && (
                        <Col span={24}>
                          <Alert
                            type="info"
                            showIcon
                            style={{ marginTop: 6 }}
                            message="Akun aset tetap: transaksi ini otomatis masuk ke daftar Aset Tetap"
                            description={
                              <Row gutter={8} style={{ marginTop: 6 }}>
                                {(assetCatsByAccount.get(lines[f.name]!.accountId!)?.length ?? 0) > 1 && (
                                  <Col xs={24} md={6}>
                                    <Form.Item name={[f.name, 'assetCategoryId']} rules={[{ required: true, message: 'Pilih kategori aset' }]} noStyle>
                                      <Select placeholder="Kategori aset" options={assetCatsByAccount.get(lines[f.name]!.accountId!)!.map((c) => ({ value: c.id, label: c.name }))} />
                                    </Form.Item>
                                  </Col>
                                )}
                                <Col xs={24} md={8}>
                                  <Form.Item name={[f.name, 'assetName']} noStyle>
                                    <Input placeholder="Nama aset (kosong = catatan)" maxLength={160} />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} md={5}>
                                  <Form.Item name={[f.name, 'assetUsefulLifeMonths']} noStyle>
                                    <InputNumber min={0} max={600} style={{ width: '100%' }} placeholder="Masa manfaat (bln)" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} md={5}>
                                  <Form.Item name={[f.name, 'assetLocation']} noStyle>
                                    <Input placeholder="Lokasi" maxLength={120} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            }
                          />
                        </Col>
                      )}
                      <Col xs={2} md={1}>
                        {fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />}
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({})}>
                    Tambah akun
                  </Button>
                  <div style={{ textAlign: 'right', marginTop: 12 }}>
                    Total: <strong>{fmtMoney(linesTotal)}</strong>
                  </div>
                </>
              )}
            </Form.List>
          )}
        </Form>
      </Modal>
    </>
  );
}
