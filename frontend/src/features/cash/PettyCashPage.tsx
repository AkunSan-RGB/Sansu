import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { PettyReplenishSheet, PettyVoucherSheet } from '@/components/print/PettyCashDocs';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, rupiahInput, today } from '@/lib/format';
import { printDoc } from '@/lib/print';

type Fund = {
  id: string;
  accountId: string;
  fundingAccountId: string;
  name: string;
  custodianName: string;
  imprestAmount: string;
  maxVoucher: string;
  status: 'ACTIVE' | 'CLOSED';
  balance: string;
  openVouchers: string;
  openCount: number;
  oldestOpen: string | null;
  lastCount: string | null;
  variance: string;
  toReplenish: string;
};
type Voucher = {
  id: string;
  number: string;
  date: string;
  payee: string;
  description: string;
  amount: string;
  receiptRef: string;
  status: 'OPEN' | 'REPLENISHED' | 'VOID';
  expenseAccount: { code: string; name: string } | null;
};
type Finding = { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string };

const STATUS = { OPEN: ['orange', 'Belum diganti'], REPLENISHED: ['green', 'Sudah diganti'], VOID: ['default', 'Dibatalkan'] } as const;

/**
 * Kas kecil dengan sistem dana tetap (imprest): dana = plafon; pengeluaran dicatat dengan bukti (nota wajib, batas per bukti),
 * pengisian kembali mengembalikan dana ke plafon. Kas kecil + bukti belum diganti harus = plafon.
 */
export default function PettyCashPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const funds = useQuery({ queryKey: ['petty', 'funds'], queryFn: () => get<Fund[]>('/petty-cash/funds') });
  const fund = funds.data?.[0];
  const vouchers = useQuery({ queryKey: ['petty', 'vouchers', fund?.id], queryFn: () => get<Voucher[]>(`/petty-cash/vouchers?fundId=${fund!.id}`), enabled: !!fund });
  const controls = useQuery({ queryKey: ['petty', 'controls'], queryFn: () => get<{ items: Finding[] }>('/petty-cash/controls'), enabled: !!fund });
  const counter = useQuery({ queryKey: ['cash-counter-accounts'], queryFn: () => get<{ id: string; code: string; name: string; type: string }[]>('/cash/counter-accounts') });
  const expenseAccounts = (counter.data ?? []).filter((a) => a.type === 'EXPENSE');

  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voiding, setVoiding] = useState<Voucher | null>(null);
  const [preview, setPreview] = useState<{ kind: 'voucher'; v: Voucher } | { kind: 'list' } | null>(null);
  const [voucherForm] = Form.useForm();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const done = { invalidate: [...LEDGER_KEYS, 'petty'] };

  const topUp = useAction((id: string) => post<{ amount: string }>(`/petty-cash/funds/${id}/top-up`, {}), { success: (r) => `Dana diisi ${fmtMoney(r.amount)}`, ...done });
  const addVoucher = useAction((v: Record<string, unknown>) => post('/petty-cash/vouchers', v), { success: 'Bukti kas kecil dicatat', ...done, onSuccess: () => setVoucherOpen(false) });
  const replenish = useAction((id: string) => post<{ number?: string; total?: string }>(`/petty-cash/funds/${id}/replenish`, {}), { success: (r) => `Pengisian kembali ${r.number ?? ''} diposting`, ...done });
  const doVoid = useAction((v: { id: string; reason: string }) => post(`/petty-cash/vouchers/${v.id}/void`, { reason: v.reason }), { success: 'Bukti dibatalkan', ...done, onSuccess: () => setVoiding(null) });


  const variance = Number(fund?.variance ?? 0);
  return (
    <>
      <PageHeader
        title="Kas Kecil"
        extra={
          admin && (
            <Button type={fund ? 'default' : 'primary'} onClick={() => navigate('/settings/company?tab=persetujuan')}>
              {fund ? 'Ubah kebijakan kas kecil' : 'Atur kebijakan kas kecil'}
            </Button>
          )
        }
      />
      {!fund && !funds.isLoading && (
        <Alert
          type="info"
          showIcon
          message="Kas kecil memakai sistem dana tetap (imprest)"
          description="Tetapkan plafon dan juru kas. Pengeluaran dicatat dengan bukti (nota wajib, ada batas per bukti), lalu diganti lewat pengisian kembali sampai dana kembali ke plafon. Pengisian kembali oleh staf menunggu persetujuan pemilik/admin."
        />
      )}
      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol kas kecil" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert
                key={c.key}
                type={c.level}
                showIcon
                message={c.title}
                description={c.detail}
                action={c.key.startsWith('COUNT') || c.key.startsWith('MISMATCH') ? <Button size="small" onClick={() => navigate('/cash/counts')}>Hitung kas</Button> : undefined}
              />
            ))}
          </Space>
        </Card>
      )}
      {fund && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {[
              ['Dana tetap (plafon)', fund.imprestAmount],
              ['Saldo kas kecil', fund.balance],
              [`Bukti belum diganti (${fund.openCount})`, fund.openVouchers],
              ['Perlu pengisian kembali', fund.toReplenish],
            ].map(([t, v]) => (
              <Col xs={12} md={6} key={t}>
                <Card size="small">
                  <Statistic title={t} value={Number(v)} formatter={(x) => fmtMoney(Number(x))} />
                </Card>
              </Col>
            ))}
          </Row>
          <Card style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={{ xs: 1, md: 3 }}>
              <Descriptions.Item label="Juru kas">{fund.custodianName}</Descriptions.Item>
              <Descriptions.Item label="Batas per bukti">{fmtMoney(fund.maxVoucher)}</Descriptions.Item>
              <Descriptions.Item label="Hitung kas terakhir">{fund.lastCount ? fmtDate(fund.lastCount) : <Tag color="orange">Belum pernah</Tag>}</Descriptions.Item>
              <Descriptions.Item label="Kecocokan dana tetap" span={3}>
                {Math.abs(variance) < 1 ? (
                  <Tag color="green">Sesuai: saldo kas kecil + bukti belum diganti = plafon</Tag>
                ) : (
                  <Tag color="red">
                    Tidak sesuai: selisih {fmtMoney(variance)} {variance > 0 ? '(kekurangan)' : '(kelebihan)'}
                  </Tag>
                )}
              </Descriptions.Item>
            </Descriptions>
            <Space wrap style={{ marginTop: 12 }}>
              <Button
                type="primary"
                disabled={fund.status !== 'ACTIVE'}
                onClick={() => {
                  voucherForm.resetFields();
                  voucherForm.setFieldsValue({ date: today() });
                  setVoucherOpen(true);
                }}
              >
                Bukti kas kecil baru
              </Button>
              <Button disabled={fund.openCount === 0} loading={replenish.isPending} onClick={() => replenish.mutate(fund.id)}>
                {admin ? 'Isi kembali dana' : 'Ajukan pengisian kembali'}
              </Button>
              {admin && fund.openCount === 0 && Number(fund.toReplenish) > 0 && (
                <Button loading={topUp.isPending} onClick={() => topUp.mutate(fund.id)}>
                  Isi dana awal / tambah plafon
                </Button>
              )}
              <Button icon={<PrinterOutlined />} disabled={fund.openCount === 0} onClick={() => setPreview({ kind: 'list' })}>
                Cetak daftar pengisian kembali
              </Button>
              <Button onClick={() => navigate('/cash/counts')}>Hitung kas fisik</Button>
            </Space>
          </Card>
          <Card title="Bukti kas kecil">
            <Table
              rowKey="id"
              size="small"
              loading={vouchers.isLoading}
              dataSource={vouchers.data}
              scroll={{ x: 900 }}
              columns={[
                { title: 'Nomor', dataIndex: 'number' },
                { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                { title: 'Penerima', dataIndex: 'payee' },
                { title: 'Keperluan', dataIndex: 'description' },
                { title: 'Akun beban', render: (_, v) => (v.expenseAccount ? `${v.expenseAccount.code} · ${v.expenseAccount.name}` : '-') },
                { title: 'No. nota', dataIndex: 'receiptRef' },
                { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                { title: 'Status', dataIndex: 'status', render: (s: Voucher['status']) => <Tag color={STATUS[s][0]}>{STATUS[s][1]}</Tag> },
                {
                  title: '',
                  render: (_, v) => (
                    <Space size={0}>
                      <Button size="small" type="text" icon={<PrinterOutlined />} onClick={() => setPreview({ kind: 'voucher', v })}>
                        Cetak
                      </Button>
                      {admin && v.status === 'OPEN' && (
                        <Button size="small" danger type="text" onClick={() => { voidForm.resetFields(); setVoiding(v); }}>
                          Batalkan
                        </Button>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}

      <Modal title="Bukti kas kecil" open={voucherOpen} onCancel={() => setVoucherOpen(false)} onOk={() => voucherForm.submit()} confirmLoading={addVoucher.isPending} okText="Catat">
        <Form form={voucherForm} layout="vertical" onFinish={(v) => addVoucher.mutate({ ...v, fundId: fund!.id, amount: String(v.amount) })}>
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="payee" label="Dibayarkan kepada" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Keperluan" rules={[{ required: true, min: 3 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="expenseAccountId" label="Akun beban" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          </Form.Item>
          <Form.Item name="amount" label={`Jumlah (maks. ${fmtMoney(fund?.maxVoucher)})`} rules={[{ required: true }]}>
            <InputNumber {...rupiahInput} min={1} max={Number(fund?.maxVoucher ?? 0)} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
          <Form.Item name="receiptRef" label="Nomor nota / kuitansi" rules={[{ required: true, message: 'Nota wajib' }]} extra="Simpan nota aslinya; nomor yang sama tidak bisa dipakai dua kali.">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={preview?.kind === 'voucher' ? `Cetak ${preview.v.number}` : 'Cetak daftar pengisian kembali'}
        open={!!preview}
        onCancel={() => setPreview(null)}
        width={900}
        footer={[
          <Button key="close" onClick={() => setPreview(null)}>
            Tutup
          </Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => printDoc(preview?.kind === 'voucher' ? `Bukti kas kecil ${preview.v.number}` : `Pengisian kembali kas kecil ${fund?.name ?? ''}`)}>
            Cetak / simpan PDF
          </Button>,
        ]}
      >
        {fund && preview?.kind === 'voucher' && <PettyVoucherSheet fund={fund} v={preview.v} />}
        {fund && preview?.kind === 'list' && <PettyReplenishSheet fund={fund} vouchers={(vouchers.data ?? []).filter((x) => x.status === 'OPEN')} />}
      </Modal>

      <Modal title={`Batalkan ${voiding?.number ?? ''}`} open={!!voiding} onCancel={() => setVoiding(null)} onOk={() => voidForm.submit()} confirmLoading={doVoid.isPending} okText="Batalkan bukti" okButtonProps={{ danger: true }}>
        <Form form={voidForm} layout="vertical" onFinish={(v) => voiding && doVoid.mutate({ id: voiding.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        Metode: dana tetap (imprest). Setiap bukti langsung dibebankan (Dr Beban | Cr Kas Kecil); pengisian kembali (Dr Kas Kecil | Cr Kas/Bank) mengembalikan dana ke plafon. Pengeluaran kas kecil tidak bisa dicatat lewat Kas keluar biasa.
      </Typography.Paragraph>
    </>
  );
}
