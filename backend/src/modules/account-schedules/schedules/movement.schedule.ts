import type { AccountMeta } from '../../accounting/ledger-data';
import { movementTable, type MovementLabels } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleMethod } from '../account-schedule.types';

export interface MovementProfile {
  title: string;
  method: ScheduleMethod;
  labels: MovementLabels;
}

/**
 * Dasar semua jadwal yang rinciannya cukup mutasi buku besar per bulan (template method).
 * Subkelas hanya menyatakan akun mana yang ditangani dan teks metode/judul kolomnya.
 */
export abstract class MovementSchedule implements AccountSchedule {
  abstract readonly kind: string;
  abstract supports(account: AccountMeta, catalog: ScheduleCatalog): boolean;
  protected abstract profile(account: AccountMeta): MovementProfile;
  /** Jadwal umum (cadangan) menandai akun agar jenis jadwalnya ditentukan */
  protected readonly needsDefinition: boolean = false;

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const p = this.profile(cx.account);
    const { table, closing } = movementTable(cx.account, cx.movement, cx.year, p.labels, 'Mutasi per bulan');
    return { title: p.title, method: p.method, tables: [table], closing, needsDefinition: this.needsDefinition };
  }
}

/** Sisi penambahan menurut jenis akun: debit untuk aset/beban, kredit untuk lainnya */
export const sideLabels = (a: AccountMeta, debit: string, credit: string): MovementLabels =>
  a.type === 'ASSET' || a.type === 'EXPENSE' ? { add: debit, sub: credit } : { add: credit, sub: debit };
