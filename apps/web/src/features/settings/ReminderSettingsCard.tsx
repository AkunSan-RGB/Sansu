import type { ReminderSettings } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Divider, Form, InputNumber, Row, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';

/** Pengingat otomatis: apa yang diingatkan, seberapa awal, dan pengiriman lewat email (ringkasan harian, tagihan ke pelanggan) */
export default function ReminderSettingsCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm<ReminderSettings>();
  const enabled = Form.useWatch('enabled', form);
  const customerOn = Form.useWatch('customerReminders', form);
  const { data } = useQuery({ queryKey: ['reminder-settings'], queryFn: () => get<ReminderSettings>('/settings/reminders') });
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useAction((v: ReminderSettings) => put<ReminderSettings>('/settings/reminders', v), {
    success: 'Pengaturan pengingat disimpan',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminder-settings'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
  const test = useAction(() => post<{ to: string; items: number }>('/reminders/digest/test'), { success: (r) => `Ringkasan contoh dikirim ke ${r.to} (${r.items} pengingat)` });
  const days = (name: keyof ReminderSettings, label: string, min: number, max: number, extra?: string) => (
    <Form.Item name={name} label={label} extra={extra}>
      <InputNumber min={min} max={max} suffix="hari" style={{ width: '100%' }} />
    </Form.Item>
  );
  return (
    <Card>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} requiredMark={false}>
        <Form.Item name="enabled" valuePropName="checked" style={{ marginBottom: 4 }}>
          <Switch checkedChildren="Pengingat aktif" unCheckedChildren="Pengingat mati" />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          SANSU menghitung sendiri hal yang perlu ditindaklanjuti dan menampilkannya di lonceng di pojok kanan atas. Tiap pengguna hanya melihat yang sesuai perannya dan bisa menunda pengingat.
        </Typography.Paragraph>
        <Divider orientation="left" plain>
          Kapan diingatkan
        </Divider>
        <Row gutter={16}>
          <Col xs={24} md={8}>{days('arLeadDays', 'Piutang mendekati jatuh tempo', 0, 60, 'Faktur pelanggan yang lewat jatuh tempo selalu diingatkan')}</Col>
          <Col xs={24} md={8}>{days('apLeadDays', 'Utang supplier mendekati jatuh tempo', 0, 60)}</Col>
          <Col xs={24} md={8}>{days('taxLeadDays', 'Setoran pajak mendekati jatuh tempo', 0, 60)}</Col>
          <Col xs={24} md={8}>{days('grniDays', 'Barang diterima belum difaktur lebih dari', 1, 180)}</Col>
          <Col xs={24} md={8}>{days('poDays', 'Pesanan pembelian belum diterima lebih dari', 1, 180)}</Col>
          <Col xs={24} md={8}>{days('deliveryDays', 'Surat jalan belum difaktur lebih dari', 1, 90)}</Col>
          <Col xs={24} md={8}>
            <Form.Item name="payrollDay" label="Ingatkan gaji belum diproses mulai tanggal">
              <InputNumber min={1} max={28} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain>
          Email
        </Divider>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Pengiriman email memerlukan SMTP yang sudah diatur di server (lihat panduan server). Tanpa SMTP, pengingat tetap tampil di aplikasi." />
        <Form.Item name="emailDigest" valuePropName="checked" extra="Dikirim sekitar pukul 07.00 WIB ke pemilik, admin, dan keuangan, hanya bila ada hal yang mendesak.">
          <Switch checkedChildren="Ringkasan harian lewat email" unCheckedChildren="Ringkasan harian mati" />
        </Form.Item>
        <Space wrap style={{ marginBottom: 8 }}>
          <Button loading={test.isPending} onClick={() => test.mutate(undefined)}>
            Kirim ringkasan contoh ke email saya
          </Button>
        </Space>
        <Divider orientation="left" plain>
          Pengingat tagihan ke pelanggan
        </Divider>
        <Form.Item name="customerReminders" valuePropName="checked" extra="Email sopan berisi nomor faktur, jumlah, jatuh tempo, dan rekening pembayaran. Hanya untuk pelanggan yang alamat emailnya diisi.">
          <Switch checkedChildren="Kirim otomatis" unCheckedChildren="Tidak otomatis" />
        </Form.Item>
        {customerOn && enabled !== false && (
          <Row gutter={16}>
            <Col xs={24} md={8}>{days('customerLeadDays', 'Pengingat pertama sebelum jatuh tempo', 0, 30, '0 = mulai saat jatuh tempo')}</Col>
            <Col xs={24} md={8}>{days('customerRepeatDays', 'Ulangi tunggakan setiap', 1, 60)}</Col>
            <Col xs={24} md={8}>
              <Form.Item name="customerMaxOverdue" label="Maksimal pengingat tunggakan" extra="Per faktur">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        )}
        <div className="save-bar">
          <Button type="primary" htmlType="submit" size="large" loading={save.isPending}>
            Simpan perubahan
          </Button>
        </div>
      </Form>
    </Card>
  );
}
