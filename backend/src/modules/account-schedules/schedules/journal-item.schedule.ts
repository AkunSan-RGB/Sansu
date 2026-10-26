import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import type { ReportGroup } from '@sansu/shared';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, movementTable } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleMethod, ScheduleRow, ScheduleTable } from '../account-schedule.types';
import type { ContractKind } from '../contract-calc';

export interface JournalLine {
  journal_id: string;
  number: string;
  date: string;
  description: string;
  source_type: string;
  debit: string;
  credit: string;
}

export interface JournalItemProfile {
  title: string;
  groups: ReportGroup[];
  /** Akun dengan kontrak terdaftar jenis ini juga memakai jadwal ini, apa pun kelompok laporannya */
  contractKind?: ContractKind;
  /** Sisi yang menambah saldo akun: debit (aset) atau kredit (liabilitas) */
  increases: 'debit' | 'credit';
  addTitle: string;
  subTitle: string;
  addLabel: string;
  subLabel: string;
  method: ScheduleMethod;
}

export interface Extras {
  tables: ScheduleTable[];
  findings: string[];
}

/**
 * Jadwal untuk akun yang belum punya daftar rincian sendiri (dibayar di muka, akrual, pinjaman, dan sejenisnya): rincian dibentuk dari jurnal
 * akun itu. Penambahan dan pengurangan tahun berjalan dicantumkan per jurnal (dengan tautan ke jurnalnya), saldo awal sebagai satu baris,
 * dan subkelas menambahkan perhitungan khas (jadwal amortisasi, jurnal balik terjadwal, bunga) lewat `extras`.
 */
export abstract class JournalItemSchedule implements AccountSchedule {
  abstract readonly kind: string;
  protected abstract profile: JournalItemProfile;
  /** Jadwal cadangan menandai akun agar metodenya ditentukan */
  protected readonly needsDefinition: boolean = false;
  /** Profil per akun; bawaan satu profil untuk semua akun yang ditangani kelas ini */
  protected profileFor(_a: AccountMeta): JournalItemProfile {
    return this.profile;
  }

  constructor(
    protected readonly db: DbOrTx,
    protected readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta, c: ScheduleCatalog) {
    const p = this.profile;
    return p.groups.includes(a.reportGroup) || (!!p.contractKind && c.contractAccountIds[p.contractKind].has(a.id));
  }

  protected extras(_cx: ScheduleContext, _lines: JournalLine[], _closing: Dec): Promise<Extras> {
    return Promise.resolve({ tables: [], findings: [] });
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const p = this.profileFor(cx.account);
    const gl = movementTable(cx.account, cx.movement, cx.year, { add: p.addLabel, sub: p.subLabel }, 'Mutasi per bulan');
    const lines = (await this.repo.journalLinesOfAccount(this.db, cx.tenantId, cx.account.id, cx.from, cx.to)).rows;
    const side = (l: JournalLine, which: 'add' | 'sub') => D((p.increases === 'debit') === (which === 'add') ? l.debit : l.credit);
    const toRows = (which: 'add' | 'sub'): ScheduleRow[] =>
      lines.filter((l) => side(l, which).gt(0) || side(l, which).lt(0)).map((l) => ({
        cells: { date: l.date, number: l.number, description: l.description, source: l.source_type, amount: money(side(l, which)) },
        link: `/journals?q=${encodeURIComponent(l.number)}`,
      }));
    const sum = (rows: ScheduleRow[]) => rows.reduce((s, r) => s.plus(D(r.cells.amount as string)), ZERO);
    const cols = [col('date', 'Tanggal', 'date'), col('number', 'No. jurnal', 'text'), col('description', 'Keterangan', 'text'), col('source', 'Sumber', 'text'), col('amount', 'Jumlah')];
    const opening = D(gl.table.total?.opening as string);
    const adds = toRows('add');
    const subs = toRows('sub');
    const addTable: ScheduleTable = {
      key: 'journal-additions',
      title: p.addTitle,
      note: 'Saldo awal tahun dicantumkan sebagai satu baris; penambahan tahun berjalan per jurnal.',
      columns: cols,
      rows: [{ cells: { date: null, number: null, description: 'Saldo awal (sebelum 1 Januari)', source: null, amount: money(opening) } }, ...adds],
      total: { description: 'Jumlah saldo awal + penambahan', amount: money(opening.plus(sum(adds))) },
    };
    const subTable: ScheduleTable = { key: 'journal-reductions', title: p.subTitle, columns: cols, rows: subs, total: { description: 'Jumlah pengurangan', amount: money(sum(subs)) } };
    const ex = await this.extras(cx, lines, gl.closing);
    // Tabel menyesuaikan isi akun: akun tanpa saldo awal dan tanpa transaksi hanya menampilkan mutasi bulanannya (kosong); tabel pengurangan hanya bila ada
    const empty = lines.length === 0 && opening.isZero();
    const tables = empty ? [...ex.tables, gl.table] : [addTable, ...(subs.length ? [subTable] : []), ...ex.tables, gl.table];
    return { title: p.title, method: p.method, tables, closing: gl.closing, findings: ex.findings, needsDefinition: this.needsDefinition };
  }
}
