import { BASE_CURRENCY, FOREIGN_CURRENCIES, isForeignCurrency } from '@sansu/shared';
import { Alert, Col, Form, InputNumber, Row, Select } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect } from 'react';
import { get } from '@/api/client';
import { fmtRate } from '@/lib/format';

/**
 * Pilihan mata uang dokumen + kurs. Kurs terisi otomatis dari kurs tersimpan (Pengaturan › Kurs mata uang) pada tanggal dokumen
 * dan boleh ditimpa. Form harus punya kolom `currency`, `fxRate`, dan `date`.
 */
export default function CurrencyFields({ form }: { form: FormInstance }) {
  const currency: string = Form.useWatch('currency', form) ?? BASE_CURRENCY;
  const date: string | undefined = Form.useWatch('date', form);
  const rate: number | undefined = Form.useWatch('fxRate', form);

  useEffect(() => {
    if (!isForeignCurrency(currency)) {
      form.setFieldValue('fxRate', undefined);
      return;
    }
    let cancelled = false;
    get<{ rate: string | null }>(`/fx/rate?currency=${currency}${date ? `&date=${date}` : ''}`)
      .then((r) => !cancelled && form.setFieldValue('fxRate', r.rate ? Number(r.rate) : undefined))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currency, date, form]);

  return (
    <>
      <Row gutter={16}>
        <Col xs={24} md={10}>
          <Form.Item name="currency" label="Mata uang" extra="Rupiah, atau mata uang asing untuk ekspor/impor. Harga diketik dalam mata uang ini.">
            <Select
              options={[{ value: BASE_CURRENCY, label: 'IDR · Rupiah' }, ...FOREIGN_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
            />
          </Form.Item>
        </Col>
        {isForeignCurrency(currency) && (
          <Col xs={24} md={8}>
            <Form.Item name="fxRate" label={`Kurs (Rp per 1 ${currency})`} rules={[{ required: true, message: 'Isi kurs' }]}>
              <InputNumber min={0.000001} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
        )}
      </Row>
      {isForeignCurrency(currency) && !rate && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Kurs ${currency} belum tersimpan. Ketik kurs di atas, atau isi di Pengaturan › Kurs mata uang.`} />
      )}
      {isForeignCurrency(currency) && !!rate && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Nilai Rupiah dihitung pada kurs Rp ${fmtRate(rate)}. PPN dihitung dari DPP Rupiah; selisih kurs timbul saat pelunasan.`} />
      )}
    </>
  );
}
