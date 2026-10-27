/**
 * Jurnal penyesuaian akhir periode: ringkasan & daftar periksa yang terhubung ke modul lain
 * (aset tetap → penyusutan, jurnal berulang → amortisasi/akrual, piutang → cadangan kerugian,
 * penggajian → akrual gaji, persediaan → stock opname, rekonsiliasi fiskal → pajak penghasilan).
 */
import { Injectable } from '@nestjs/common';
import { DocDate, todayJakarta } from '../../common/utils/dates';
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
  /** Data mana yang diperiksa untuk menentukan status baris ini */
  source?: string;
  /** Bulan belum berakhir: pekerjaan ini baru bisa dikerjakan setelah akhir bulan (tidak dihitung sebagai tunggakan) */
  waiting?: boolean;
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
    const assets = (await this.repo.queryChecklist(this.db, tenantId, to, period)).rows[0];
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
    const rec = (await this.repo.queryRecurringJournal(this.db, to, tenantId)).rows[0];
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
    const prepaid = (await this.repo.queryJournalLine(this.db, tenantId, to)).rows[0];
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
    const ar = (await this.repo.queryInvoice(this.db, tenantId, to)).rows[0];
    const allowance = (await this.repo.queryJournalLineForChecklist(this.db, tenantId, to)).rows[0];
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
    const payroll = (await this.repo.queryPayrollRun(this.db, tenantId, period)).rows[0];
    const hasEmployees = (await this.repo.queryEmployee(this.db, tenantId)).rows[0];
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
    const opname = (await this.repo.queryJournalEntryForChecklist(this.db, tenantId, from, to)).rows[0];
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
      const tax = (await this.repo.queryJournalEntryForChecklist2(this.db, tenantId, year)).rows[0];
      items.push({
        key: 'income-tax',
        title: 'Beban pajak penghasilan tahunan',
        status: tax.n ? 'DONE' : 'TODO',
        message: tax.n ? 'Beban pajak kini & tangguhan sudah dijurnal.' : 'Hitung & jurnal beban pajak kini dan tangguhan dari Rekonsiliasi Fiskal sebelum tutup buku.',
        link: '/fiscal',
      });
    }

    // 8. Penyesuaian manual yang sudah dibuat
    const manual = (await this.repo.queryJournalEntryForChecklist3(this.db, tenantId, from, to)).rows[0];
    items.push({
      key: 'manual',
      title: 'Akrual & penyesuaian lainnya',
      status: 'INFO',
      message: manual.n
        ? `${manual.n} jurnal penyesuaian (total ${rp(D(manual.total))}) bulan ini. Periksa beban yang masih harus dibayar dan pendapatan yang masih harus diterima.`
        : 'Belum ada. Periksa tagihan listrik/air yang belum datang, bunga, komisi, atau pendapatan yang sudah dihasilkan tetapi belum ditagih.',
      amount: D(manual.total).toFixed(2),
    });

    // asal data tiap baris, supaya pengguna tahu daftar ini dihitung dari mana
    const SOURCES: Record<string, string> = {
      depreciation: 'Diperiksa dari: daftar Aset tetap dan jurnal penyusutan bulan ini',
      recurring: 'Diperiksa dari: jurnal berulang (Akuntansi → Jurnal → Berulang)',
      prepaid: 'Diperiksa dari: saldo akun biaya dibayar di muka di buku besar',
      'bad-debt': 'Diperiksa dari: faktur penjualan yang lewat jatuh tempo lebih dari 90 hari',
      payroll: 'Diperiksa dari: data karyawan dan penggajian periode ini',
      'stock-opname': 'Diperiksa dari: penyesuaian stok beralasan stock opname bulan ini',
      'income-tax': 'Diperiksa dari: jurnal beban pajak penghasilan tahun ini',
      manual: 'Diperiksa dari: jurnal penyesuaian yang dibuat manual bulan ini',
    };
    // penyusutan dan jurnal berulang dijurnal bertanggal akhir bulan: sebelum bulan berakhir belum waktunya
    const ended = to <= todayJakarta();
    for (const it of items) {
      it.source = SOURCES[it.key];
      if (!ended && it.status === 'TODO' && (it.key === 'depreciation' || it.key === 'recurring')) {
        it.waiting = true;
        it.message = `Belum waktunya: bulan ${period} baru berakhir ${to.split('-').reverse().join('/')}. Jurnalnya bertanggal akhir bulan, jalankan setelah itu. (${it.message})`;
      }
    }
    return { period, date: to, items };
  }
}
