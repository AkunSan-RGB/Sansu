import { Alert, Form, InputNumber } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect } from 'react';
import { get } from '@/api/client';
import { useCashAccounts } from '@/api/queries';
import { fmtCurrency, fmtMoney, fmtRate } from '@/lib/format';

/**
 * Pelunasan faktur valas: kurs hari bayar (terisi dari kurs tersimpan) dan pratinjau kas serta laba/rugi kurs.
 * `receivable` true = piutang (kas lebih besar dari nilai tercatat = laba); false = utang (kas lebih besar = rugi).
 * Pratinjau saja; angka final dihitung server.
 */
export default function FxPaymentFields({
  form,
  currency,
  invoiceRate,
  outstandingForeign,
  outstandingIdr,
  receivable,
}: {
  form: FormInstance;
  currency: string;
  invoiceRate: number;
  outstandingForeign: number;
  outstandingIdr: number;
  receivable: boolean;
}) {
  const amount: number = Form.useWatch('amount', form) ?? 0;
  const rate: number = Form.useWatch('fxRate', form) ?? 0;
  const date: string | undefined = Form.useWatch('date', form);
  const accountId: string | undefined = Form.useWatch('cashAccountId', form);
  const accounts = useCashAccounts('all').data;
  const foreignAccount = !!accountId && accounts?.find((a) => a.id === accountId)?.currency === currency;

  useEffect(() => {
    let cancelled = false;
    get<{ rate: string | null }>(`/fx/rate?currency=${currency}${date ? `&date=${date}` : ''}`)
      .then((r) => !cancelled && form.setFieldValue('fxRate', r.rate ? Number(r.rate) : undefined))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currency, date, form]);

  const final = amount >= outstandingForeign - 0.004;
  const carrying = final ? outstandingIdr : Math.round(amount * invoiceRate);
  const cash = Math.round(amount * rate);
  const diff = cash - carrying;
  const gain = receivable ? diff > 0 : diff < 0;

  // pembayaran utang dari rekening valas: Rupiah yang keluar = biaya rata-rata saldo rekening (bukan kurs yang diketik)
  if (foreignAccount && !receivable) {
    return <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Dibayar dari rekening ${currency}: Rupiah yang keluar mengikuti biaya rata-rata saldo rekening; selisih terhadap nilai utang (kurs faktur ${fmtRate(invoiceRate)}) dicatat sebagai laba/rugi kurs terealisasi.`} />;
  }
  return (
    <>
      <Form.Item name="fxRate" label={`Kurs hari pembayaran (Rp per 1 ${currency})`} rules={[{ required: true, message: 'Isi kurs' }]}>
        <InputNumber min={0.000001} style={{ width: '100%' }} prefix="Rp" />
      </Form.Item>
      {!!amount && !!rate && (
        <Alert
          type={diff === 0 ? 'info' : gain ? 'success' : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
          message={`${fmtCurrency(amount, currency)} × kurs ${fmtRate(rate)} = ${fmtMoney(cash)} ${receivable ? 'diterima' : 'dibayar'}; nilai tercatat ${fmtMoney(carrying)} (kurs faktur ${fmtRate(invoiceRate)})`}
          description={diff === 0 ? 'Tidak ada selisih kurs.' : `${gain ? 'Laba' : 'Rugi'} selisih kurs terealisasi ${fmtMoney(Math.abs(diff))}`}
        />
      )}
    </>
  );
}
