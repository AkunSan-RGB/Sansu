import { useQuery } from '@tanstack/react-query';
import { WalletOutlined } from '@ant-design/icons';
import { Alert, Button, Col, Form, Input, InputNumber, Row, Select, Space, Tag } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, put } from '@/api/client';
import { LEDGER_KEYS, useAction, useCashAccounts } from '@/api/queries';
import { fmtMoney, rupiahInput } from '@/lib/format';
import PolicyCard from './PolicyCard';

type Fund = {
  id: string;
  accountId: string;
  fundingAccountId: string;
  name: string;
  custodianName: string;
  imprestAmount: string;
  maxVoucher: string;
  balance: string;
  openCount: number;
};

/**
 * Kebijakan kas kecil (sistem dana tetap): plafon, batas per bukti, juru kas, dan sumber pengisian.
 * Pencatatan bukti dan pengisian kembali ada di Kas & Bank › Kas kecil.
 */
export default function PettyCashPolicyCard() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const cash = useCashAccounts();
  const funds = useQuery({ queryKey: ['petty', 'funds'], queryFn: () => get<Fund[]>('/petty-cash/funds') });
  const fund = funds.data?.[0];
  const imprest = Form.useWatch('imprestAmount', form) as number | undefined;
  const maxVoucher = Form.useWatch('maxVoucher', form) as number | undefined;

  useEffect(() => {
    if (funds.isLoading || !cash.data) return;
    const petty = cash.data.find((a) => a.code === '1-1110') ?? cash.data[0];
    const main = cash.data.find((a) => a.code === '1-1100');
    form.setFieldsValue(
      fund
        ? { accountId: fund.accountId, fundingAccountId: fund.fundingAccountId, name: fund.name, custodianName: fund.custodianName, imprestAmount: Number(fund.imprestAmount), maxVoucher: Number(fund.maxVoucher) }
        : { accountId: petty?.id, fundingAccountId: main?.id, name: 'Kas Kecil', imprestAmount: 2_000_000, maxVoucher: 200_000 },
    );
  }, [fund, cash.data, funds.isLoading, form]);

  const save = useAction((v: Record<string, unknown>) => put('/petty-cash/funds', v), {
    success: 'Kebijakan kas kecil disimpan',
    invalidate: [...LEDGER_KEYS, 'petty'],
  });
  const tooBig = !!imprest && !!maxVoucher && maxVoucher > imprest * 0.25;

  return (
    <PolicyCard
      id="kebijakan-kas-kecil"
      icon={<WalletOutlined />}
      title="Kas kecil (dana tetap)"
      desc="Dana ditetapkan sebesar plafon dan dipegang satu juru kas. Pengeluaran dicatat dengan bukti (nota wajib), lalu pengisian kembali mengembalikan dana ke plafon. Kas kecil + bukti belum diganti harus sama dengan plafon."
      tag={fund ? <Tag color="green">Aktif</Tag> : <Tag>Belum dibuat</Tag>}
      footer={
        <>
          <span style={{ opacity: 0.7 }}>Pengisian dana awal dan pencatatan bukti ada di Kas & Bank › Kas kecil.</span>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Simpan
          </Button>
        </>
      }
    >
      {fund && (
        <Space wrap style={{ marginBottom: 14 }}>
          <Tag color="blue">Saldo kas kecil {fmtMoney(fund.balance)}</Tag>
          <Tag color={fund.openCount ? 'orange' : 'green'}>{fund.openCount} bukti belum diganti</Tag>
          <Button size="small" onClick={() => navigate('/petty-cash')}>
            Buka Kas Kecil
          </Button>
        </Space>
      )}
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate({ ...v, imprestAmount: String(v.imprestAmount), maxVoucher: String(v.maxVoucher) })}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Nama dana" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="custodianName" label="Juru kas (pemegang dana)" rules={[{ required: true }]} extra="Satu orang yang bertanggung jawab; sebaiknya bukan pemberi persetujuan.">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="accountId" label="Akun kas kecil" rules={[{ required: true }]} extra={fund ? 'Akun tidak bisa diganti setelah dana dibuat.' : undefined}>
              <Select disabled={!!fund} options={cash.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="fundingAccountId" label="Sumber pengisian (kas besar / bank)" rules={[{ required: true }]}>
              <Select options={cash.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="imprestAmount" label="Dana tetap (plafon)" rules={[{ required: true }]} extra="Sebesar kebutuhan 2–4 minggu. Dana diisi ulang sampai nilai ini.">
              <InputNumber {...rupiahInput} min={1} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="maxVoucher" label="Batas nilai per bukti" rules={[{ required: true }]} extra="Pengeluaran lebih besar dicatat lewat Kas keluar dengan persetujuan. Umumnya 5–10% dari plafon.">
              <InputNumber {...rupiahInput} min={1} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
        </Row>
        {tooBig && <Alert type="warning" showIcon message="Batas per bukti lebih dari 25% plafon" description="Satu bukti bisa menghabiskan sebagian besar dana. Pertimbangkan batas 5–10% dari plafon." />}
      </Form>
    </PolicyCard>
  );
}
