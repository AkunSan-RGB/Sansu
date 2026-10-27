import { BellOutlined, MailOutlined, TeamOutlined } from '@ant-design/icons';
import type { ReminderSettings } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, InputNumber, Space, Switch } from 'antd';
import { useEffect } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import PolicyCard, { SettingRow, StickySave } from './PolicyCard';

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
      void qc.invalidateQueries({ queryKey: ['reminder-settings'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
  const test = useAction(() => post<{ to: string; items: number }>('/reminders/digest/test'), { success: (r) => `Ringkasan contoh dikirim ke ${r.to} (${r.items} pengingat)` });
  const off = enabled === false;
  const days = (name: keyof ReminderSettings, label: string, min: number, max: number, desc?: string, unit = 'hari') => (
    <SettingRow label={label} desc={desc} dim={off}>
      <Form.Item name={name} noStyle>
        <InputNumber min={min} max={max} suffix={unit || undefined} style={{ width: '100%' }} disabled={off} />
      </Form.Item>
    </SettingRow>
  );
  return (
    <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} requiredMark={false}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <PolicyCard
          icon={<BellOutlined />}
          title="Pengingat di aplikasi"
          desc="SANSU menghitung sendiri hal yang perlu ditindaklanjuti dan menampilkannya di lonceng pojok kanan atas. Tiap pengguna hanya melihat yang sesuai perannya dan bisa menunda pengingat."
        >
          <SettingRow label="Pengingat otomatis" desc={off ? 'Mati: lonceng tidak menampilkan pengingat dari SANSU.' : 'Aktif: lonceng menampilkan hal yang jatuh tempo atau tertunda.'}>
            <Form.Item name="enabled" valuePropName="checked" noStyle>
              <Switch checkedChildren="Aktif" unCheckedChildren="Mati" />
            </Form.Item>
          </SettingRow>
          {days('arLeadDays', 'Piutang mendekati jatuh tempo', 0, 60, 'Diingatkan sekian hari sebelum jatuh tempo. Faktur pelanggan yang sudah lewat jatuh tempo selalu diingatkan.')}
          {days('apLeadDays', 'Utang supplier mendekati jatuh tempo', 0, 60)}
          {days('taxLeadDays', 'Setoran pajak mendekati jatuh tempo', 0, 60)}
          {days('grniDays', 'Barang diterima belum difaktur lebih dari', 1, 180, 'Barang sudah masuk tetapi tagihan supplier belum dicatat.')}
          {days('poDays', 'Pesanan pembelian belum diterima lebih dari', 1, 180)}
          {days('deliveryDays', 'Surat jalan belum difaktur lebih dari', 1, 90, 'Barang sudah dikirim tetapi belum ditagih ke pelanggan.')}
          {days('payrollDay', 'Ingatkan gaji belum diproses mulai tanggal', 1, 28, 'Tanggal dalam bulan berjalan.', '')}
        </PolicyCard>

        <PolicyCard
          icon={<MailOutlined />}
          title="Email"
          desc="Pengiriman email memerlukan SMTP yang sudah diatur di server (lihat panduan server). Tanpa SMTP, pengingat tetap tampil di aplikasi."
        >
          <SettingRow label="Ringkasan harian lewat email" desc="Dikirim sekitar pukul 07.00 WIB ke pemilik, admin, dan keuangan, hanya bila ada hal yang mendesak." dim={off}>
            <Form.Item name="emailDigest" valuePropName="checked" noStyle>
              <Switch checkedChildren="Aktif" unCheckedChildren="Mati" disabled={off} />
            </Form.Item>
          </SettingRow>
          <div style={{ paddingTop: 12 }}>
            <Button loading={test.isPending} onClick={() => test.mutate(undefined)}>
              Kirim ringkasan contoh ke email saya
            </Button>
          </div>
        </PolicyCard>

        <PolicyCard
          icon={<TeamOutlined />}
          title="Pengingat tagihan ke pelanggan"
          desc="Email sopan berisi nomor faktur, jumlah, jatuh tempo, dan rekening pembayaran. Hanya untuk pelanggan yang alamat emailnya diisi."
        >
          <SettingRow label="Kirim otomatis" desc={customerOn ? 'Pelanggan menerima pengingat menurut jadwal di bawah.' : 'Tidak ada email otomatis ke pelanggan.'} dim={off}>
            <Form.Item name="customerReminders" valuePropName="checked" noStyle>
              <Switch checkedChildren="Aktif" unCheckedChildren="Mati" disabled={off} />
            </Form.Item>
          </SettingRow>
          {customerOn && !off ? (
            <>
              {days('customerLeadDays', 'Pengingat pertama sebelum jatuh tempo', 0, 30, '0 = mulai saat jatuh tempo')}
              {days('customerRepeatDays', 'Ulangi tunggakan setiap', 1, 60)}
              {days('customerMaxOverdue', 'Maksimal pengingat tunggakan', 1, 10, 'Per faktur.', 'kali')}
            </>
          ) : (
            <Alert style={{ marginTop: 12 }} type="info" showIcon message="Jadwal pengingat muncul setelah pengiriman otomatis dinyalakan." />
          )}
        </PolicyCard>

        <StickySave loading={save.isPending} />
      </Space>
    </Form>
  );
}
