import { CopyOutlined, CreditCardOutlined, UploadOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { BILLING_STATUS_LABELS, BRAND, type BillingInvoice, type BillingOverview } from '@sansu/shared';
import { Alert, App, Button, Card, Col, Descriptions, Input, Row, Space, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CYCLE, INV_COLOR } from './shared';

const readFile = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('File tidak bisa dibaca'));
    r.readAsDataURL(f);
  });

export function OpenInvoice({ inv, payment }: { inv: BillingInvoice; payment: BillingOverview['payment'] }) {
  const { message } = App.useApp();
  const [proof, setProof] = useState<{ data: string; name: string }>();
  const [note, setNote] = useState('');
  const pay = useAction(() => post<{ url: string }>(`/billing/invoices/${inv.id}/pay`), {
    onSuccess: (r) => (window.location.href = r.url),
  });
  const send = useAction(
    () => post(`/billing/invoices/${inv.id}/proof`, { proof: proof!.data, note: note || undefined }),
    {
      success: 'Bukti transfer terkirim. Kami akan mengonfirmasi secepatnya.',
      invalidate: ['billing'],
      onSuccess: () => setProof(undefined),
    },
  );
  const cancel = useAction(() => post(`/billing/invoices/${inv.id}/cancel`), {
    success: 'Tagihan dibatalkan',
    invalidate: ['billing'],
  });
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => message.success('Disalin'));

  return (
    <Card
      title={
        <Space>
          <CreditCardOutlined />
          Tagihan {inv.number}
          <Tag color={INV_COLOR[inv.status]}>{BILLING_STATUS_LABELS[inv.status]}</Tag>
        </Space>
      }
      extra={
        inv.status === 'UNPAID' && (
          <Button type="link" danger onClick={() => cancel.mutate(undefined)}>
            Batalkan
          </Button>
        )
      }
      styles={{ header: { background: BRAND.colors.primarySoft } }}
    >
      <Row gutter={[24, 16]}>
        <Col xs={24} md={9}>
          <Typography.Text type="secondary">Total dibayar</Typography.Text>
          <div style={{ fontSize: 30, fontWeight: 700, color: BRAND.colors.mark, letterSpacing: '-0.01em' }}>
            {fmtMoney(inv.amount)}
          </div>
          <Typography.Text>
            {inv.planName} · {CYCLE[inv.cycle]} · jatuh tempo {fmtDate(inv.dueDate)}
          </Typography.Text>
          {Number(inv.vatAmount) > 0 && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              DPP {fmtMoney(inv.subtotal)} + PPN {Number(inv.vatRate)}% {fmtMoney(inv.vatAmount)}
            </div>
          )}
        </Col>
        <Col xs={24} md={15}>
          {inv.status === 'WAITING' ? (
            <Alert
              type="info"
              showIcon
              message="Bukti transfer sudah diterima"
              description="Kami sedang memeriksa pembayaran Anda. Langganan aktif otomatis setelah dikonfirmasi, dan Anda akan menerima email."
            />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {inv.rejectReason && (
                <Alert
                  type="warning"
                  showIcon
                  message="Bukti sebelumnya belum bisa diterima"
                  description={inv.rejectReason}
                />
              )}
              {payment.gateway && (
                <Button
                  type="primary"
                  size="large"
                  icon={<CreditCardOutlined />}
                  loading={pay.isPending}
                  onClick={() => pay.mutate(undefined)}
                >
                  Bayar online — Virtual Account, QRIS, e-wallet
                </Button>
              )}
              {payment.bank ? (
                <>
                  <Typography.Text strong>
                    {payment.gateway ? 'Atau transfer manual ke:' : 'Transfer ke rekening:'}
                  </Typography.Text>
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="Bank">{payment.bank.name}</Descriptions.Item>
                    <Descriptions.Item label="No. rekening">
                      <Space>
                        <Typography.Text strong copyable={false}>
                          {payment.bank.account}
                        </Typography.Text>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copy(payment.bank!.account)} />
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Atas nama">{payment.bank.holder}</Descriptions.Item>
                    <Descriptions.Item label="Jumlah">
                      <Space>
                        <Typography.Text strong>{fmtMoney(inv.amount)}</Typography.Text>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => copy(String(Math.round(Number(inv.amount))))}
                        />
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                  <Space wrap>
                    <Upload
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      showUploadList={false}
                      beforeUpload={async (f) => {
                        if (f.size > 2 * 1024 * 1024) {
                          message.error(
                            'File terlalu besar (maks. 2 MB). Kirim foto/tangkapan layar yang lebih kecil.',
                          );
                          return Upload.LIST_IGNORE;
                        }
                        setProof({ data: await readFile(f), name: f.name });
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />}>{proof ? 'Ganti file' : 'Pilih bukti transfer'}</Button>
                    </Upload>
                    {proof && <Typography.Text type="secondary">{proof.name}</Typography.Text>}
                  </Space>
                  {proof && (
                    <>
                      <Input
                        placeholder="Catatan (mis. transfer dari BCA a.n. Budi)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={300}
                      />
                      <Button type="primary" loading={send.isPending} onClick={() => send.mutate(undefined)}>
                        Kirim bukti transfer
                      </Button>
                    </>
                  )}
                </>
              ) : (
                !payment.gateway && (
                  <Alert
                    type="info"
                    showIcon
                    message="Instruksi pembayaran segera dikirim"
                    description={
                      payment.supportWhatsapp ? (
                        <a
                          href={`https://wa.me/${payment.supportWhatsapp.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(`Halo SANSU, saya ingin membayar tagihan ${inv.number}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <WhatsAppOutlined /> Hubungi tim SANSU lewat WhatsApp
                        </a>
                      ) : (
                        'Tim SANSU akan menghubungi Anda untuk cara pembayaran.'
                      )
                    }
                  />
                )
              )}
            </Space>
          )}
        </Col>
      </Row>
    </Card>
  );
}
