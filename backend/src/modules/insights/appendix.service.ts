/**
 * Lampiran Laporan Keuangan: daftar rincian pendukung yang dilampirkan setelah laporan dan CALK.
 *  L1 Daftar umur piutang per pelanggan      L4 Daftar persediaan per produk
 *  L2 Daftar umur utang per pemasok          L5 Neraca saldo
 *  L3 Daftar aset tetap
 * Semua angka bersumber dari pembukuan per tanggal laporan (31 Desember atau hari ini bila tahun berjalan).
 */
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { tenants } from '../../db/schema';
import { AccountingService } from '../accounting/accounting.service';
import { AssetsService } from '../assets/assets.service';
import { AGING_BUCKETS, AgingRow, openBalanceAging } from './aging';

type Cell = string | number | null;
interface Table {
  title?: string;
  columns: string[];
  align: ('left' | 'right')[];
  rows: Cell[][];
  total?: Cell[];
}
interface AppendixSection {
  key: string;
  number: string;
  title: string;
  paragraphs: string[];
  tables: Table[];
}

const n = (v: string | number) => Number(v);
const L: 'left' = 'left';
const R: 'right' = 'right';

@Injectable()
export class AppendixService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly accounting: AccountingService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
  ) {}

  private agingTable(title: string, partyLabel: string, rows: AgingRow[]): Table {
    const body = rows.map((r) => [r.label, ...r.cells, r.cells.reduce((a, b) => a + b, 0)] as Cell[]);
    const sums = AGING_BUCKETS.map((_, i) => rows.reduce((a, r) => a + r.cells[i], 0));
    return {
      title,
      columns: [partyLabel, ...AGING_BUCKETS, 'Jumlah'],
      align: [L, R, R, R, R, R, R],
      rows: body,
      total: ['Jumlah', ...sums, sums.reduce((a, b) => a + b, 0)],
    };
  }

  async build(tenantId: string, year: number) {
    const today = todayJakarta();
    const to = `${year}-12-31` < today ? `${year}-12-31` : today;
    const [[tenant], reporting] = await Promise.all([
      this.db.select().from(tenants).where(eq(tenants.id, tenantId)),
      this.settings.reporting(this.db, tenantId),
    ]);
    const sections: AppendixSection[] = [];
    const push = (s: Omit<AppendixSection, 'number'>) => sections.push({ ...s, number: `L${sections.length + 1}` });
    const empty = (what: string) => `Tidak ada ${what} pada ${to}.`;

    // L1 / L2 umur piutang & utang
    const [ar, ap] = await Promise.all([openBalanceAging(this.db, tenantId, to, 'AR'), openBalanceAging(this.db, tenantId, to, 'AP')]);
    push({
      key: 'receivable-aging',
      title: 'Daftar umur piutang usaha per pelanggan',
      paragraphs: [`Umur dihitung sejak tanggal jatuh tempo faktur sampai ${to}, setelah dikurangi pembayaran dan retur.`],
      tables: ar.length ? [this.agingTable('Piutang usaha', 'Pelanggan', ar)] : [],
    });
    if (!ar.length) sections[sections.length - 1].paragraphs.push(empty('piutang usaha terbuka'));
    push({
      key: 'payable-aging',
      title: 'Daftar umur utang usaha per pemasok',
      paragraphs: [`Umur dihitung sejak tanggal jatuh tempo tagihan sampai ${to}, setelah dikurangi pembayaran dan retur.`],
      tables: ap.length ? [this.agingTable('Utang usaha', 'Pemasok', ap)] : [],
    });
    if (!ap.length) sections[sections.length - 1].paragraphs.push(empty('utang usaha terbuka'));

    // L3 daftar aset tetap
    const assetRows = (await this.assets.list(tenantId, to)).filter((a) => a.status !== 'DISPOSED' || (a.disposalDate && a.disposalDate > to));
    push({
      key: 'fixed-asset-register',
      title: 'Daftar aset tetap',
      paragraphs: [`Akumulasi penyusutan dan nilai buku per ${to}. Aset yang telah dilepas sebelum tanggal tersebut tidak ditampilkan.`],
      tables: assetRows.length
        ? [
            {
              columns: ['Kode', 'Nama aset', 'Kelompok', 'Tgl perolehan', 'Harga perolehan', 'Akumulasi penyusutan', 'Nilai buku'],
              align: [L, L, L, L, R, R, R],
              rows: assetRows.map((a) => [a.code, a.name, a.category.name, a.acquisitionDate, n(a.cost), n(a.accumulated), n(a.bookValue)]),
              total: [
                'Jumlah',
                '',
                '',
                '',
                assetRows.reduce((s, a) => s + n(a.cost), 0),
                assetRows.reduce((s, a) => s + n(a.accumulated), 0),
                assetRows.reduce((s, a) => s + n(a.bookValue), 0),
              ],
            },
          ]
        : [],
    });
    if (!assetRows.length) sections[sections.length - 1].paragraphs.push(empty('aset tetap'));

    // L4 persediaan per produk
    const stock = (
      await this.db.execute<{ sku: string; name: string; category: string | null; qty: string; value: string }>(sql`
        SELECT p.sku, p.name, p.category, SUM(b.qty) AS qty, SUM(b.qty * b.avg_cost) AS value
        FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId}
        GROUP BY p.sku, p.name, p.category
        HAVING SUM(b.qty) <> 0 OR SUM(b.qty * b.avg_cost) <> 0
        ORDER BY p.name`)
    ).rows;
    push({
      key: 'inventory-list',
      title: 'Daftar persediaan per produk',
      paragraphs: ['Jumlah dan nilai persediaan (biaya rata-rata tertimbang) seluruh gudang pada posisi terkini.'],
      tables: stock.length
        ? [
            {
              columns: ['SKU', 'Produk', 'Kategori', 'Jumlah', 'Nilai'],
              align: [L, L, L, R, R],
              rows: stock.map((s) => [s.sku, s.name, s.category ?? 'Lainnya', n(s.qty), Math.round(n(s.value))]),
              total: ['Jumlah', '', '', '', stock.reduce((a, s) => a + Math.round(n(s.value)), 0)],
            },
          ]
        : [],
    });
    if (!stock.length) sections[sections.length - 1].paragraphs.push(empty('persediaan'));

    // L5 neraca saldo
    const tb = await this.accounting.trialBalance(tenantId, undefined, to);
    const tbRows = tb.rows.filter((r) => !r.debit.isZero() || !r.credit.isZero());
    push({
      key: 'trial-balance',
      title: 'Neraca saldo',
      paragraphs: [`Saldo seluruh akun buku besar per ${to}; jumlah debit harus sama dengan jumlah kredit.`],
      tables: [
        {
          columns: ['Akun', 'Debit', 'Kredit'],
          align: [L, R, R],
          rows: tbRows.map((r) => [`${r.code} ${r.name}`, n(D(r.debit).toFixed(2)), n(D(r.credit).toFixed(2))]),
          total: ['Jumlah', n(tb.totalDebit.toFixed(2)), n(tb.totalCredit.toFixed(2))],
        },
      ],
    });

    return {
      year,
      framework: reporting.framework,
      company: {
        name: tenant.name,
        address: tenant.address,
        npwp: tenant.npwp,
        city: reporting.city,
        directorName: reporting.directorName,
        directorTitle: reporting.directorTitle,
      },
      period: { from: `${year}-01-01`, to },
      sections,
    };
  }
}
