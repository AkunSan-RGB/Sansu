// Tipe respons API berasal dari paket bersama agar frontend & backend tidak pernah berbeda.
export type * from '@sansu/shared';

// ---------- Rincian & perhitungan akun ----------
export interface ScheduleColumn {
  key: string;
  title: string;
  kind: 'text' | 'money' | 'qty' | 'date' | 'percent';
}
export interface ScheduleRow {
  cells: Record<string, string | number | null>;
  link?: string;
  /** Baris tanpa isi (mis. bulan tanpa mutasi): disembunyikan secara bawaan */
  muted?: boolean;
}
export interface ScheduleTable {
  key: string;
  title: string;
  note?: string;
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  total?: Record<string, string | number | null>;
}
export interface ScheduleMethod {
  basis: string;
  formulas: string[];
  policies?: string[];
}
export interface ScheduleOverviewItem {
  accountId: string;
  code: string;
  name: string;
  type: string;
  reportGroup: string;
  kind: string;
  title: string;
  reported: string;
  computed: string;
  difference: string;
  matches: boolean;
  needsDefinition: boolean;
  findings: number;
}
export interface ScheduleOverview {
  year: number;
  period: { from: string; to: string };
  summary: { accounts: number; matched: number; unmatched: number; needsDefinition: number };
  items: ScheduleOverviewItem[];
}
export interface ScheduleResult {
  account: { id: string; code: string; name: string; type: string; reportGroup: string };
  kind: string;
  title: string;
  year: number;
  period: { from: string; to: string };
  method: ScheduleMethod;
  tables: ScheduleTable[];
  reported: string;
  computed: string;
  difference: string;
  matches: boolean;
  findings: string[];
  needsDefinition: boolean;
}
