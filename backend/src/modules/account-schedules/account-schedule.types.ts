import type { AccountMeta } from '../accounting/ledger-data';
import type { Dec } from '../../common/utils/money';

export type Cell = string | number | null;

/** Satu kolom tabel jadwal; halaman menggambar tabel hanya dari definisi ini (tanpa kondisi per akun). */
export interface ScheduleColumn {
  key: string;
  title: string;
  kind: 'text' | 'money' | 'qty' | 'date' | 'percent';
}

export interface ScheduleRow {
  cells: Record<string, Cell>;
  /** Rute halaman tempat baris ini ditelusuri ke buku besar atau dokumen asal */
  link?: string;
}

export interface ScheduleTable {
  key: string;
  title: string;
  /** Penjelasan singkat di bawah judul tabel */
  note?: string;
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  total?: Record<string, Cell>;
}

/** Dasar pengakuan, rumus, dan kebijakan yang dipakai akun itu */
export interface ScheduleMethod {
  basis: string;
  formulas: string[];
  policies?: string[];
}

/** Mutasi satu akun: saldo awal (sebelum 1 Januari) dan debit/kredit per bulan (indeks 0 = Januari) */
export interface AccountMovement {
  openingDebit: Dec;
  openingCredit: Dec;
  months: { debit: Dec; credit: Dec }[];
}

/** Fakta lintas akun yang dibutuhkan registri untuk menjodohkan akun dengan jadwalnya */
export interface ScheduleCatalog {
  assetCostIds: Set<string>;
  assetAccumulatedIds: Set<string>;
  assetExpenseIds: Set<string>;
  /** Akun kas yang berupa rekening bank (akun bank bawaan atau yang sudah punya rekening koran) */
  bankAccountIds: Set<string>;
}

export interface ScheduleContext {
  tenantId: string;
  year: number;
  from: string;
  to: string;
  account: AccountMeta;
  /** Mutasi buku besar akun ini (jurnal penutup tidak dihitung untuk akun nominal) */
  movement: AccountMovement;
  /** Seluruh akun perusahaan dan mutasinya, untuk jadwal yang membandingkan beberapa akun (mis. persediaan) */
  accounts: AccountMeta[];
  movementOf(accountId: string): AccountMovement;
}

/** Hasil satu jadwal sebelum dibandingkan dengan laporan keuangan */
export interface ScheduleBody {
  title: string;
  method: ScheduleMethod;
  tables: ScheduleTable[];
  /** Saldo akhir menurut perhitungan jadwal (tanda alami akun: aset/beban = debit−kredit, lainnya kredit−debit) */
  closing: Dec;
  /** Catatan temuan dari jadwal sendiri (mis. rincian dokumen tidak sama dengan buku besar) */
  findings?: string[];
  /** Akun belum punya jadwal khusus: dipakai jadwal umum dan ditandai agar metodenya ditentukan */
  needsDefinition?: boolean;
}

/**
 * Kontrak jadwal akun. Satu kelas per jenis akun; ScheduleRegistry menjodohkan akun dengan kelas pertama yang `supports`.
 * Menambah jenis akun = menambah satu kelas, tanpa mengubah halaman, service, atau jadwal lain.
 */
export interface AccountSchedule {
  readonly kind: string;
  supports(account: AccountMeta, catalog: ScheduleCatalog): boolean;
  build(cx: ScheduleContext): Promise<ScheduleBody>;
}

export interface ScheduleResult {
  account: { id: string; code: string; name: string; type: string; reportGroup: string };
  kind: string;
  title: string;
  year: number;
  period: { from: string; to: string };
  method: ScheduleMethod;
  tables: ScheduleTable[];
  /** Saldo akhir akun ini di laporan keuangan */
  reported: string;
  /** Saldo akhir menurut jadwal */
  computed: string;
  difference: string;
  matches: boolean;
  findings: string[];
  needsDefinition: boolean;
}
