/**
 * Jurnal penyesuaian akhir periode: ringkasan & daftar periksa yang terhubung ke modul lain
 * (aset tetap → penyusutan, jurnal berulang → amortisasi/akrual, piutang → cadangan kerugian,
 * penggajian → akrual gaji, persediaan → stock opname, rekonsiliasi fiskal → pajak penghasilan).
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addDays, DocDate } from '../../common/utils/dates';
import { D, Dec } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { frameworkOf } from './coa-sync';
import { AdjustmentsRepository } from './adjustments.repository';

const rp = (v: Dec) => 'Rp ' + Number(v.toFixed(0)).toLocaleString('id-ID');

export type ChecklistStatus = 'DONE' | 'TODO' | 'INFO' | 'NA';
export interface ChecklistItem {
  key: string;
  title: string;
  status: ChecklistStatus;
  message: string;
  amount?: string;
  /** Halaman tempat menyelesaikannya */
  link?: string;
  /** Templat jurnal penyesuaian yang bisa langsung dipakai */
  template?: { kind: string; amount: string; description: string };
}

const lastDay = (period: string): DocDate => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

@Injectable()
export class AdjustmentsService {
  constructor(@InjectDb() private readonly db: Db,
    private readonly repo: AdjustmentsRepository) {}

  private async one<T extends Record<string, unknown>>(q: ReturnType<typeof sql>) {
    return (await this.db.execute<T>(q)).rows[0];
  }

  /** Ringkasan jurnal penyesuaian per sumber dalam rentang tanggal */
  async summary(tenantId: string, from: DocDate, to: DocDate) {
    const rows = await this.repo.queryJournalEntry(this.db, tenantId, from, to);
    return rows.rows.map((r) => ({ sourceType: r.source_type, count: r.n, total: D(r.total).toFixed(2) }));
  }

  /** Daftar periksa penyesuaian untuk satu bulan */
  async checklist(tenantId: string, period: string): Promise<{ period: string; date: DocDate; items: ChecklistItem[] }> {
    const from = `${period}-01`;
    const to = lastDay(period);
    const items: ChecklistItem[] = [];

    // 1. Penyusutan aset tetap
    const assets = await this.one<{ active: number; posted: number; amount: string }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM fixed_assets WHERE tenant_id = ${tenantId} AND status = 'ACTIVE' AND method <> 'NONE'
           AND depreciation_start <= ${to}) AS active,
        (SELECT COUNT(*)::int FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${period}) AS posted,
        (SELECT COALESCE(SUM(amount), 0) FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${period}) AS amount`);
    items.push(
      !assets.active
        ? { key: 'depreciation', title: 'Penyusutan aset tetap', status: 'NA', message: 'Tidak ada aset yang disusutkan pada bulan ini.', link: '/fixed-assets' }
        : assets.posted
          ? {
              key: 'depreciation',
              title: 'Penyusutan aset tetap',
              status: 'DONE',
              message: `${assets.posted} aset sudah disusutkan.`,
              amount: D(assets.amount).toFixed(2),
              link: '/fixed-assets',
            }
          : {
              key: 'depreciation',
              title: 'Penyusutan aset tetap',
              status: 'TODO',
              message: `${assets.active} aset belum disusutkan untuk ${period}. Jalankan dari menu Aset tetap → Penyusutan (jurnal dibuat otomatis).`,
              link: '/fixed-assets',
            },
    );

    // 2. Jurnal berulang (amortisasi dibayar dimuka, akrual rutin)
    const rec = await this.one<{ due: number; active: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE next_date <= ${to})::int AS due, COUNT(*)::int AS active
      FROM recurring_journals WHERE tenant_id = ${tenantId} AND is_active = true AND is_adjustment = true`);
    items.push({
      key: 'recurring',
      title: 'Amortisasi & akrual berulang',
      status: rec.active === 0 ? 'NA' : rec.due ? 'TODO' : 'DONE',
      message:
        rec.active === 0
          ? 'Belum ada jurnal penyesuaian berulang. Buat untuk sewa/asuransi dibayar dimuka agar dibebankan otomatis tiap bulan.'
          : rec.due
            ? `${rec.due} jurnal berulang jatuh tempo s/d ${to} belum diposting.`
            : `${rec.active} jurnal berulang aktif sudah diposting sampai periode ini.`,
      link: '/journals?tab=recurring',
    });

    // 3. Biaya dibayar dimuka yang belum diamortisasi
    const prepaid = await this.one<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${to} AND a.report_group = 'PREPAID'`);
    const prepaidBal = D(prepaid.v);
    items.push({
      key: 'prepaid',
      title: 'Biaya dibayar dimuka',
      status: prepaidBal.gt(0) ? (rec.active ? 'INFO' : 'TODO') : 'NA',
      message: prepaidBal.gt(0)
        ? `Saldo ${rp(prepaidBal)} per ${to.split("-").reverse().join("/")}. Pastikan bagian yang sudah terpakai bulan ini dibebankan (tombol "Buat jurnal").`
        : 'Tidak ada saldo biaya dibayar dimuka.',
      amount: prepaidBal.toFixed(2),
      template: prepaidBal.gt(0) && !rec.active ? { kind: 'PREPAID_EXPENSE', amount: '0', description: `Pembebanan biaya dibayar dimuka ${period}` } : undefined,
    });

    // 4. Cadangan kerugian piutang (piutang lewat jatuh tempo > 90 hari)
    // SAK EMKM (ED Bab 8): piutang dicatat sebesar jumlah tagihan, tanpa cadangan penurunan nilai
    if ((await frameworkOf(this.db, tenantId)) === 'SAK_EMKM') {
      items.push({
        key: 'bad-debt',
        title: 'Piutang tak tertagih',
        status: 'NA',
        message: 'SAK EMKM tidak mengenal cadangan kerugian penurunan nilai. Piutang yang pasti tak tertagih dihapuskan langsung sebagai beban saat itu.',
        link: '/invoices',
      });
    } else {
    const ar = await this.one<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM invoices
      WHERE tenant_id = ${tenantId} AND status <> 'PAID' AND date <= ${to} AND due_date < ${addDays(to, -90)}`);
    const allowance = await this.one<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0) AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${to} AND a.report_group = 'ALLOWANCE_RECEIVABLE'`);
    const gap: Dec = D(ar.v).minus(allowance.v);
    items.push({
      key: 'bad-debt',
      title: 'Cadangan kerugian piutang',
      status: D(ar.v).isZero() ? 'NA' : gap.gt(0) ? 'TODO' : 'DONE',
      message: D(ar.v).isZero()
        ? 'Tidak ada piutang yang lewat jatuh tempo lebih dari 90 hari.'
        : gap.gt(0)
          ? `Piutang macet (>90 hari lewat jatuh tempo) ${rp(D(ar.v))}, cadangan baru ${rp(D(allowance.v))}. Usulan tambahan cadangan ${rp(gap)}.`
          : 'Cadangan sudah menutup piutang macet.',
      amount: gap.gt(0) ? gap.toFixed(2) : undefined,
      link: '/invoices',
      template: gap.gt(0) ? { kind: 'BAD_DEBT', amount: gap.toFixed(2), description: `Cadangan kerugian piutang ${period}` } : undefined,
    });
    }

    // 5. Gaji bulan ini sudah diakui (akrual)
    const payroll = await this.one<{ n: number; posted: number }>(sql`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status <> 'DRAFT')::int AS posted
      FROM payroll_runs WHERE tenant_id = ${tenantId} AND period = ${period}`);
    const hasEmployees = await this.one<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM employees WHERE tenant_id = ${tenantId} AND is_active = true`);
    items.push({
      key: 'payroll',
      title: 'Beban gaji bulan ini',
      status: !hasEmployees.n ? 'NA' : payroll.posted ? 'DONE' : 'TODO',
      message: !hasEmployees.n
        ? 'Belum ada data karyawan.'
        : payroll.posted
          ? 'Penggajian periode ini sudah diposting (beban & utang gaji/BPJS/PPh 21 tercatat).'
          : 'Penggajian periode ini belum diposting — buat & posting di menu Penggajian, atau catat akrual beban gaji.',
      link: '/payroll',
      template: hasEmployees.n && !payroll.posted ? { kind: 'ACCRUED_EXPENSE', amount: '0', description: `Akrual beban gaji ${period}` } : undefined,
    });

    // 6. Stock opname
    const opname = await this.one<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'STOCK_ADJUSTMENT'
        AND date BETWEEN ${from} AND ${to} AND description ILIKE '%STOCK_OPNAME%'`);
    items.push({
      key: 'stock-opname',
      title: 'Stock opname persediaan',
      status: opname.n ? 'DONE' : 'INFO',
      message: opname.n
        ? `${opname.n} penyesuaian hasil stock opname tercatat bulan ini.`
        : 'Belum ada stock opname bulan ini. Selisih persediaan dicatat lewat Inventori → Penyesuaian stok (alasan: Stock opname) agar kartu stok ikut berubah.',
      link: '/inventory',
    });

    // 7. Pajak penghasilan (hanya Desember)
    if (period.endsWith('-12')) {
      const year = period.slice(0, 4);
      const tax = await this.one<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'INCOME_TAX' AND source_id = ${year}
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = journal_entries.id)`);
      items.push({
        key: 'income-tax',
        title: 'Beban pajak penghasilan tahunan',
        status: tax.n ? 'DONE' : 'TODO',
        message: tax.n ? 'Beban pajak kini & tangguhan sudah dijurnal.' : 'Hitung & jurnal beban pajak kini dan tangguhan dari Rekonsiliasi Fiskal sebelum tutup buku.',
        link: '/fiscal',
      });
    }

    // 8. Penyesuaian manual yang sudah dibuat
    const manual = await this.one<{ n: number; total: string }>(sql`
      SELECT COUNT(DISTINCT j.id)::int AS n, COALESCE(SUM(l.debit), 0) AS total FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'ADJUSTMENT' AND j.date BETWEEN ${from} AND ${to}`);
    items.push({
      key: 'manual',
      title: 'Akrual & penyesuaian lainnya',
      status: 'INFO',
      message: manual.n
        ? `${manual.n} jurnal penyesuaian (total ${rp(D(manual.total))}) bulan ini. Periksa beban yang masih harus dibayar dan pendapatan yang masih harus diterima.`
        : 'Belum ada. Periksa tagihan listrik/air yang belum datang, bunga, komisi, atau pendapatan yang sudah dihasilkan tetapi belum ditagih.',
      amount: D(manual.total).toFixed(2),
    });

    return { period, date: to, items };
  }
}
