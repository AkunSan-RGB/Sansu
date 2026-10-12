import { BRAND } from '@sansu/shared';
import dayjs from 'dayjs';
import type { Payslip } from '@/api/types';
import { useLetterhead } from '@/components/print/Letterhead';
import { fmtMoney } from '@/lib/format';

const cell = { padding: '3px 0' } as const;
const Line = ({ label, value, bold, neg }: { label: string; value: string | number; bold?: boolean; neg?: boolean }) =>
  Number(value) === 0 && !bold ? null : (
    <tr style={{ fontWeight: bold ? 700 : 400 }}>
      <td style={cell}>{label}</td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {neg ? '(' : ''}
        {fmtMoney(value)}
        {neg ? ')' : ''}
      </td>
    </tr>
  );

/** Slip gaji siap cetak */
export default function PayslipView({ p }: { p: Payslip }) {
  const lh = useLetterhead();
  const period = p.run ? dayjs(`${p.run.period}-01`).format('MMMM YYYY') : '';
  const deductions = Number(p.bpjsKesEmployee) + Number(p.jhtEmployee) + Number(p.jpEmployee) + Number(p.pph21) + Number(p.otherDeduction);
  return (
    <div className="print-doc" style={{ background: '#fff', padding: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `3px solid ${BRAND.colors.primary}`, paddingBottom: 8, marginBottom: 12, gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {lh.data?.logo && <img src={lh.data.logo} alt="" style={{ maxHeight: 40, maxWidth: 120, objectFit: 'contain' }} />}
          <div>
            <strong style={{ fontSize: 15 }}>{p.company?.name}</strong>
            <div style={{ color: '#666', fontSize: 12 }}>{p.company?.address}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <strong style={{ fontSize: 16, color: BRAND.colors.primary }}>SLIP GAJI</strong>
          <div>{period}</div>
          <div style={{ color: '#666', fontSize: 12 }}>{p.run?.number}</div>
        </div>
      </div>
      <table style={{ width: '100%', marginBottom: 12 }}>
        <tbody>
          <tr>
            <td>Nama</td>
            <td>
              : <strong>{p.employee.name}</strong> ({p.employee.code})
            </td>
            <td>Status PTKP</td>
            <td>: {p.employee.ptkp}</td>
          </tr>
          <tr>
            <td>Jabatan</td>
            <td>: {p.employee.jobTitle ?? '-'}</td>
            <td>Kehadiran</td>
            <td>
              : {p.presentDays}/{p.workDays} hari{Number(p.overtimeHours) > 0 && ` · lembur ${Number(p.overtimeHours)} jam`}
            </td>
          </tr>
          {p.employee.bankAccount && (
            <tr>
              <td>Rekening</td>
              <td colSpan={3}>
                : {p.employee.bankName} {p.employee.bankAccount}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
        <table style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700, borderBottom: '1px solid #ddd' }}>
                Penghasilan
              </td>
            </tr>
            <Line label="Gaji pokok" value={p.baseSalary} bold />
            <Line label="Tunjangan tetap" value={p.fixedAllowance} />
            <Line label={`Uang makan/transport (${p.presentDays} hari)`} value={p.dailyAllowance} />
            <Line label="Lembur" value={p.overtimePay} />
            <Line label="Bonus / lain-lain" value={p.otherIncome} />
            <Line label={`Potongan tidak hadir (${p.absentDays} hari)`} value={p.absenceDeduction} neg />
            <tr style={{ fontWeight: 700, borderTop: '1px solid #ddd' }}>
              <td style={cell}>Total penghasilan</td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(p.grossPay)}</td>
            </tr>
          </tbody>
        </table>
        <table style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700, borderBottom: '1px solid #ddd' }}>
                Potongan
              </td>
            </tr>
            <Line label="BPJS Kesehatan (1%)" value={p.bpjsKesEmployee} />
            <Line label="JHT (2%)" value={p.jhtEmployee} />
            <Line label="Jaminan Pensiun (1%)" value={p.jpEmployee} />
            <Line label={`PPh 21${p.terCategory.endsWith('*') ? ' (perhitungan tahunan)' : ` (TER ${p.terCategory} ${Number(p.terRate)}%)`}`} value={p.pph21} />
            <Line label="Kasbon / lain-lain" value={p.otherDeduction} />
            <tr style={{ fontWeight: 700, borderTop: '1px solid #ddd' }}>
              <td style={cell}>Total potongan</td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(deductions)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        style={{
          marginTop: 16,
          padding: '10px 14px',
          background: '#eef7f5',
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        <span>GAJI BERSIH DITERIMA</span>
        <span style={{ color: BRAND.colors.primary }}>{fmtMoney(p.netPay)}</span>
      </div>
      <div style={{ marginTop: 10, color: '#666', fontSize: 11 }}>
        Ditanggung perusahaan (tidak memotong gaji): BPJS Kesehatan {fmtMoney(p.bpjsKesCompany)} · JHT {fmtMoney(p.jhtCompany)} · JP {fmtMoney(p.jpCompany)} · JKK{' '}
        {fmtMoney(p.jkkCompany)} · JKM {fmtMoney(p.jkmCompany)}. Penghasilan bruto pajak {fmtMoney(p.taxableGross)}.
      </div>
      {p.notes && <div style={{ marginTop: 6, fontSize: 12 }}>Catatan: {p.notes}</div>}
    </div>
  );
}
