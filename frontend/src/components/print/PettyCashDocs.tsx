import { fmtDate, fmtMoney, today } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { cell, DocHeader, head, PrintSheet, Signatures } from './Letterhead';

export interface PettyFundInfo {
  name: string;
  custodianName: string;
  imprestAmount: string;
  balance: string;
  openVouchers: string;
}
export interface PettyVoucherInfo {
  number: string;
  date: string;
  payee: string;
  description: string;
  amount: string;
  receiptRef: string;
  status: 'OPEN' | 'REPLENISHED' | 'VOID';
  expenseAccount: { code: string; name: string } | null;
}

const row = (label: string, value: React.ReactNode, strong = false) => (
  <tr>
    <td style={{ ...cell, width: 170, color: '#64748b' }}>{label}</td>
    <td style={{ ...cell, fontWeight: strong ? 700 : 500, fontSize: strong ? 16 : 13 }}>{value}</td>
  </tr>
);

/** Bukti kas kecil: satu lembar per pengeluaran, ditandatangani penerima, juru kas, dan pemberi persetujuan */
export function PettyVoucherSheet({ fund, v }: { fund: PettyFundInfo; v: PettyVoucherInfo }) {
  return (
    <PrintSheet>
      <DocHeader title="BUKTI KAS KECIL" meta={[['No.', v.number], ['Tanggal', fmtDate(v.date)], ['No. nota', v.receiptRef]]} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <tbody>
          {row('Dana kas kecil', fund.name)}
          {row('Dibayarkan kepada', v.payee)}
          {row('Untuk keperluan', v.description)}
          {row('Dibebankan ke akun', v.expenseAccount ? `${v.expenseAccount.code} · ${v.expenseAccount.name}` : '-')}
          {row('Jumlah', fmtMoney(v.amount), true)}
          {row('Terbilang', <em>{terbilang(v.amount)}</em>)}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Lampirkan nota/kuitansi asli bernomor {v.receiptRef} pada bukti ini. {v.status === 'VOID' && 'BUKTI INI DIBATALKAN.'}</div>
      <Signatures labels={[['Penerima'], [`Juru kas`, fund.custodianName], ['Disetujui']]} />
    </PrintSheet>
  );
}

/** Daftar bukti yang diajukan untuk pengisian kembali, lengkap dengan pemeriksaan dana tetap */
export function PettyReplenishSheet({ fund, vouchers }: { fund: PettyFundInfo; vouchers: PettyVoucherInfo[] }) {
  const total = vouchers.reduce((a, v) => a + Number(v.amount), 0);
  const gap = Number(fund.imprestAmount) - Number(fund.balance) - Number(fund.openVouchers);
  return (
    <PrintSheet>
      <DocHeader title="PENGAJUAN PENGISIAN KEMBALI KAS KECIL" meta={[['Dana', fund.name], ['Tanggal', fmtDate(today())], ['Jumlah bukti', String(vouchers.length)]]} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={head}>No. bukti</th>
            <th style={head}>Tanggal</th>
            <th style={head}>Penerima</th>
            <th style={head}>Keperluan</th>
            <th style={head}>Akun beban</th>
            <th style={head}>No. nota</th>
            <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {vouchers.map((v) => (
            <tr key={v.number}>
              <td style={cell}>{v.number}</td>
              <td style={cell}>{fmtDate(v.date)}</td>
              <td style={cell}>{v.payee}</td>
              <td style={cell}>{v.description}</td>
              <td style={cell}>{v.expenseAccount ? `${v.expenseAccount.code} ${v.expenseAccount.name}` : '-'}</td>
              <td style={cell}>{v.receiptRef}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(v.amount)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} style={{ ...cell, fontWeight: 700, textAlign: 'right' }}>Total pengisian kembali</td>
            <td style={{ ...cell, fontWeight: 700, textAlign: 'right' }}>{fmtMoney(total)}</td>
          </tr>
        </tbody>
      </table>
      <table style={{ width: 360, borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
        <tbody>
          <tr><td style={cell}>Dana tetap (plafon)</td><td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(fund.imprestAmount)}</td></tr>
          <tr><td style={cell}>Saldo kas kecil (buku)</td><td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(fund.balance)}</td></tr>
          <tr><td style={cell}>Bukti belum diganti</td><td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(fund.openVouchers)}</td></tr>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>Selisih dana tetap</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{Math.abs(gap) < 1 ? 'Sesuai' : fmtMoney(gap)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Terbilang: <em>{terbilang(total)}</em>. Saldo fisik kas kecil dicocokkan lewat hitung kas sebelum pengisian.</div>
      <Signatures labels={[['Diajukan oleh', `Juru kas ${fund.custodianName}`], ['Diperiksa'], ['Disetujui']]} />
    </PrintSheet>
  );
}
