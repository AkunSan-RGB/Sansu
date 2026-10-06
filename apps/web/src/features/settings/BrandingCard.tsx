import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Space, Typography, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { patch } from '@/api/client';
import { useAction } from '@/api/queries';
import { type LetterheadData, useLetterhead } from '@/components/print/Letterhead';
import { t } from '@/lib/terms';

/** Perkecil logo di browser (maks. 600×200 px) agar ringan di setiap dokumen */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    const scale = Math.min(1, 600 / img.width, 200 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/png');
    if (out.length > 300_000) out = c.toDataURL('image/jpeg', 0.85);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function BrandingCard() {
  const { message } = App.useApp();
  const { data } = useLetterhead();
  const [form] = Form.useForm();
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (data) {
      form.setFieldsValue(data);
      setLogo(data.logo);
    }
  }, [data, form]);
  const save = useAction((v: Partial<LetterheadData>) => patch('/settings/branding', { ...v, logo: logo ?? '' }), {
    success: 'Kop surat disimpan — berlaku di faktur, surat jalan, PO, dan penawaran',
    invalidate: ['letterhead', 'company'],
  });

  return (
    <Card title="Kop surat & dokumen">
      <Typography.Paragraph type="secondary">{t('Tampil di faktur, surat jalan, purchase order, dan penawaran harga yang dicetak atau dikirim.')}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item label="Logo perusahaan" extra="PNG/JPG, latar transparan lebih rapi. Otomatis diperkecil.">
          <Space align="center" wrap>
            <div style={{ width: 180, height: 72, border: '1px dashed #cbd5e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
              {logo ? <img src={logo} alt="Logo" style={{ maxWidth: 170, maxHeight: 64, objectFit: 'contain' }} /> : <Typography.Text type="secondary">Belum ada logo</Typography.Text>}
            </div>
            <Upload
              accept="image/png,image/jpeg,image/webp"
              showUploadList={false}
              beforeUpload={async (f) => {
                if (f.size > 5_000_000) message.error('File terlalu besar (maks. 5 MB)');
                else
                  try {
                    setLogo(await shrinkLogo(f));
                  } catch {
                    message.error('Gambar tidak bisa dibaca');
                  }
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>{logo ? 'Ganti logo' : 'Unggah logo'}</Button>
            </Upload>
            {logo && <Button icon={<DeleteOutlined />} onClick={() => setLogo(null)} aria-label="Hapus logo" />}
          </Space>
        </Form.Item>
        <Space.Compact block>
          <Form.Item name="phone" label="Telepon / WA" style={{ flex: 1, marginRight: 12 }}>
            <Input placeholder="021-555 1234" />
          </Form.Item>
          <Form.Item name="email" label="Email" style={{ flex: 1 }}>
            <Input placeholder="admin@perusahaan.co.id" />
          </Form.Item>
        </Space.Compact>
        <Form.Item name="bankInfo" label="Rekening pembayaran" extra={t('Dicetak di faktur dan disertakan di pesan WhatsApp tagihan')}>
          <Input.TextArea rows={2} placeholder={'BCA 123-456-7890 a.n. PT Maju Jaya\nMandiri 987-000-1234 a.n. PT Maju Jaya'} maxLength={500} />
        </Form.Item>
        <Form.Item name="invoiceNote" label={t('Catatan di bawah faktur')}>
          <Input.TextArea rows={2} placeholder="Barang yang sudah dibeli tidak dapat dikembalikan kecuali rusak dari pabrik." maxLength={500} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Simpan kop surat
        </Button>
      </Form>
    </Card>
  );
}
