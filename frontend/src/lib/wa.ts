import { fmtDate, fmtMoney } from './format';

/** Nomor HP Indonesia → tautan wa.me (0812… → 62812…). Kosong bila nomor tidak ada. */
export const waLink = (phone?: string | null, text?: string) => {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '62');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
};

export const hasPhone = (phone?: string | null) => (phone ?? '').replace(/\D/g, '').length >= 8;

/** Pesan tagihan faktur (dikirim dari HP/WA Web pengguna; PDF dilampirkan manual bila perlu) */
export function invoiceMessage(p: {
  customer: string;
  number: string;
  date: string;
  dueDate: string;
  total: string | number;
  outstanding: string | number;
  company: string;
  bankInfo?: string;
  overdue?: boolean;
}) {
  const lines = [
    `Yth. ${p.customer},`,
    '',
    p.overdue
      ? `Kami mengingatkan faktur *${p.number}* tanggal ${fmtDate(p.date)} telah jatuh tempo pada ${fmtDate(p.dueDate)}.`
      : `Berikut kami sampaikan faktur *${p.number}* tanggal ${fmtDate(p.date)}.`,
    `Total: *${fmtMoney(p.total)}*`,
    Number(p.outstanding) !== Number(p.total) ? `Sisa tagihan: *${fmtMoney(p.outstanding)}*` : '',
    `Jatuh tempo: ${fmtDate(p.dueDate)}`,
    p.bankInfo ? `\nPembayaran dapat ditransfer ke:\n${p.bankInfo}` : '',
    '',
    'Terima kasih atas kerja samanya.',
    p.company,
  ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
