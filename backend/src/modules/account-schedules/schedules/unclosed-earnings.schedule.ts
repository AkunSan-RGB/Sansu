import { Injectable } from '@nestjs/common';
import { D, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, monthEnd, monthStart, MONTH_NAMES } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleContext, ScheduleRow } from '../account-schedule.types';

/** Pengenal baris laporan "Laba (rugi) belum ditutup ke saldo laba" (bukan akun buku besar) */
export const UNCLOSED_EARNINGS_ID = 'unclosed-earnings';

/** Laba (rugi) berjalan yang disajikan di ekuitas sebelum jurnal penutup tahun: pendapatan dikurangi beban per bulan */
@Injectable()
export class UnclosedEarningsSchedule implements AccountSchedule {
  readonly kind = 'UNCLOSED_EARNINGS';

  constructor(
    @InjectDb() private readonly db: DbOrTx,
    private readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta) {
    return a.id === UNCLOSED_EARNINGS_ID;
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const nominal = cx.accounts.filter((a) => a.type === 'REVENUE' || a.type === 'EXPENSE');
    const prev = (await this.repo.unclosedEarningsAt(this.db, cx.tenantId, `${cx.year - 1}-12-31`)).rows[0];
    const end = (await this.repo.unclosedEarningsAt(this.db, cx.tenantId, cx.to)).rows[0];
    const open = D(prev.v);
    let run = open;
    let tRev = ZERO, tExp = ZERO;
    const rows: ScheduleRow[] = MONTH_NAMES.map((name, i) => {
      let rev = ZERO, exp = ZERO;
      for (const a of nominal) {
        const mm = cx.movementOf(a.id).months[i];
        if (a.type === 'REVENUE') rev = rev.plus(mm.credit).minus(mm.debit);
        else exp = exp.plus(mm.debit).minus(mm.credit);
      }
      const net = rev.minus(exp);
      const before = run;
      run = run.plus(net);
      tRev = tRev.plus(rev); tExp = tExp.plus(exp);
      return { cells: { month: name, opening: money(before), rev: money(rev), exp: money(exp), net: money(net), closing: money(run) }, link: `/journals?from=${monthStart(cx.year, i)}&to=${monthEnd(cx.year, i)}` };
    });
    const closing = D(end.v);
    const closingJournals = closing.minus(run);
    const findings: string[] = [];
    if (closingJournals.abs().gte(0.005)) {
      findings.push(`Jurnal penutup yang dibukukan sampai ${cx.to} memindahkan ${money(closingJournals.negated())} dari laba (rugi) berjalan ke saldo laba.`);
    }
    return {
      title: 'Laba (rugi) belum ditutup ke saldo laba',
      method: {
        basis: 'Selisih pendapatan dan beban yang belum dipindahkan ke saldo laba lewat jurnal penutup tahun.',
        formulas: ['Laba (rugi) berjalan = pendapatan − beban', 'Saldo akhir = saldo awal + laba (rugi) bulan − jurnal penutup yang sudah dibukukan'],
        policies: ['Setelah tutup buku, saldo ini dipindahkan ke saldo laba dan menjadi nol.'],
      },
      tables: [
        {
          key: 'unclosed-monthly',
          title: 'Laba (rugi) berjalan per bulan',
          columns: [col('month', 'Bulan', 'text'), col('opening', 'Saldo awal'), col('rev', 'Pendapatan'), col('exp', 'Beban'), col('net', 'Laba (rugi) bulan'), col('closing', 'Saldo akhir')],
          rows,
          total: { month: 'Jumlah tahun berjalan', opening: money(open), rev: money(tRev), exp: money(tExp), net: money(tRev.minus(tExp)), closing: money(closing) },
        },
      ],
      closing,
      findings,
    };
  }
}
