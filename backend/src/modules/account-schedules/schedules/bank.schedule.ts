import { Injectable } from '@nestjs/common';
import { D } from '../../../common/utils/money';
import type { AccountMeta } from '../../accounting/ledger-data';
import { BankService } from '../../bank/bank.service';
import { col, money, movementTable } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleRow } from '../account-schedule.types';

const line = (desc: string, amount: string | null, date: string | null = null, number: string | null = null): ScheduleRow => ({ cells: { desc, date, number, amount } });

/**
 * Rekonsiliasi bank pada tanggal laporan (31 Desember): saldo rekening koran ± setoran dalam perjalanan dan pembayaran yang belum
 * dicairkan = saldo buku ± mutasi bank yang belum dibukukan. Memakai perhitungan BankService yang sama dengan menu Bank.
 */
@Injectable()
export class BankReconciliationSchedule implements AccountSchedule {
  readonly kind = 'BANK';

  constructor(private readonly bank: BankService) {}

  supports(a: AccountMeta, c: ScheduleCatalog) {
    return c.bankAccountIds.has(a.id);
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const r = await this.bank.reconciliation(cx.tenantId, cx.account.id, cx.to);
    const signoffs = (await this.bank.listSignoffs(cx.tenantId, cx.account.id)).filter((s) => s.period.startsWith(`${cx.year}-`));
    const hasBank = r.bankBalance !== null;
    const rows: ScheduleRow[] = [
      line(hasBank ? 'Saldo menurut rekening koran' : 'Saldo menurut rekening koran (belum ada rekening koran)', r.bankBalance, r.bankBalanceDate),
      ...r.depositsInTransit.map((x) => line('(+) Setoran dalam perjalanan', x.amount, x.date, x.number)),
      ...r.outstandingPayments.map((x) => line('(−) Pembayaran yang belum dicairkan', money(D(x.amount).negated()), x.date, x.number)),
      line('Saldo bank setelah disesuaikan', r.adjustedBank),
      line('Saldo menurut buku', r.bookBalance),
      ...r.unrecorded.map((x) => line('(+/−) Mutasi bank yang belum dibukukan', x.amount, x.date, null)),
      line('Saldo buku setelah disesuaikan', r.adjustedBook),
      line('Selisih (harus nol)', r.difference),
    ];
    const reconTable = {
      key: 'bank-reconciliation',
      title: `Rekonsiliasi bank per ${cx.to}`,
      note: 'Bersumber dari rekening koran yang diimpor dan pencocokan di menu Bank.',
      columns: [col('desc', 'Uraian', 'text'), col('date', 'Tanggal', 'date'), col('number', 'No. jurnal', 'text'), col('amount', 'Jumlah')],
      rows,
    };
    const signTable = {
      key: 'bank-signoff',
      title: `Pengesahan rekonsiliasi bulanan ${cx.year}`,
      note: 'Rekonsiliasi tiap akhir bulan disahkan orang yang berbeda dari pengimpor rekening koran.',
      columns: [col('period', 'Periode', 'text'), col('book', 'Saldo buku disahkan'), col('signedAt', 'Disahkan', 'date'), col('notes', 'Catatan', 'text')],
      rows: signoffs.map((s) => ({ cells: { period: s.period, book: s.bookBalance, signedAt: s.signedAt.toISOString().slice(0, 10), notes: s.notes ?? null } })),
    };
    const gl = movementTable(cx.account, cx.movement, cx.year, { add: 'Penerimaan (debit)', sub: 'Pengeluaran (kredit)' }, 'Mutasi buku per bulan');
    const findings: string[] = [];
    if (!hasBank) findings.push('Belum ada rekening koran sampai tanggal ini: saldo buku belum bisa dicocokkan dengan bank. Impor rekening koran di menu Bank.');
    else if (!r.reconciled) findings.push(`Rekonsiliasi per ${cx.to} belum selisih nol (selisih ${r.difference}). Cocokkan mutasi bank yang belum dibukukan atau catat pembayaran/setoran yang tertunda.`);
    if (!signoffs.some((s) => s.period === `${cx.year}-12`)) findings.push(`Rekonsiliasi Desember ${cx.year} belum disahkan.`);
    return {
      title: 'Rekonsiliasi bank',
      method: {
        basis: 'Saldo buku akun bank dicocokkan dengan saldo rekening koran pada tanggal laporan; perbedaan waktu dijelaskan satu per satu.',
        formulas: ['Saldo bank disesuaikan = saldo rekening koran + setoran dalam perjalanan − pembayaran belum dicairkan', 'Saldo buku disesuaikan = saldo buku ± mutasi bank yang belum dibukukan', 'Selisih = saldo bank disesuaikan − saldo buku disesuaikan, harus nol'],
        policies: ['Rekonsiliasi dilakukan tiap akhir bulan dan disahkan oleh orang selain pengimpor rekening koran (pemisahan tugas).'],
      },
      tables: [reconTable, signTable, gl.table],
      closing: gl.closing,
      findings,
    };
  }
}
