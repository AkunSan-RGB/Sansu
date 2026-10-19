import { ClockCircleOutlined, SafetyOutlined } from '@ant-design/icons';
import { Alert, Form, type FormInstance, InputNumber, Radio, Space, Typography } from 'antd';
import { useState } from 'react';
import type { PayrollSettings } from '@/api/types';
import { fmtMoney, rupiahInput } from '@/lib/format';
import PolicyCard, { SettingRow, StickySave } from './PolicyCard';

/** Tab Penggajian & BPJS: jam kerja dan lembur, batas upah dan tarif iuran, dengan contoh hitungan langsung */
export default function PayrollSettingsTab({ form, saving, onSave }: { form: FormInstance<PayrollSettings>; saving: boolean; onSave: (v: PayrollSettings) => void }) {
  const [wage, setWage] = useState<number>(5_000_000);
  const v = (Form.useWatch([], form) ?? {}) as Partial<PayrollSettings>;
  const kesBase = Math.min(wage, v.bpjsKesCap ?? wage);
  const jpBase = Math.min(wage, v.jpCap ?? wage);
  const jkk = Math.round((wage * (v.jkkRate ?? 0)) / 100);
  const jkm = Math.round((wage * (v.jkmRate ?? 0)) / 100);
  const perHour = v.overtimeDivisor ? Math.round(wage / v.overtimeDivisor) : 0;

  return (
    <Form form={form} layout="vertical" onFinish={(x) => onSave(x)} requiredMark={false}>
      <Space direction="vertical" size={16} style={{ maxWidth: 860, width: '100%' }}>
        <Alert type="info" showIcon message="Nilai bawaan mengikuti ketentuan 2026. Perbarui bila pemerintah mengubah batas upah, atau bila kelompok risiko JKK perusahaan Anda berbeda." />

        <PolicyCard icon={<ClockCircleOutlined />} title="Jam kerja dan lembur" desc="Dipakai menghitung potongan tidak hadir dan upah lembur di slip gaji.">
          <SettingRow label="Hari kerja per minggu" desc="Menentukan jumlah hari kerja sebulan.">
            <Form.Item name="workDaysPerWeek" noStyle>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 6, label: '6 hari' },
                  { value: 5, label: '5 hari' },
                ]}
              />
            </Form.Item>
          </SettingRow>
          <SettingRow label="Pembagi upah lembur" desc="Ketentuan: 1/173 upah sebulan sebagai upah per jam.">
            <Form.Item name="overtimeDivisor" noStyle>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </SettingRow>
        </PolicyCard>

        <PolicyCard icon={<SafetyOutlined />} title="BPJS" desc="Batas upah dan tarif iuran yang ditanggung perusahaan. Iuran dihitung dari upah yang tidak melebihi batas.">
          <SettingRow label="Batas upah BPJS Kesehatan" desc="Upah di atas batas ini tidak menambah iuran.">
            <Form.Item name="bpjsKesCap" noStyle>
              <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </SettingRow>
          <SettingRow label="Batas upah Jaminan Pensiun" desc="Berubah tiap tahun mengikuti ketentuan pemerintah.">
            <Form.Item name="jpCap" noStyle>
              <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </SettingRow>
          <SettingRow label="Tarif JKK (kecelakaan kerja)" desc="Sesuai kelompok risiko pekerjaan perusahaan Anda.">
            <Form.Item name="jkkRate" noStyle>
              <InputNumber min={0} max={5} step={0.01} suffix="%" style={{ width: '100%' }} />
            </Form.Item>
          </SettingRow>
          <SettingRow label="Tarif JKM (kematian)">
            <Form.Item name="jkmRate" noStyle>
              <InputNumber min={0} max={5} step={0.01} suffix="%" style={{ width: '100%' }} />
            </Form.Item>
          </SettingRow>
        </PolicyCard>

        <PolicyCard icon={<ClockCircleOutlined />} title="Coba hitung" desc="Contoh dari pengaturan di atas (tidak disimpan). Ubah angka upah untuk melihat dasar iuran dan lembur.">
          <Space align="center" wrap style={{ marginBottom: 12 }}>
            <Typography.Text>Upah sebulan</Typography.Text>
            <InputNumber {...rupiahInput} min={0} value={wage} onChange={(x) => setWage(Number(x ?? 0))} prefix="Rp" style={{ width: 200 }} />
          </Space>
          <Space direction="vertical" size={4}>
            <Typography.Text>
              Dasar iuran BPJS Kesehatan: <b>{fmtMoney(kesBase)}</b>
              {wage > (v.bpjsKesCap ?? Infinity) && <Typography.Text type="secondary"> (dibatasi)</Typography.Text>}
            </Typography.Text>
            <Typography.Text>
              Dasar iuran Jaminan Pensiun: <b>{fmtMoney(jpBase)}</b>
              {wage > (v.jpCap ?? Infinity) && <Typography.Text type="secondary"> (dibatasi)</Typography.Text>}
            </Typography.Text>
            <Typography.Text>
              JKK perusahaan: <b>{fmtMoney(jkk)}</b> · JKM perusahaan: <b>{fmtMoney(jkm)}</b> per bulan
            </Typography.Text>
            <Typography.Text>
              Upah per jam lembur (dasar): <b>{fmtMoney(perHour)}</b>
            </Typography.Text>
          </Space>
        </PolicyCard>

        <StickySave loading={saving} />
      </Space>
    </Form>
  );
}
