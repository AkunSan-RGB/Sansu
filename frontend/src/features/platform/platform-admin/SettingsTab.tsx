import { MailOutlined } from '@ant-design/icons';
import { type Plan } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import { KEYS, PSettings } from './shared';

export function SettingsTab() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: [...KEYS, 'settings'], queryFn: () => get<PSettings>('/platform-admin/settings') });
  const plans = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const save = useAction((v: Partial<PSettings>) => put('/platform-admin/settings', v), {
    success: 'Pengaturan disimpan',
    invalidate: KEYS,
  });
  const [to, setTo] = useState(me?.email ?? '');
  const test = useAction(() => post('/platform-admin/test-email', { to }), { success: `Email uji terkirim ke ${to}` });
  const mailCheck = useAction(() => get<{ from: string; domain: string | null; checks: { key: string; title: string; status: 'OK' | 'WARN' | 'ERROR'; message: string }[] }>('/platform-admin/mail-check'));
  const reminders = useAction(() => post<{ checked: number; sent: number }>('/platform-admin/run-reminders'), {
    success: (r) => `${r.checked} langganan diperiksa, ${r.sent} pengingat dikirim`,
  });
  return (
    <QueryState q={q}>
      {(s) => (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card title="Langganan">
              <Space align="start" size={16} wrap>
                <Switch
                  checked={s.enabled}
                  loading={save.isPending}
                  onChange={(on) =>
                    on
                      ? Modal.confirm({
                          title: 'Nyalakan langganan?',
                          content: 'Perusahaan baru mendapat uji coba, paket membatasi pengguna/gudang, dan perusahaan yang masa aktifnya habis menjadi baca saja. Perusahaan yang sudah terdaftar tanpa langganan tetap tanpa batas sampai Anda memberinya paket.',
                          okText: 'Nyalakan',
                          onOk: () => save.mutateAsync({ enabled: true }),
                        })
                      : save.mutate({ enabled: false })
                  }
                />
                <div>
                  <Typography.Text strong>{s.enabled ? 'Langganan aktif' : 'Langganan dimatikan — mode uji'}</Typography.Text>
                  <div style={{ color: '#6b7280', fontSize: 13, maxWidth: 640 }}>
                    {s.enabled
                      ? 'Uji coba, batas paket, tagihan, dan mode baca saja berlaku. Matikan untuk kembali ke mode uji.'
                      : 'Semua perusahaan memakai SANSU tanpa uji coba, batas paket, tagihan, atau penguncian; menu Langganan dan banner disembunyikan. Data paket dan tagihan tidak dihapus.'}
                  </div>
                </div>
              </Space>
            </Card>
          </Col>
          {!s.enabled && (
            <Col xs={24}>
              <Alert type="info" showIcon message="Pengaturan pembayaran di bawah baru berlaku setelah langganan dinyalakan." />
            </Col>
          )}
          <Col xs={24} lg={14}>
            <Card title="Pembayaran & uji coba">
              <Form
                layout="vertical"
                initialValues={s}
                onFinish={(v: Partial<PSettings>) =>
                  save.mutate({
                    ...v,
                    trialDays: Number(v.trialDays),
                    graceDays: Number(v.graceDays),
                    renewalNoticeDays: Number(v.renewalNoticeDays),
                    vatRate: Number(v.vatRate ?? 11),
                    vatEnabled: !!v.vatEnabled,
                  })
                }
              >
                <Typography.Text strong>Rekening untuk transfer manual</Typography.Text>
                <Row gutter={12} style={{ marginTop: 8 }}>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankName" label="Bank">
                      <Input placeholder="BCA" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankAccount" label="No. rekening">
                      <Input placeholder="1234567890" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankHolder" label="Atas nama">
                      <Input placeholder="PT SANSU ..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="supportWhatsapp" label="WhatsApp dukungan">
                      <Input placeholder="0812..." />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="trialDays" label="Lama uji coba (hari)">
                      <InputNumber min={0} max={90} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="trialPlanCode" label="Paket saat uji coba">
                      <Select options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="graceDays" label="Masa tenggang (hari)" extra="Setelah habis, sebelum baca saja">
                      <InputNumber min={0} max={30} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item
                      name="renewalNoticeDays"
                      label="Tagihan perpanjangan dibuat"
                      extra="Hari sebelum berakhir"
                    >
                      <InputNumber min={1} max={30} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Typography.Text strong>Penjual & PPN (tampil di invoice langganan)</Typography.Text>
                <Row gutter={12} style={{ marginTop: 8 }}>
                  <Col xs={24} md={12}>
                    <Form.Item name="sellerName" label="Nama badan usaha">
                      <Input placeholder="PT SANSU GLOBAL INTI" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="sellerNpwp" label="NPWP">
                      <Input placeholder="0000 0000 0000 0000" />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item name="sellerAddress" label="Alamat">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="vatEnabled" label="Kenakan PPN (PKP)" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="vatRate" label="Tarif PPN efektif (%)" extra="12% × DPP 11/12 = 11%">
                      <InputNumber min={0} max={20} step={0.5} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="PPN hanya dikenakan pada tagihan baru. Harga paket = DPP; PPN ditambahkan di atasnya. Rekap bulanan ada di tab Laporan PPN."
                    />
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={save.isPending}>
                  Simpan
                </Button>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="Email (SMTP)">
                {s.smtp.configured ? (
                  <Tag color="green">Aktif · pengirim {s.smtp.from}</Tag>
                ) : (
                  <Tag color="orange">Belum diatur</Tag>
                )}
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  Diatur di file .env server: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL. Contoh
                  gratis: Brevo (300 email/hari).
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@anda.com" />
                  <Button icon={<MailOutlined />} loading={test.isPending} onClick={() => test.mutate(undefined)}>
                    Kirim email uji
                  </Button>
                </Space.Compact>
                <Button style={{ marginTop: 12 }} loading={mailCheck.isPending} onClick={() => mailCheck.mutate(undefined)}>
                  Periksa kesiapan email (anti-spam)
                </Button>
                {mailCheck.data && (
                  <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
                    {mailCheck.data.checks.map((c) => (
                      <Alert key={c.key} showIcon type={c.status === 'OK' ? 'success' : c.status === 'WARN' ? 'warning' : 'error'} message={c.title} description={c.message} />
                    ))}
                  </Space>
                )}
              </Card>
              <Card title="Pembayaran online">
                {s.gateway ? (
                  <Tag color="green">{s.gateway} aktif</Tag>
                ) : (
                  <Tag color="orange">Belum aktif — transfer manual</Tag>
                )}
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  Midtrans: MIDTRANS_SERVER_KEY (+ MIDTRANS_PRODUCTION=true). URL notifikasi:{' '}
                  <Typography.Text code>{window.location.origin}/api/billing/webhooks/midtrans</Typography.Text>
                  <br />
                  Xendit: XENDIT_SECRET_KEY + XENDIT_CALLBACK_TOKEN. URL callback:{' '}
                  <Typography.Text code>{window.location.origin}/api/billing/webhooks/xendit</Typography.Text>
                </Typography.Paragraph>
              </Card>
              <Card title="Pengingat otomatis">
                <Typography.Paragraph type="secondary">
                  Setiap jam SANSU mengirim pengingat uji coba (3 hari sebelum & saat berakhir) dan membuat tagihan
                  perpanjangan otomatis.
                </Typography.Paragraph>
                <Button loading={reminders.isPending} onClick={() => reminders.mutate(undefined)}>
                  Jalankan sekarang
                </Button>
              </Card>
            </Space>
          </Col>
        </Row>
      )}
    </QueryState>
  );
}
