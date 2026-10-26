import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { buildContractSchedule, contractYear, type ContractKind, type ContractYear } from '../contract-calc';
import { col, MONTH_NAMES, money } from '../account-schedule.support';
import type { ScheduleContext, ScheduleRow } from '../account-schedule.types';
import { FinancingContractsRepository } from '../financing-contracts.repository';
import { termsOf } from '../financing-contracts.service';
import type { Extras } from './journal-item.schedule';

const KIND_LABEL: Record<ContractKind, { added: string; principal: string; interest: string; entity: string }> = {
  LOAN: { added: 'Pencairan', principal: 'Angsuran pokok', interest: 'Bunga', entity: 'pinjaman' },
  LEASE: { added: 'Pengakuan liabilitas sewa', principal: 'Pembayaran pokok sewa', interest: 'Bunga sewa', entity: 'sewa pembiayaan' },
  PREPAID: { added: 'Pembayaran di muka', principal: 'Amortisasi', interest: 'Bunga', entity: 'biaya dibayar di muka' },
};

const sum = (xs: Dec[]) => xs.reduce<Dec>((s, x) => s.plus(x), ZERO);

/**
 * Jadwal kontraktual dari data induk kontrak: per kontrak dan per bulan, lalu dibandingkan dengan buku besar
 * (penambahan, pokok/amortisasi, bunga, saldo akhir). Selisih ditandai sebagai temuan, tidak disembunyikan.
 */
@Injectable()
export class ContractExtras {
  constructor(
    @InjectDb() private readonly db: DbOrTx,
    private readonly repo: FinancingContractsRepository,
  ) {}

  async build(cx: ScheduleContext, kind: ContractKind, glClosing: Dec): Promise<Extras> {
    const L = KIND_LABEL[kind];
    const mine = (await this.repo.list(this.db, cx.tenantId)).filter((c) => c.accountId === cx.account.id && c.kind === kind);
    const findings: string[] = [];
    if (!mine.length) {
      if (glClosing.gt(0.5)) findings.push(`Belum ada kontrak ${L.entity} terdaftar untuk akun ini, padahal saldo akhirnya ${money(glClosing)}. Daftarkan kontraknya agar jadwal dan perhitungannya dapat diperiksa.`);
      return { tables: [], findings };
    }
    const years = mine.map((c) => ({ c, y: contractYear(buildContractSchedule(termsOf(c)), cx.year) }));
    const total = (f: (y: ContractYear) => Dec) => sum(years.map((x) => f(x.y)));
    const rows: ScheduleRow[] = years.map(({ c, y }) => ({
      cells: { name: c.name, party: c.counterparty, start: c.startDate, term: c.termMonths, opening: money(y.opening), added: money(y.additions), principal: money(y.principal), interest: money(y.interest), closing: money(y.closing), status: c.status === 'CLOSED' ? 'Ditutup' : 'Aktif' },
    }));
    const contractTable = {
      key: 'contracts',
      title: `Kontrak ${L.entity} terdaftar (jadwal kontraktual tahun ${cx.year})`,
      note: 'Dihitung dari syarat kontrak di data induk; saldo diakui pada bulan mulai dan dibayar/diamortisasi di akhir tiap bulan.',
      columns: [col('name', 'Kontrak', 'text'), col('party', 'Pihak', 'text'), col('start', 'Mulai', 'date'), col('term', 'Jangka (bulan)', 'qty'), col('opening', 'Saldo awal'), col('added', L.added), col('principal', L.principal), col('interest', L.interest), col('closing', 'Saldo akhir'), col('status', 'Status', 'text')],
      rows,
      total: { name: 'Jumlah', opening: money(total((y) => y.opening)), added: money(total((y) => y.additions)), principal: money(total((y) => y.principal)), interest: money(total((y) => y.interest)), closing: money(total((y) => y.closing)) },
    };
    const monthRows: ScheduleRow[] = MONTH_NAMES.map((name, i) => {
      const ms = years.map((x) => x.y.months[i]);
      const f = (g: (m: NonNullable<(typeof ms)[number]>) => Dec) => sum(ms.filter((m): m is NonNullable<typeof m> => !!m).map(g));
      return { cells: { month: name, opening: money(f((m) => m.opening)), added: money(f((m) => m.additions)), principal: money(f((m) => m.principal)), interest: money(f((m) => m.interest)), payment: money(f((m) => m.payment)), closing: money(f((m) => m.closing)) } };
    });
    const monthTable = {
      key: 'contract-monthly',
      title: 'Perhitungan kontraktual per bulan (semua kontrak di akun ini)',
      columns: [col('month', 'Bulan', 'text'), col('opening', 'Saldo awal'), col('added', L.added), col('principal', L.principal), col('interest', L.interest), col('payment', kind === 'PREPAID' ? 'Pembayaran kas' : 'Cicilan (pokok + bunga)'), col('closing', 'Saldo akhir')],
      rows: monthRows,
      total: { month: 'Jumlah tahun berjalan', added: money(total((y) => y.additions)), principal: money(total((y) => y.principal)), interest: money(total((y) => y.interest)), closing: money(total((y) => y.closing)) },
    };
    // Perbandingan dengan buku besar tahun ini
    const side = (which: 'debit' | 'credit') => sum(cx.movement.months.map((m) => m[which]));
    const incSide = kind === 'PREPAID' ? side('debit') : side('credit');
    const decSide = kind === 'PREPAID' ? side('credit') : side('debit');
    const expenseIds = [...new Set(mine.flatMap((c) => (c.expenseAccountId && kind !== 'PREPAID' ? [c.expenseAccountId] : [])))];
    const bookInterest = sum(expenseIds.flatMap((id) => cx.movementOf(id).months.map((m) => m.debit.minus(m.credit))));
    const contractInterest = sum(years.filter((x) => x.c.expenseAccountId && kind !== 'PREPAID').map((x) => x.y.interest));
    const cmpRows: { label: string; contract: Dec; book: Dec; check: boolean }[] = [
      { label: `${L.added} tahun ini`, contract: total((y) => y.additions), book: incSide, check: true },
      { label: `${L.principal} tahun ini`, contract: total((y) => y.principal), book: decSide, check: true },
      ...(kind === 'PREPAID' ? [] : [{ label: `${L.interest} tahun ini (beban di buku)`, contract: contractInterest, book: bookInterest, check: expenseIds.length > 0 }]),
      { label: 'Saldo akhir', contract: total((y) => y.closing), book: glClosing, check: true },
    ];
    const compareTable = {
      key: 'contract-vs-ledger',
      title: 'Perbandingan jadwal kontraktual dengan buku besar',
      columns: [col('label', 'Uraian', 'text'), col('contract', 'Menurut kontrak'), col('book', 'Menurut buku besar'), col('diff', 'Selisih')],
      rows: cmpRows.map((r) => ({ cells: { label: r.label, contract: money(r.contract), book: money(r.book), diff: money(r.book.minus(r.contract)) } })),
    };
    for (const r of cmpRows) {
      if (r.check && r.book.minus(r.contract).abs().gte(0.5)) findings.push(`${r.label}: kontrak ${money(r.contract)}, buku besar ${money(r.book)} (selisih ${money(r.book.minus(r.contract))}).`);
    }
    return { tables: [contractTable, monthTable, compareTable], findings };
  }
}
