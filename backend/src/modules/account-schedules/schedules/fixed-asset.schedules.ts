import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, ledgerLink, money, monthEnd, monthStart, MONTH_NAMES, movementTable } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleMethod, ScheduleRow, ScheduleTable } from '../account-schedule.types';
import { FixedAssetCalc, type AssetRow } from './fixed-asset.calc';

const METHOD_NAMES: Record<string, string> = {
  STRAIGHT_LINE: 'Garis lurus',
  DECLINING_BALANCE: 'Saldo menurun ganda (2×)',
  DECLINING_BALANCE_150: 'Saldo menurun 1,5×',
  SUM_OF_YEARS: 'Jumlah angka tahun',
  UNITS_OF_PRODUCTION: 'Unit produksi',
  NONE: 'Tidak disusutkan',
};

const rp = (v: string | number) => Math.round(Number(v)).toLocaleString('id-ID');

/** Rumus penyusutan bulanan satu aset dengan angkanya (untuk kolom "Perhitungan") */
export function formulaOf(a: AssetRow['asset']): string {
  const base = `(${rp(a.cost)} − ${rp(a.residualValue)})`;
  switch (a.method) {
    case 'STRAIGHT_LINE':
      return `${base} ÷ ${a.usefulLifeMonths} bulan = ${rp(D(a.cost).minus(a.residualValue).div(a.usefulLifeMonths).toFixed(2))} per bulan`;
    case 'DECLINING_BALANCE':
      return `nilai buku awal × (2 ÷ ${a.usefulLifeMonths / 12} tahun) ÷ 12; beralih ke garis lurus bila lebih besar`;
    case 'DECLINING_BALANCE_150':
      return `nilai buku awal × (1,5 ÷ ${a.usefulLifeMonths / 12} tahun) ÷ 12; beralih ke garis lurus bila lebih besar`;
    case 'SUM_OF_YEARS':
      return `${base} × (sisa tahun ÷ jumlah angka tahun) ÷ 12`;
    case 'UNITS_OF_PRODUCTION':
      return `${base} × pemakaian bulan itu ÷ kapasitas total ${a.totalUnits ?? '-'} ${a.unitLabel ?? ''}`.trim();
    default:
      return 'Tidak disusutkan';
  }
}

const ASSET_METHOD: ScheduleMethod = {
  basis: 'Aset tetap dicatat sebesar harga perolehan dan disusutkan selama masa manfaat sampai nilai residu (SAK/PSAK 16).',
  formulas: [
    'Garis lurus: (harga perolehan − nilai residu) ÷ masa manfaat (bulan)',
    'Saldo menurun: nilai buku awal × (faktor ÷ masa manfaat tahun) ÷ 12, beralih ke garis lurus bila lebih besar',
    'Jumlah angka tahun: (harga perolehan − nilai residu) × (sisa tahun ÷ jumlah angka tahun) ÷ 12',
    'Unit produksi: (harga perolehan − nilai residu) × pemakaian bulan itu ÷ kapasitas total',
    'Nilai buku = harga perolehan − akumulasi penyusutan',
  ],
  policies: ['Penyusutan dibukukan bulanan lewat menu Penyusutan; perubahan metode berlaku ke depan.', 'Aset yang dilepas dikeluarkan dari harga perolehan dan akumulasinya pada tanggal pelepasan.'],
};

/**
 * Dasar jadwal aset tetap: memuat aset milik akun ini (menurut akun kategori) beserta riwayat penyusutan,
 * lalu subkelas menyusun tabel untuk akun harga perolehan, akumulasi, atau beban penyusutan.
 */
abstract class FixedAssetSchedule implements AccountSchedule {
  abstract readonly kind: string;
  protected abstract accountIds(c: ScheduleCatalog): Set<string>;
  protected abstract ownedBy(a: AssetRow, accountId: string): boolean;
  protected abstract tables(cx: ScheduleContext, assets: AssetRow[], calc: FixedAssetCalc): { tables: ScheduleTable[]; closing: Dec; title: string; findings?: string[] };

  constructor(
    @InjectDb() protected readonly db: DbOrTx,
    protected readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta, c: ScheduleCatalog) {
    return this.accountIds(c).has(a.id);
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const all = (await this.repo.listAssetsWithCategory(this.db, cx.tenantId)).filter((r) => this.ownedBy(r, cx.account.id));
    const dep = (await this.repo.depreciationUpTo(this.db, cx.tenantId, `${cx.year}-12`)).rows;
    const calc = new FixedAssetCalc(dep.filter((d) => all.some((r) => r.asset.id === d.asset_id)));
    const { tables, closing, title, findings: own = [] } = this.tables(cx, all, calc);
    const gl = movementTable(cx.account, cx.movement, cx.year, this.ledgerLabels(), 'Pembanding: mutasi buku besar per bulan');
    const findings: string[] = [...own];
    const expected = this.glClosingFor(cx, closing);
    if (!expected.eq(gl.closing)) {
      findings.push(
        `Rincian per aset (${money(expected)}) tidak sama dengan buku besar akun ini (${money(gl.closing)}); selisih ${money(gl.closing.minus(expected))}. Periksa jurnal manual ke akun aset atau aset yang belum didaftarkan.`,
      );
    }
    return { title, method: ASSET_METHOD, tables: [...tables, gl.table], closing: expected, findings };
  }

  protected abstract ledgerLabels(): { add: string; sub: string };
  /** Saldo akun menurut tanda alaminya, dari angka rincian */
  protected glClosingFor(_cx: ScheduleContext, closing: Dec): Dec {
    return closing;
  }

  protected months<T>(year: number, fn: (i: number, from: string, to: string, prevEnd: string) => T): T[] {
    return MONTH_NAMES.map((_, i) => fn(i, monthStart(year, i), monthEnd(year, i), i === 0 ? `${year - 1}-12-31` : monthEnd(year, i - 1)));
  }
}

@Injectable()
export class FixedAssetCostSchedule extends FixedAssetSchedule {
  readonly kind = 'FIXED_ASSET_COST';
  protected accountIds(c: ScheduleCatalog) {
    return c.assetCostIds;
  }
  protected ownedBy(a: AssetRow, id: string) {
    return a.category.assetAccountId === id;
  }
  protected ledgerLabels() {
    return { add: 'Perolehan (debit)', sub: 'Pelepasan (kredit)' };
  }

  protected tables(cx: ScheduleContext, assets: AssetRow[], calc: FixedAssetCalc) {
    const { year, from, to } = cx;
    const prev = `${year - 1}-12-31`;
    let tOpen = ZERO, tAdd = ZERO, tSub = ZERO, tClose = ZERO;
    const rows: ScheduleRow[] = [];
    for (const { asset: a, category } of assets) {
      const open = calc.costAt(a, prev);
      const close = calc.costAt(a, to);
      const add = a.acquisitionDate >= from && a.acquisitionDate <= to ? D(a.cost) : ZERO;
      const sub = open.plus(add).minus(close);
      if (open.isZero() && add.isZero() && sub.isZero() && close.isZero()) continue;
      tOpen = tOpen.plus(open); tAdd = tAdd.plus(add); tSub = tSub.plus(sub); tClose = tClose.plus(close);
      rows.push({
        cells: { code: a.code, name: a.name, category: category.name, acquired: a.acquisitionDate, disposed: a.disposalDate, opening: money(open), add: money(add), sub: money(sub), closing: money(close) },
        link: `/account-schedules?manage=1&asset=${a.id}`,
      });
    }
    const perAsset: ScheduleTable = {
      key: 'asset-cost',
      title: 'Harga perolehan per aset',
      note: 'Penambahan = aset diperoleh/didaftarkan tahun ini; pengurangan = aset dilepas tahun ini.',
      columns: [col('code', 'Kode', 'text'), col('name', 'Nama aset', 'text'), col('category', 'Kelompok', 'text'), col('acquired', 'Tgl perolehan', 'date'), col('disposed', 'Tgl pelepasan', 'date'), col('opening', 'Saldo awal'), col('add', 'Penambahan'), col('sub', 'Pengurangan'), col('closing', 'Saldo akhir')],
      rows,
      total: { code: 'Jumlah', opening: money(tOpen), add: money(tAdd), sub: money(tSub), closing: money(tClose) },
    };
    const monthRows = this.months(year, (i, f, t, p) => {
      const open = assets.reduce((s, r) => s.plus(calc.costAt(r.asset, p)), ZERO);
      const close = assets.reduce((s, r) => s.plus(calc.costAt(r.asset, t)), ZERO);
      const add = assets.reduce((s, r) => (r.asset.acquisitionDate >= f && r.asset.acquisitionDate <= t ? s.plus(r.asset.cost) : s), ZERO);
      return { cells: { month: MONTH_NAMES[i], opening: money(open), add: money(add), sub: money(open.plus(add).minus(close)), closing: money(close) }, link: ledgerLink(cx.account.id, f, t) } as ScheduleRow;
    });
    const monthly: ScheduleTable = {
      key: 'asset-cost-monthly',
      title: 'Mutasi harga perolehan per bulan (menurut daftar aset)',
      columns: [col('month', 'Bulan', 'text'), col('opening', 'Saldo awal'), col('add', 'Perolehan'), col('sub', 'Pelepasan'), col('closing', 'Saldo akhir')],
      rows: monthRows,
      total: { month: 'Jumlah tahun berjalan', opening: money(tOpen), add: money(tAdd), sub: money(tSub), closing: money(tClose) },
    };
    return { tables: [perAsset, monthly], closing: tClose, title: 'Rincian aset tetap: harga perolehan' };
  }
}

@Injectable()
export class FixedAssetAccumulatedSchedule extends FixedAssetSchedule {
  readonly kind = 'FIXED_ASSET_ACCUMULATED';
  protected accountIds(c: ScheduleCatalog) {
    return c.assetAccumulatedIds;
  }
  protected ownedBy(a: AssetRow, id: string) {
    return a.category.accumulatedAccountId === id;
  }
  protected ledgerLabels() {
    return { add: 'Pelepasan (debit)', sub: 'Penyusutan (kredit)' };
  }
  /** Akun akumulasi bersaldo kredit: tanda alami (debit − kredit) negatif */
  protected glClosingFor(_cx: ScheduleContext, closing: Dec) {
    return closing.negated();
  }

  protected tables(cx: ScheduleContext, assets: AssetRow[], calc: FixedAssetCalc) {
    const { year, from, to } = cx;
    const prev = `${year - 1}-12-31`;
    let tOpen = ZERO, tDep = ZERO, tAdd = ZERO, tRem = ZERO, tClose = ZERO;
    const rows: ScheduleRow[] = [];
    for (const { asset: a } of assets) {
      const open = calc.accAt(a, prev);
      const close = calc.accAt(a, to);
      const dep = a.acquisitionDate <= to ? calc.depBetween(a.id, `${year}-01`, `${year}-12`) : ZERO;
      const add = a.acquisitionDate >= from && a.acquisitionDate <= to ? D(a.openingAccumulated) : ZERO;
      const rem = open.plus(dep).plus(add).minus(close);
      if (open.isZero() && dep.isZero() && add.isZero() && rem.isZero() && close.isZero()) continue;
      tOpen = tOpen.plus(open); tDep = tDep.plus(dep); tAdd = tAdd.plus(add); tRem = tRem.plus(rem); tClose = tClose.plus(close);
      rows.push({
        cells: { code: a.code, name: a.name, method: METHOD_NAMES[a.method] ?? a.method, formula: formulaOf(a), opening: money(open), dep: money(dep), add: money(add), rem: money(rem), closing: money(close) },
      });
    }
    const perAsset: ScheduleTable = {
      key: 'asset-accumulated',
      title: 'Akumulasi penyusutan per aset',
      note: 'Akumulasi ditampilkan sebagai angka positif; di buku besar bersaldo kredit. Akumulasi awal = akumulasi aset lama yang baru didaftarkan tahun ini.',
      columns: [col('code', 'Kode', 'text'), col('name', 'Nama aset', 'text'), col('method', 'Metode', 'text'), col('formula', 'Perhitungan', 'text'), col('opening', 'Saldo awal'), col('dep', 'Penyusutan tahun ini'), col('add', 'Akumulasi awal aset baru'), col('rem', 'Pengurangan (pelepasan)'), col('closing', 'Saldo akhir')],
      rows,
      total: { code: 'Jumlah', opening: money(tOpen), dep: money(tDep), add: money(tAdd), rem: money(tRem), closing: money(tClose) },
    };
    const monthRows = this.months(year, (i, f, t, p) => {
      const open = assets.reduce((s, r) => s.plus(calc.accAt(r.asset, p)), ZERO);
      const close = assets.reduce((s, r) => s.plus(calc.accAt(r.asset, t)), ZERO);
      const period = t.slice(0, 7);
      const dep = assets.reduce((s, r) => (r.asset.acquisitionDate <= t ? s.plus(calc.depIn(r.asset.id, period)) : s), ZERO);
      const add = assets.reduce((s, r) => (r.asset.acquisitionDate >= f && r.asset.acquisitionDate <= t ? s.plus(r.asset.openingAccumulated) : s), ZERO);
      return { cells: { month: MONTH_NAMES[i], opening: money(open), dep: money(dep), add: money(add), rem: money(open.plus(dep).plus(add).minus(close)), closing: money(close) }, link: ledgerLink(cx.account.id, f, t) } as ScheduleRow;
    });
    const monthly: ScheduleTable = {
      key: 'asset-accumulated-monthly',
      title: 'Mutasi akumulasi penyusutan per bulan (menurut daftar aset)',
      columns: [col('month', 'Bulan', 'text'), col('opening', 'Saldo awal'), col('dep', 'Penyusutan'), col('add', 'Akumulasi awal aset baru'), col('rem', 'Pengurangan (pelepasan)'), col('closing', 'Saldo akhir')],
      rows: monthRows,
      total: { month: 'Jumlah tahun berjalan', opening: money(tOpen), dep: money(tDep), add: money(tAdd), rem: money(tRem), closing: money(tClose) },
    };
    return { tables: [perAsset, monthly], closing: tClose, title: 'Rincian aset tetap: akumulasi penyusutan' };
  }
}

@Injectable()
export class DepreciationExpenseSchedule extends FixedAssetSchedule {
  readonly kind = 'DEPRECIATION_EXPENSE';
  protected accountIds(c: ScheduleCatalog) {
    return c.assetExpenseIds;
  }
  protected ownedBy(a: AssetRow, id: string) {
    return a.category.expenseAccountId === id;
  }
  protected ledgerLabels() {
    return { add: 'Beban (debit)', sub: 'Koreksi (kredit)' };
  }

  protected tables(cx: ScheduleContext, assets: AssetRow[], calc: FixedAssetCalc) {
    const { year, to } = cx;
    const periods = MONTH_NAMES.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const live = assets.filter((r) => r.asset.acquisitionDate <= to);
    const glMonth = (i: number) => cx.movement.months[i].debit.minus(cx.movement.months[i].credit);
    const depMonth = periods.map((p) => live.reduce((s, r) => s.plus(calc.depIn(r.asset.id, p)), ZERO));
    const otherMonth = depMonth.map((d, i) => glMonth(i).minus(d));
    const calcRows = this.months(year, (i, f, t, p) => {
      const bookOpen = live.reduce((s, r) => s.plus(calc.costAt(r.asset, p)).minus(calc.accAt(r.asset, p)), ZERO);
      const acc = live.reduce((s, r) => s.plus(calc.accAt(r.asset, t)), ZERO);
      const bookClose = live.reduce((s, r) => s.plus(calc.costAt(r.asset, t)), ZERO).minus(acc);
      return { cells: { month: MONTH_NAMES[i], bookOpen: money(bookOpen), dep: money(depMonth[i]), other: money(otherMonth[i]), expense: money(glMonth(i)), acc: money(acc), bookClose: money(bookClose) }, link: ledgerLink(cx.account.id, f, t) } as ScheduleRow;
    });
    const total = depMonth.reduce((s, v) => s.plus(v), ZERO);
    const other = otherMonth.reduce((s, v) => s.plus(v), ZERO);
    const glTotal = total.plus(other);
    const monthly: ScheduleTable = {
      key: 'depreciation-monthly',
      title: 'Perhitungan penyusutan per bulan',
      note: 'Penyusutan = yang dibukukan dari daftar aset bulan itu; nilai buku = harga perolehan − akumulasi pada akhir bulan. Beban lain = bagian akun ini yang tidak berasal dari daftar aset (mis. amortisasi biaya dibayar di muka).',
      columns: [col('month', 'Bulan', 'text'), col('bookOpen', 'Nilai buku awal bulan'), col('dep', 'Penyusutan aset'), col('other', 'Beban lain di akun ini'), col('expense', 'Total beban akun'), col('acc', 'Akumulasi akhir bulan'), col('bookClose', 'Nilai buku akhir bulan')],
      rows: calcRows,
      total: { month: 'Jumlah tahun berjalan', dep: money(total), other: money(other), expense: money(glTotal) },
    };
    const matrixCols = [col('code', 'Kode', 'text'), col('name', 'Nama aset', 'text'), col('method', 'Metode', 'text'), col('formula', 'Perhitungan', 'text'), ...MONTH_NAMES.map((m, i) => col(`m${i}`, m.slice(0, 3))), col('total', 'Jumlah')];
    const sums = Array<Dec>(12).fill(ZERO);
    const matrix: ScheduleRow[] = live.map(({ asset: a }) => {
      const cells: Record<string, string | null> = { code: a.code, name: a.name, method: METHOD_NAMES[a.method] ?? a.method, formula: formulaOf(a) };
      let row = ZERO;
      periods.forEach((p, i) => {
        const v = calc.depIn(a.id, p);
        sums[i] = sums[i].plus(v);
        row = row.plus(v);
        cells[`m${i}`] = money(v);
      });
      cells.total = money(row);
      return { cells };
    });
    if (!other.isZero()) {
      const cells: Record<string, string | null> = { code: '', name: 'Beban lain di akun ini (bukan dari daftar aset)', method: null, formula: 'Amortisasi biaya dibayar di muka, jurnal penyesuaian atau jurnal manual' };
      otherMonth.forEach((v, i) => (cells[`m${i}`] = money(v)));
      cells.total = money(other);
      matrix.push({ cells });
    }
    const perAsset: ScheduleTable = {
      key: 'depreciation-per-asset',
      title: 'Beban per aset per bulan',
      columns: matrixCols,
      rows: matrix,
      total: { code: 'Jumlah', ...Object.fromEntries(sums.map((s, i) => [`m${i}`, money(s.plus(otherMonth[i]))])), total: money(glTotal) },
    };
    const findings = other.isZero() ? [] : [`Akun ini juga memuat beban ${money(other)} yang bukan penyusutan dari daftar aset (mis. amortisasi biaya dibayar di muka); rinciannya ada pada baris "Beban lain di akun ini".`];
    return { tables: [monthly, perAsset], closing: glTotal, title: 'Rincian aset tetap: beban penyusutan', findings };
  }
}
