import { BRAND, CASH_DENOMINATIONS, type CashCount } from '@sansu/shared';
import { Descriptions } from 'antd';
import { cell, DocHeader, head, PrintSheet, Signatures } from '@/components/print/Letterhead';
import { fmtDate, fmtMoney } from '@/lib/format';
import { diffText } from './shared';

/** Berita acara opname kas (dokumen cetak) */
export function BeritaAcara({ c }: { c: CashCount }) {
  const diff = Number(c.difference);
  const right = { ...cell, textAlign: 'right' as const };
  return (
    <PrintSheet>
      <DocHeader
        title="BERITA ACARA OPNAME KAS"
        meta={[
          ['Nomor', c.number],
          ['Tanggal', fmtDate(c.date)],
        ]}
      />
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Kas">
          {c.account.code} · {c.account.name}
        </Descriptions.Item>
        <Descriptions.Item label="Pemegang kas">{c.custodianName || '-'}</Descriptions.Item>
      </Descriptions>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Pada tanggal tersebut telah dilakukan penghitungan fisik uang kas dengan hasil sebagai berikut:
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={head}>Pecahan</th>
            <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
            <th style={{ ...head, textAlign: 'right' }}>Nilai</th>
          </tr>
        </thead>
        <tbody>
          {CASH_DENOMINATIONS.filter((d) => (c.denominations[d.key] ?? 0) > 0).map((d) => (
            <tr key={d.key}>
              <td style={cell}>
                Uang {d.kind.toLowerCase()} {d.value.toLocaleString('id-ID')}
              </td>
              <td style={right}>
                {c.denominations[d.key]} {d.kind === 'Kertas' ? 'lembar' : 'keping'}
              </td>
              <td style={right}>{fmtMoney(d.value * (c.denominations[d.key] ?? 0))}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
              Jumlah uang fisik
            </td>
            <td style={{ ...right, fontWeight: 700 }}>{fmtMoney(c.countedTotal)}</td>
          </tr>
          {c.items.map((i, k) => (
            <tr key={k}>
              <td style={cell} colSpan={2}>
                {i.type === 'ADD' ? '(+)' : '(−)'} {i.description}
              </td>
              <td style={right}>{fmtMoney(i.amount)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
              Kas menurut hasil opname
            </td>
            <td style={{ ...right, fontWeight: 700 }}>{fmtMoney(Number(c.countedTotal) + Number(c.itemsTotal))}</td>
          </tr>
          <tr>
            <td style={cell} colSpan={2}>
              Saldo kas menurut pembukuan
            </td>
            <td style={right}>{fmtMoney(c.bookBalance)}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 800, borderTop: `2px solid ${BRAND.colors.primary}` }} colSpan={2}>
              Selisih
            </td>
            <td
              style={{
                ...right,
                fontWeight: 800,
                borderTop: `2px solid ${BRAND.colors.primary}`,
                color: diff ? '#dc2626' : undefined,
              }}
            >
              {diffText(diff)}
            </td>
          </tr>
        </tbody>
      </table>
      {c.reason && <div style={{ marginTop: 12, fontSize: 13 }}>Penjelasan selisih: {c.reason}</div>}
      {c.notes && <div style={{ marginTop: 4, fontSize: 13 }}>Catatan: {c.notes}</div>}
      {c.journalNumber && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
          Selisih dibukukan dengan jurnal {c.journalNumber}
          {c.approvedBy ? ` · disetujui ${c.approvedBy}` : ''}
        </div>
      )}
      <Signatures
        labels={[
          ['Pemegang kas', c.custodianName || undefined],
          ['Pemeriksa', c.createdBy || undefined],
          ['Mengetahui', c.approvedBy || undefined],
        ]}
      />
    </PrintSheet>
  );
}
