import { Typography } from 'antd';
const plain = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const fmtMoney = (n: number) => plain.format(Math.round(n));

/** Format akuntansi: angka negatif dalam kurung, nol ditampilkan sebagai "-" */
export function acc(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  if (!n) return '-';
  return n < 0 ? `(${fmtMoney(-n)})` : fmtMoney(n);
}

/** Sel angka rata kanan dengan gaya tebal/garis sesuai jenis baris */
export function Amount({ v, strong, double }: { v: string | number | null | undefined; strong?: boolean; double?: boolean }) {
  const text = acc(v);
  const style: React.CSSProperties = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  if (double && text !== '-') style.borderBottom = '3px double currentColor';
  return strong ? (
    <Typography.Text strong style={style}>
      {text}
    </Typography.Text>
  ) : (
    <span style={style}>{text}</span>
  );
}

export const year = (d: string) => Number(d.slice(0, 4));
export const longDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

export interface Signer {
  name: string;
  city?: string | null;
  directorName?: string | null;
  directorTitle?: string | null;
}

/** Blok tanda tangan laporan (Posisi Keuangan dan Laba Rugi); CALK tidak ditandatangani */
export function SignatureBlock({ signer, year: y }: { signer?: Signer; year: number }) {
  if (!signer) return null;
  return (
    <div className="signature-block" style={{ marginTop: 40, textAlign: 'right', breakInside: 'avoid' }}>
      <Typography.Paragraph>
        {signer.city || '……………'}, {longDate(`${y + 1}-03-31`).replace(/^\d+/, '…')}
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 64 }}>{signer.name}</Typography.Paragraph>
      <Typography.Paragraph strong style={{ marginBottom: 0, textDecoration: 'underline' }}>
        {signer.directorName || '(nama)'}
      </Typography.Paragraph>
      <Typography.Paragraph>{signer.directorTitle}</Typography.Paragraph>
    </div>
  );
}
