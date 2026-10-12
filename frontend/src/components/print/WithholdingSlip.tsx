import type { WithholdingRow } from '@sansu/shared';
import { fmtDate, fmtMoney } from '@/lib/format';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from './Letterhead';
import { t } from '@/lib/terms';

const TITLE: Record<WithholdingRow['type'], string> = {
  PPH23: 'BUKTI PEMOTONGAN PPh PASAL 23',
  PPH4_2: 'BUKTI PEMOTONGAN PPh PASAL 4 AYAT (2)',
};

/**
 * Bukti pemotongan untuk pemasok: salinan yang diserahkan ke penerima penghasilan agar bisa mengkreditkan potongannya.
 * Bukti potong resmi diterbitkan lewat e-Bupot Unifikasi di Coretax; dokumen ini memuat data yang sama dari pembukuan.
 */
export default function WithholdingSlip({ row }: { row: WithholdingRow }) {
  const { data: c } = useLetterhead();
  const period = row.date.slice(0, 7);
  return (
    <PrintSheet>
      <DocHeader
        title={TITLE[row.type]}
        meta={[
          ['No.', `BP/${row.number}`],
          ['Masa pajak', `${period.slice(5)}/${period.slice(0, 4)}`],
          ['Tanggal', fmtDate(row.date)],
        ]}
      />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <PartyBlock label="A. Penerima penghasilan (yang dipotong)" name={row.supplierName} lines={[`NPWP/NIK: ${row.supplierNpwp || '-'}`, row.supplierAddress]} />
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <PartyBlock label="B. Pemotong pajak" name={c?.name ?? ''} lines={[`NPWP: ${c?.npwp || '-'}`, c?.address]} />
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={head}>C. Objek pemotongan</th>
            <th style={{ ...head, textAlign: 'right' }}>Dasar pengenaan (DPP)</th>
            <th style={{ ...head, textAlign: 'right', width: 70 }}>Tarif</th>
            <th style={{ ...head, textAlign: 'right' }}>PPh dipotong</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>
              {row.description || (row.type === 'PPH23' ? 'Jasa' : 'Sewa tanah/bangunan')}
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Faktur {row.number}
                {row.supplierInvoiceNo ? ` · ${row.supplierInvoiceNo}` : ''}
              </div>
            </td>
            <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(row.base)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{row.rate ? `${Number(row.rate)}%` : '-'}</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(row.amount)}</td>
          </tr>
        </tbody>
      </table>
      {!row.supplierNpwp && (
        <p style={{ fontSize: 12, color: '#b91c1c' }}>{t('NPWP/NIK penerima belum diisi. Lengkapi di menu Supplier sebelum bukti potong diterbitkan resmi.')}</p>
      )}
      <Signatures labels={[['Penerima penghasilan'], ['Pemotong pajak', c?.name]]} />
      <p style={{ fontSize: 11, color: '#64748b', marginTop: 24 }}>
        Dokumen ini ringkasan pemotongan dari pembukuan. Bukti pemotongan resmi (nomor dan tanda tangan elektronik) diterbitkan melalui e-Bupot Unifikasi di Coretax.
      </p>
    </PrintSheet>
  );
}
