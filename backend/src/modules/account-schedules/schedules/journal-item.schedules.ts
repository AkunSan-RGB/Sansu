import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, MONTH_NAMES, money, netOf, openingOf } from '../account-schedule.support';
import type { ScheduleContext, ScheduleRow } from '../account-schedule.types';
import { ContractExtras } from './contract-extras';
import { JournalItemSchedule, type Extras, type JournalItemProfile, type JournalLine } from './journal-item.schedule';

const STEP_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
const FREQ_LABEL: Record<string, string> = { MONTHLY: 'Bulanan', QUARTERLY: 'Triwulanan', YEARLY: 'Tahunan' };

/** Sisa kejadian jurnal berulang: dari batas jumlah, atau dihitung sampai tanggal akhir; kosong bila tanpa batas */
export function remainingOccurrences(r: { frequency: string; nextDate: string; endDate: string | null; remaining: number | null }): number | null {
  if (r.remaining != null) return r.remaining;
  if (!r.endDate) return null;
  const step = STEP_MONTHS[r.frequency] ?? 1;
  let n = 0;
  const d = new Date(`${r.nextDate}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= r.endDate && n < 600) {
    n += 1;
    d.setUTCMonth(d.getUTCMonth() + step);
  }
  return n;
}

/** Biaya dibayar di muka dan uang muka: amortisasi menurut jadwal jurnal berulang dibandingkan dengan sisa saldo */
@Injectable()
export class PrepaidSchedule extends JournalItemSchedule {
  readonly kind = 'PREPAID';
  protected profile: JournalItemProfile = {
    title: 'Biaya dibayar di muka dan uang muka',
    groups: ['PREPAID', 'PREPAID_TAX'],
    contractKind: 'PREPAID',
    increases: 'debit',
    addTitle: 'Pembayaran di muka (saldo awal dan penambahan tahun ini)',
    subTitle: 'Amortisasi dan pengurangan tahun ini',
    addLabel: 'Pembayaran di muka (debit)',
    subLabel: 'Amortisasi / pemakaian (kredit)',
    method: {
      basis: 'Pembayaran di muka dicatat sebagai aset lalu dibebankan secara garis lurus selama masa manfaatnya (basis akrual).',
      formulas: ['Amortisasi per periode = jumlah dibayar ÷ jumlah periode manfaat', 'Sisa saldo = saldo awal + pembayaran − amortisasi', 'Sisa jadwal = amortisasi per periode × sisa periode (jurnal berulang yang aktif)'],
      policies: ['Saldo akhir seharusnya habis diamortisasi sesuai jadwal; saldo tanpa jadwal ditandai agar dibuatkan jurnal berulangnya.'],
    },
  };

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository, private readonly contracts: ContractExtras) {
    super(db, repo);
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    const all = await this.repo.activeRecurringJournals(this.db, cx.tenantId);
    const rows: ScheduleRow[] = [];
    let projected = ZERO;
    let unbounded = false;
    for (const r of all) {
      const per = r.lines.filter((l) => l.accountId === cx.account.id).reduce((s, l) => s.plus(l.credit ?? 0).minus(l.debit ?? 0), ZERO);
      if (per.lte(0)) continue; // hanya jurnal yang mengurangi akun ini (amortisasi)
      const occ = remainingOccurrences({ frequency: r.frequency, nextDate: r.nextDate, endDate: r.endDate, remaining: r.remaining });
      const total = occ == null ? null : per.times(occ);
      if (total) projected = projected.plus(total);
      else unbounded = true;
      rows.push({ cells: { name: r.name, frequency: FREQ_LABEL[r.frequency] ?? r.frequency, next: r.nextDate, per: money(per), occ, total: total ? money(total) : null }, link: '/journals?tab=recurring' });
    }
    const findings: string[] = [];
    if (closing.gt(0.5) && !unbounded) {
      const gap = closing.minus(projected);
      if (gap.abs().gte(0.5)) findings.push(gap.gt(0) ? `Saldo akhir ${money(closing)} belum seluruhnya punya jadwal amortisasi: jadwal aktif hanya mencakup ${money(projected)} (belum terjadwal ${money(gap)}).` : `Jadwal amortisasi aktif (${money(projected)}) melebihi saldo akhir (${money(closing)}).`);
    }
    const contract = await this.contracts.build(cx, 'PREPAID', closing);
    return {
      tables: [
        ...contract.tables,
        {
          key: 'amortization-schedule',
          title: 'Jadwal amortisasi terdaftar (jurnal berulang aktif)',
          note: 'Sisa jadwal = amortisasi per periode × sisa periode; dibandingkan dengan saldo akhir akun.',
          columns: [col('name', 'Jurnal berulang', 'text'), col('frequency', 'Periode', 'text'), col('next', 'Berikutnya', 'date'), col('per', 'Per periode'), col('occ', 'Sisa periode', 'qty'), col('total', 'Sisa jadwal')],
          rows,
          total: { name: 'Jumlah sisa jadwal', total: money(projected) },
        },
      ],
      findings: [...contract.findings, ...findings],
    };
  }
}

/** Beban akrual: tambahan (kredit) dan pelunasan/pembalikan (debit) per jurnal, serta jurnal balik terjadwal */
@Injectable()
export class AccrualSchedule extends JournalItemSchedule {
  readonly kind = 'ACCRUAL';
  protected profile: JournalItemProfile = {
    title: 'Beban akrual',
    groups: ['ACCRUED_EXPENSE'],
    increases: 'credit',
    addTitle: 'Akrual (saldo awal dan penambahan tahun ini)',
    subTitle: 'Pembayaran dan pembalikan akrual tahun ini',
    addLabel: 'Akrual (kredit)',
    subLabel: 'Pembayaran / pembalikan (debit)',
    method: {
      basis: 'Beban yang sudah terjadi tetapi belum dibayar diakui pada periode terjadinya sebagai liabilitas akrual.',
      formulas: ['Saldo akhir = saldo awal + akrual − pembayaran/pembalikan', 'Akrual yang dibalik otomatis: jurnal balik dibukukan di awal periode berikutnya'],
      policies: ['Akrual akhir periode didukung dasar perhitungan (kontrak, tagihan, atau perkiraan beban) dan dibalik bila dibayar.'],
    },
  };

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    const rev = (await this.repo.pendingReversalsOnAccount(this.db, cx.tenantId, cx.account.id)).rows;
    const pending = rev.reduce((s, r) => s.plus(r.credit).minus(r.debit), ZERO);
    const findings: string[] = [];
    if (rev.length && closing.gt(0.5) && pending.minus(closing).abs().gte(0.5)) {
      findings.push(`Jurnal balik terjadwal (${money(pending)}) tidak sama dengan saldo akrual akhir (${money(closing)}); sisanya dibayar/dibalik manual atau belum dijadwalkan pembaliknya.`);
    }
    return {
      tables: [
        {
          key: 'scheduled-reversals',
          title: 'Jurnal balik terjadwal yang masih menunggu',
          columns: [col('reverseOn', 'Dibalik pada', 'date'), col('number', 'No. jurnal', 'text'), col('date', 'Tanggal akrual', 'date'), col('description', 'Keterangan', 'text'), col('amount', 'Akrual yang akan dibalik')],
          rows: rev.map((r) => ({ cells: { reverseOn: r.reverse_on, number: r.number, date: r.date, description: r.description, amount: money(D(r.credit).minus(r.debit)) }, link: `/journals?q=${encodeURIComponent(r.number)}` })),
          total: { description: 'Jumlah', amount: money(pending) },
        },
      ],
      findings,
    };
  }
}

/** Pendapatan diterima di muka dan uang muka pelanggan */
@Injectable()
export class DeferredRevenueSchedule extends JournalItemSchedule {
  readonly kind = 'DEFERRED_REVENUE';
  protected profile: JournalItemProfile = {
    title: 'Pendapatan diterima di muka dan uang muka pelanggan',
    groups: ['UNEARNED_REVENUE'],
    increases: 'credit',
    addTitle: 'Penerimaan di muka (saldo awal dan penambahan tahun ini)',
    subTitle: 'Pengakuan pendapatan dan pemakaian uang muka tahun ini',
    addLabel: 'Diterima di muka (kredit)',
    subLabel: 'Diakui / dipakai (debit)',
    method: {
      basis: 'Penerimaan sebelum barang/jasa diserahkan dicatat sebagai liabilitas lalu diakui sebagai pendapatan saat kewajiban pelaksanaan dipenuhi (PSAK 72).',
      formulas: ['Saldo akhir = saldo awal + penerimaan di muka − pendapatan diakui/uang muka dipakai'],
    },
  };

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }
}

/** Utang bank/pinjaman: pencairan dan angsuran per jurnal serta perkiraan tarif bunga efektif dari beban bunga */
@Injectable()
export class LoanSchedule extends JournalItemSchedule {
  readonly kind = 'LOAN';
  protected profile: JournalItemProfile = {
    title: 'Pinjaman',
    groups: ['SHORT_TERM_LOAN', 'LONG_TERM_LOAN'],
    contractKind: 'LOAN',
    increases: 'credit',
    addTitle: 'Pencairan (saldo awal dan penambahan tahun ini)',
    subTitle: 'Angsuran pokok tahun ini',
    addLabel: 'Pencairan (kredit)',
    subLabel: 'Angsuran pokok (debit)',
    method: {
      basis: 'Pinjaman dicatat sebesar pokok terutang; bunga dibebankan pada periode berjalan sebagai beban keuangan.',
      formulas: ['Pokok akhir = pokok awal + pencairan − angsuran pokok', 'Bunga bulan = beban keuangan bulan itu', 'Tarif efektif tahunan (perkiraan) = bunga ÷ rata-rata pokok × (12 ÷ jumlah bulan)'],
      policies: ['Bagian pokok yang jatuh tempo dalam 12 bulan disajikan sebagai liabilitas jangka pendek.', 'Beban bunga di sini mencakup seluruh akun beban keuangan; bila ada beberapa pinjaman, tarifnya rata-rata gabungan.'],
    },
  };

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository, private readonly contracts: ContractExtras) {
    super(db, repo);
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    const contract = await this.contracts.build(cx, 'LOAN', closing);
    const interestAccounts = cx.accounts.filter((a) => a.reportGroup === 'FINANCE_COST');
    let run = openingOf(cx.account, cx.movement);
    let totalInterest = ZERO;
    let balSum = ZERO;
    const rows: ScheduleRow[] = MONTH_NAMES.map((name, i) => {
      const open = run;
      const mm = cx.movement.months[i];
      run = run.plus(netOf(cx.account.type, mm.debit, mm.credit));
      const interest = interestAccounts.reduce((s, a) => s.plus(cx.movementOf(a.id).months[i].debit).minus(cx.movementOf(a.id).months[i].credit), ZERO);
      totalInterest = totalInterest.plus(interest);
      const avg = open.plus(run).div(2);
      balSum = balSum.plus(avg);
      const rate = avg.gt(0) ? interest.times(12).div(avg).times(100) : null;
      return { cells: { month: name, balance: money(run), interest: money(interest), rate: rate ? rate.toFixed(2) : null } };
    });
    const avgYear = balSum.div(12);
    const effective = avgYear.gt(0) ? totalInterest.div(avgYear).times(100) : null;
    const findings: string[] = [];
    if (closing.gt(0.5) && totalInterest.isZero()) findings.push('Ada saldo pinjaman tetapi tidak ada beban bunga dibukukan tahun ini; periksa apakah bunga sudah diakui.');
    return {
      tables: [
        ...contract.tables,
        {
          key: 'loan-interest',
          title: 'Perhitungan bunga per bulan',
          note: 'Perkiraan tarif tahunan dari beban keuangan yang dibukukan dibagi rata-rata pokok bulan itu.',
          columns: [col('month', 'Bulan', 'text'), col('balance', 'Pokok akhir bulan'), col('interest', 'Beban bunga bulan'), col('rate', 'Tarif tahunan (perkiraan, %)', 'percent')],
          rows,
          total: { month: 'Jumlah tahun berjalan', interest: money(totalInterest), rate: effective ? effective.toFixed(2) : null },
        },
      ],
      findings: [...contract.findings, ...findings],
    };
  }
}

/** Liabilitas sewa pembiayaan (PSAK 73 / SAK EP): hanya akun yang punya kontrak sewa terdaftar */
@Injectable()
export class LeaseSchedule extends JournalItemSchedule {
  readonly kind = 'LEASE';
  protected profile: JournalItemProfile = {
    title: 'Liabilitas sewa pembiayaan',
    groups: [],
    contractKind: 'LEASE',
    increases: 'credit',
    addTitle: 'Pengakuan liabilitas sewa (saldo awal dan penambahan tahun ini)',
    subTitle: 'Pembayaran pokok sewa tahun ini',
    addLabel: 'Pengakuan liabilitas sewa (kredit)',
    subLabel: 'Pembayaran pokok sewa (debit)',
    method: {
      basis: 'Pada awal sewa, penyewa mengakui liabilitas sebesar nilai kini pembayaran sewa dan aset hak guna; liabilitas berkurang oleh pembayaran dan bertambah oleh bunga (suku bunga implisit).',
      formulas: ['Bunga bulan = saldo liabilitas × suku bunga ÷ 12', 'Pokok = cicilan − bunga; saldo akhir = saldo awal − pokok', 'Cicilan anuitas = PV × r ÷ (1 − (1 + r)^−n)'],
      policies: ['Aset hak guna disusutkan selama masa sewa atau masa manfaat, mana yang lebih pendek (dicatat di aset tetap).', 'Sewa jangka pendek atau bernilai rendah dapat dibebankan langsung (SAK EP dapat memakai perlakuan lebih sederhana).'],
    },
  };

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository, private readonly contracts: ContractExtras) {
    super(db, repo);
  }

  protected extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    return this.contracts.build(cx, 'LEASE', closing);
  }
}
