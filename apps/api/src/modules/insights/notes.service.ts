/**
 * Catatan atas Laporan Keuangan (CALK) yang tersusun otomatis dari data pembukuan:
 * informasi umum, ikhtisar kebijakan akuntansi sesuai SAK EP / SAK EMKM (mengikuti cara sistem mencatat),
 * dan rincian setiap pos laporan dengan angka pembanding. Teks dapat diubah pengguna per tahun.
 */
import { Injectable } from '@nestjs/common';
import { DEPRECIATION_METHOD_LABELS, FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup, LEGAL_FORM_LABELS, type LegalForm, type ReportGroup } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { reportNotes, tenants } from '../../db/schema';
import { StatementLine, StatementsService } from '../accounting/statements.service';
import { AssetsService } from '../assets/assets.module';
import { AGING_BUCKETS, openBalanceAging } from './aging';
import { FiscalService } from './fiscal.service';

type Cell = string | number | null;
export interface NoteTable {
  title?: string;
  columns: string[];
  align: ('left' | 'right')[];
  rows: Cell[][];
  total?: Cell[];
}
export interface NoteSection {
  key: string;
  number: string;
  title: string;
  paragraphs: string[];
  subsections?: { title: string; paragraphs: string[]; table?: NoteTable }[];
  tables: NoteTable[];
  /** Grup laporan yang dirinci catatan ini (untuk kolom "Catatan" di laporan) */
  groups?: ReportGroup[];
  editable: boolean;
  edited: boolean;
}

const n = (v: string | number) => Number(v);
const fmtRp = (v: number) => `Rp${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

@Injectable()
export class NotesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statements: StatementsService,
    private readonly assets: AssetsService,
    private readonly fiscal: FiscalService,
    private readonly settings: SettingsService,
  ) {}

  async build(tenantId: string, year: number) {
    const to = `${year}-12-31` < todayJakarta() ? `${year}-12-31` : todayJakarta();
    const [prod] = (
      await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM production_orders WHERE tenant_id = ${tenantId} AND status = 'COMPLETED'`)
    ).rows;
    const hasProduction = (prod?.n ?? 0) > 0;
    const [[tenant], reporting, pkg, roll, categories, overrides, fiscal] = await Promise.all([
      this.db.select().from(tenants).where(eq(tenants.id, tenantId)),
      this.settings.reporting(this.db, tenantId),
      this.statements.annualPackage(tenantId, year),
      this.assets.rollForward(tenantId, year),
      this.assets.listCategories(tenantId),
      this.db.select().from(reportNotes).where(and(eq(reportNotes.tenantId, tenantId), eq(reportNotes.year, year))),
      this.fiscal.reconcile(tenantId, year).catch(() => null),
    ]);
    const ep = reporting.framework === 'SAK_EP';
    const std = ep ? 'Standar Akuntansi Keuangan Entitas Privat (SAK EP)' : 'Standar Akuntansi Keuangan Entitas Mikro, Kecil, dan Menengah (SAK EMKM)';
    const yPrev = year - 1;
    const legal = LEGAL_FORM_LABELS[reporting.legalForm as LegalForm] ?? reporting.legalForm;
    const sections: NoteSection[] = [];
    const over = new Map(overrides.map((o) => [o.key, o.content]));
    const push = (s: Omit<NoteSection, 'number' | 'edited' | 'editable'> & { editable?: boolean }) => {
      const custom = over.get(s.key);
      sections.push({
        ...s,
        number: String(sections.length + 1),
        paragraphs: custom ? custom.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : s.paragraphs,
        editable: s.editable ?? true,
        edited: !!custom,
      });
    };

    // ---------- 1. Umum ----------
    push({
      key: 'general',
      title: 'Umum',
      paragraphs: [
        `${tenant.name} ("Perusahaan") adalah ${legal.replace(/^[A-Z][a-z]+(?: [A-Z][a-z]+)*/, (m) => m.toLowerCase())}${reporting.establishedYear ? ` yang didirikan pada tahun ${reporting.establishedYear}` : ''}${tenant.address ? ` dan berkedudukan di ${tenant.address}` : ''}.`,
        `Kegiatan usaha Perusahaan adalah ${reporting.businessActivity}.`,
        tenant.npwp ? `Perusahaan terdaftar sebagai Wajib Pajak dengan NPWP ${tenant.npwp}.` : '',
        `Laporan keuangan untuk tahun yang berakhir pada tanggal 31 Desember ${year} disusun dan disetujui untuk diterbitkan oleh ${reporting.directorName || 'manajemen'}${reporting.directorName ? ` selaku ${reporting.directorTitle}` : ''}.`,
      ].filter(Boolean),
      tables: [],
    });

    // ---------- 2. Kebijakan akuntansi ----------
    const policyTable: NoteTable = {
      columns: ['Kelompok aset', 'Metode', 'Masa manfaat', 'Kelompok fiskal'],
      align: ['left', 'left', 'right', 'left'],
      rows: categories.map((c) => [
        c.name,
        DEPRECIATION_METHOD_LABELS[c.method as keyof typeof DEPRECIATION_METHOD_LABELS] ?? c.method,
        c.method === 'NONE' ? '-' : `${c.usefulLifeMonths / 12} tahun`,
        FISCAL_ASSET_GROUP_INFO[c.fiscalGroup as FiscalAssetGroup]?.label ?? c.fiscalGroup,
      ]),
    };
    const taxPolicy =
      reporting.taxScheme === 'FINAL_UMKM'
        ? ['Perusahaan dikenai Pajak Penghasilan final sebesar 0,5% dari peredaran bruto. Beban pajak final diakui dalam laba rugi pada periode pendapatan terkait diakui.']
        : ep
          ? [
              'Beban pajak penghasilan terdiri dari pajak kini dan pajak tangguhan. Pajak kini dihitung dari laba kena pajak dengan tarif yang berlaku, termasuk fasilitas pengurangan tarif Pasal 31E Undang-Undang Pajak Penghasilan bila memenuhi syarat.',
              'Aset dan liabilitas pajak tangguhan diakui atas perbedaan temporer antara jumlah tercatat aset dan liabilitas menurut laporan keuangan dengan dasar pengenaan pajaknya, terutama perbedaan penyusutan aset tetap.',
            ]
          : ['Beban pajak penghasilan diakui sebesar pajak yang terutang menurut ketentuan perpajakan untuk periode berjalan.'];
    push({
      key: 'policies',
      title: 'Ikhtisar kebijakan akuntansi signifikan',
      paragraphs: [],
      subsections: [
        {
          title: 'a. Pernyataan kepatuhan',
          paragraphs: [`Laporan keuangan Perusahaan disusun sesuai dengan ${std} yang diterbitkan oleh Dewan Standar Akuntansi Keuangan Ikatan Akuntan Indonesia.`],
        },
        {
          title: 'b. Dasar penyusunan',
          paragraphs: [
            `Laporan keuangan disusun dengan dasar akrual menggunakan konsep biaya historis, dan disajikan dalam Rupiah (Rp) yang merupakan mata uang fungsional Perusahaan.`,
            ep
              ? 'Laporan arus kas disusun dengan metode tidak langsung dan mengelompokkan arus kas ke dalam aktivitas operasi, investasi, dan pendanaan. Angka pembanding tahun sebelumnya disajikan untuk seluruh jumlah dalam laporan keuangan.'
              : 'Laporan keuangan terdiri dari laporan posisi keuangan, laporan laba rugi, dan catatan atas laporan keuangan.',
          ],
        },
        { title: 'c. Kas dan setara kas', paragraphs: ['Kas dan setara kas terdiri dari kas, kas kecil, dan saldo rekening bank yang tidak dibatasi penggunaannya.'] },
        {
          title: 'd. Piutang usaha',
          paragraphs: [
            'Piutang usaha diakui sebesar jumlah tagihan kepada pelanggan dikurangi cadangan kerugian penurunan nilai. Penurunan nilai diakui bila terdapat bukti objektif bahwa piutang tidak dapat ditagih, antara lain piutang yang telah melewati jatuh tempo lebih dari 90 hari.',
          ],
        },
        {
          title: 'e. Persediaan',
          paragraphs: [
            'Persediaan diukur pada jumlah yang lebih rendah antara biaya perolehan dan harga jual estimasian dikurangi biaya untuk menyelesaikan dan menjual. Biaya perolehan ditentukan dengan metode rata-rata tertimbang (moving average) yang dihitung ulang setiap terjadi pembelian.',
            ...(hasProduction
              ? [
                  'Biaya produk jadi dan barang dalam proses terdiri dari bahan baku, upah langsung, dan alokasi overhead produksi berdasarkan tarif standar per batch. Selisih antara biaya produksi sesungguhnya dan yang dibebankan ke persediaan diakui sebagai beban pokok penjualan pada periode terjadinya.',
                ]
              : []),
          ],
        },
        {
          title: 'f. Aset tetap',
          paragraphs: [
            ...(reporting.capitalizationThreshold > 0
              ? [
                  `Pengeluaran untuk perolehan aset tetap dikapitalisasi bila harga perolehan per unit mencapai ${fmtRp(reporting.capitalizationThreshold)} atau lebih (batas kapitalisasi). Pengeluaran per unit di bawah batas tersebut langsung dibebankan pada laba rugi periode berjalan. Tanah selalu dikapitalisasi tanpa memperhatikan batas kapitalisasi.`,
                ]
              : []),
            'Aset tetap diukur menggunakan model biaya, yaitu harga perolehan dikurangi akumulasi penyusutan dan akumulasi rugi penurunan nilai. Tanah tidak disusutkan. Penyusutan dimulai pada bulan aset siap digunakan dengan taksiran masa manfaat sebagai berikut:',
          ],
          table: policyTable,
        },
        {
          title: 'g. Pengakuan pendapatan dan beban',
          paragraphs: [
            'Pendapatan dari penjualan barang diakui pada saat pengendalian atas barang berpindah kepada pelanggan, yaitu saat barang diserahkan dan faktur diterbitkan, sebesar nilai wajar imbalan setelah dikurangi retur dan potongan. Beban diakui pada saat terjadinya (dasar akrual).',
          ],
        },
        {
          title: 'h. Pajak Pertambahan Nilai (PPN)',
          paragraphs: ['Pendapatan, beban, dan aset diakui neto dari PPN. PPN Masukan yang dapat dikreditkan dan PPN Keluaran disajikan sebagai pajak dibayar dimuka atau utang pajak.'],
        },
        {
          title: 'i. Imbalan kerja',
          paragraphs: ['Imbalan kerja jangka pendek berupa gaji, tunjangan, dan iuran BPJS diakui sebagai beban pada periode pekerja memberikan jasa.'],
        },
        { title: 'j. Pajak penghasilan', paragraphs: taxPolicy },
        {
          title: 'k. Pertimbangan, estimasi, dan asumsi akuntansi signifikan',
          paragraphs: [
            'Penyusunan laporan keuangan mengharuskan manajemen membuat pertimbangan, estimasi, dan asumsi yang memengaruhi jumlah aset, liabilitas, pendapatan, dan beban yang dilaporkan. Hasil sesungguhnya dapat berbeda dari estimasi tersebut. Estimasi dan asumsi ditinjau secara berkala dan perubahannya diakui pada periode terjadinya perubahan.',
            'Sumber utama ketidakpastian estimasi meliputi: taksiran masa manfaat dan nilai sisa aset tetap, cadangan kerugian penurunan nilai piutang usaha, nilai realisasi neto persediaan, serta pengakuan aset dan liabilitas pajak tangguhan.',
          ],
        },
      ],
      tables: [],
    });

    // ---------- Rincian pos ----------
    const posLines = pkg.position.sections.flatMap((s) => s.lines);
    const incLines = pkg.income.lines;
    const accountTable = (lines: StatementLine[], groups: string[], negate = false): NoteTable | null => {
      const rows = lines.filter((l) => groups.includes(l.key)).flatMap((l) => l.accounts ?? []);
      if (!rows.length) return null;
      const sign = negate ? -1 : 1;
      return {
        columns: ['Akun', `${year}`, `${yPrev}`],
        align: ['left', 'right', 'right'],
        rows: rows.map((r) => [r.code ? `${r.code} ${r.name}` : r.name, sign * n(r.amount), sign * n(r.compare)]),
        total: ['Jumlah', sign * rows.reduce((a, r) => a + n(r.amount), 0), sign * rows.reduce((a, r) => a + n(r.compare), 0)],
      };
    };
    const itemNote = (key: string, title: string, groups: ReportGroup[], paragraphs: string[], extra: NoteTable[] = [], from: 'pos' | 'inc' = 'pos', negate = false) => {
      const t = accountTable(from === 'pos' ? posLines : incLines, groups, negate);
      if (!t && !extra.length) return;
      push({ key, title, groups, paragraphs, tables: [...(t ? [t] : []), ...extra] });
    };

    itemNote('cash', 'Kas dan setara kas', ['CASH_EQUIVALENT'], ['Rincian kas dan setara kas pada tanggal laporan posisi keuangan:']);

    // Piutang: per pelanggan & umur
    const arRows = (
      await this.db.execute<{ name: string; v: string }>(sql`
        SELECT c.name, SUM(i.total - i.paid_amount - i.returned_amount) AS v FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date <= ${to} AND i.status <> 'PAID' GROUP BY c.name ORDER BY v DESC LIMIT 10`)
    ).rows.filter((r) => n(r.v) > 0);
    const aging = (
      await this.db.execute<{ bucket: string; v: string }>(sql`
        SELECT CASE WHEN due_date >= ${to} THEN '1. Belum jatuh tempo'
                    WHEN due_date >= (${to}::date - 30) THEN '2. 1–30 hari'
                    WHEN due_date >= (${to}::date - 60) THEN '3. 31–60 hari'
                    WHEN due_date >= (${to}::date - 90) THEN '4. 61–90 hari'
                    ELSE '5. Lebih dari 90 hari' END AS bucket,
               SUM(total - paid_amount - returned_amount) AS v
        FROM invoices WHERE tenant_id = ${tenantId} AND date <= ${to} AND status <> 'PAID' GROUP BY 1 ORDER BY 1`)
    ).rows;
    itemNote(
      'receivables',
      'Piutang usaha',
      ['TRADE_RECEIVABLE', 'ALLOWANCE_RECEIVABLE'],
      ['Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan barang kepada pihak ketiga.'],
      [
        ...(arRows.length
          ? [{ title: 'Berdasarkan pelanggan (10 terbesar)', columns: ['Pelanggan', `${year}`], align: ['left', 'right'] as ('left' | 'right')[], rows: arRows.map((r) => [r.name, n(r.v)]) }]
          : []),
        ...(aging.length
          ? [{ title: 'Berdasarkan umur (sejak jatuh tempo)', columns: ['Umur', `${year}`], align: ['left', 'right'] as ('left' | 'right')[], rows: aging.map((r) => [r.bucket.slice(3), n(r.v)]) }]
          : []),
      ],
    );
    itemNote('other-receivables', 'Piutang lain-lain', ['OTHER_RECEIVABLE'], ['Terutama terdiri dari pinjaman karyawan (kasbon) yang dipotong dari gaji.']);

    const invRows = (
      await this.db.execute<{ category: string | null; v: string }>(sql`
        SELECT p.category, SUM(b.qty * b.avg_cost) AS v FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId} GROUP BY p.category ORDER BY v DESC`)
    ).rows.filter((r) => n(r.v) !== 0);
    const [wd] = (
      await this.db.execute<{ v: string; r: string }>(sql`
        SELECT COALESCE(SUM(total) FILTER (WHERE kind = 'WRITEDOWN'), 0) AS v, COALESCE(SUM(total) FILTER (WHERE kind = 'REVERSAL'), 0) AS r
        FROM inventory_writedowns
        WHERE tenant_id = ${tenantId} AND date BETWEEN ${`${year}-01-01`} AND ${to}`)
    ).rows;
    const writedown = n(wd?.v ?? 0);
    const writeup = n(wd?.r ?? 0);
    const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
    itemNote(
      'inventory',
      'Persediaan',
      ['INVENTORY'],
      [
        writedown > 0 || writeup > 0
          ? `Persediaan terdiri dari barang dagang yang siap dijual. Selama tahun ${year} perusahaan ${[
              writedown > 0 ? `menurunkan nilai persediaan ke nilai realisasi neto sebesar ${rp(writedown)}` : '',
              writeup > 0 ? `memulihkan penurunan nilai sebesar ${rp(writeup)} karena harga jual kembali naik` : '',
            ]
              .filter(Boolean)
              .join(' dan ')}; penurunan dan pemulihan tersebut disajikan dalam beban pokok penjualan.`
          : 'Persediaan terdiri dari barang dagang yang siap dijual. Manajemen berpendapat tidak terdapat persediaan usang yang memerlukan penurunan nilai.',
      ],
      invRows.length
        ? [{ title: 'Berdasarkan kategori produk (posisi terkini)', columns: ['Kategori', 'Nilai'], align: ['left', 'right'], rows: invRows.map((r) => [r.category ?? 'Lainnya', Math.round(n(r.v))]) }]
        : [],
    );
    itemNote('prepaid', 'Biaya dibayar dimuka dan uang muka', ['PREPAID'], ['Biaya dibayar dimuka diamortisasi selama masa manfaatnya.']);
    itemNote('prepaid-tax', 'Pajak dibayar dimuka', ['PREPAID_TAX'], ['Terdiri dari PPN Masukan dan pajak penghasilan yang telah dipotong / dibayar dimuka.']);

    // Aset tetap: tabel mutasi
    if (roll.length || posLines.some((l) => l.key === 'FIXED_ASSET')) {
      const t = (title: string, pick: 'cost' | 'accumulated'): NoteTable => ({
        title,
        columns: ['Kelompok', `1 Jan ${year}`, 'Penambahan', 'Pengurangan', `31 Des ${year}`],
        align: ['left', 'right', 'right', 'right', 'right'],
        rows: roll.map((r) => [r.category, n(r[pick].opening), n(r[pick].additions), n(r[pick].disposals), n(r[pick].closing)]),
        total: ['Jumlah', ...(['opening', 'additions', 'disposals', 'closing'] as const).map((k) => roll.reduce((a, r) => a + n(r[pick][k]), 0))],
      });
      const bvOpen = roll.reduce((a, r) => a + n(r.bookValue.opening), 0);
      const bvClose = roll.reduce((a, r) => a + n(r.bookValue.closing), 0);
      const depYear = roll.reduce((a, r) => a + n(r.accumulated.additions), 0);
      push({
        key: 'fixed-assets',
        title: 'Aset tetap',
        groups: ['FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'INTANGIBLE_ASSET', 'ACCUMULATED_AMORTIZATION'],
        paragraphs: [
          `Nilai tercatat aset tetap adalah ${fmtRp(bvClose)} (${yPrev}: ${fmtRp(bvOpen)}). Beban penyusutan tahun berjalan sebesar ${fmtRp(depYear)} dibebankan pada beban umum dan administrasi.`,
          'Manajemen berpendapat tidak terdapat indikasi penurunan nilai aset tetap pada tanggal pelaporan.',
        ],
        tables: roll.length ? [t('Harga perolehan', 'cost'), t('Akumulasi penyusutan', 'accumulated')] : [],
      });
    }
    const apRows = await openBalanceAging(this.db, tenantId, to, 'AP');
    const apAging = AGING_BUCKETS.map((label, i) => [label, apRows.reduce((a, r) => a + r.cells[i], 0)] as Cell[]).filter((r) => n(r[1] as number) !== 0);
    itemNote(
      'payables',
      'Utang usaha',
      ['TRADE_PAYABLE'],
      ['Utang usaha merupakan utang kepada pemasok barang dagang, tanpa jaminan dan tanpa bunga, dengan jangka waktu kredit 14–60 hari.'],
      [
        ...(apRows.length
          ? [
              {
                title: 'Berdasarkan pemasok (10 terbesar)',
                columns: ['Pemasok', `${year}`],
                align: ['left', 'right'] as ('left' | 'right')[],
                rows: [...apRows].sort((a, b) => b.total - a.total).slice(0, 10).map((r) => [r.label, r.total] as Cell[]),
              },
            ]
          : []),
        ...(apAging.length
          ? [{ title: 'Berdasarkan umur (sejak jatuh tempo)', columns: ['Umur', `${year}`], align: ['left', 'right'] as ('left' | 'right')[], rows: apAging }]
          : []),
      ],
    );
    itemNote('other-payables', 'Utang lain-lain dan beban akrual', ['OTHER_PAYABLE', 'ACCRUED_EXPENSE', 'UNEARNED_REVENUE'], ['Rincian utang lain-lain dan beban yang masih harus dibayar:']);
    itemNote('tax-payable', 'Utang pajak', ['TAX_PAYABLE'], ['Rincian utang pajak:']);
    itemNote('loans', 'Utang bank', ['SHORT_TERM_LOAN', 'LONG_TERM_LOAN'], ['Rincian pinjaman bank. Syarat, suku bunga, dan jaminan pinjaman diungkapkan sesuai perjanjian kredit.']);
    itemNote('employee-benefit', 'Liabilitas imbalan kerja', ['EMPLOYEE_BENEFIT'], ['Liabilitas imbalan pascakerja dihitung sesuai Undang-Undang Ketenagakerjaan yang berlaku.']);
    itemNote('equity', 'Ekuitas', ['SHARE_CAPITAL', 'ADDITIONAL_CAPITAL', 'RETAINED_EARNINGS', 'DIVIDEND', 'OTHER_EQUITY'], ['Rincian ekuitas pada tanggal laporan posisi keuangan:']);

    // Pendapatan per kategori
    const revCat = (
      await this.db.execute<{ category: string | null; v: string }>(sql`
        SELECT category, SUM(v) AS v FROM (
          SELECT p.category, l.line_total AS v FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
            WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${`${year}-01-01`} AND ${to}
          UNION ALL
          SELECT p.category, CASE WHEN o.prices_include_vat AND o.total <> 0 THEN l.line_total * o.subtotal / o.total ELSE l.line_total END FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
            WHERE o.tenant_id = ${tenantId} AND o.date BETWEEN ${`${year}-01-01`} AND ${to}
        ) x GROUP BY category ORDER BY v DESC`)
    ).rows;
    itemNote(
      'revenue',
      'Pendapatan usaha',
      ['SALES_REVENUE', 'SALES_DEDUCTION'],
      ['Seluruh pendapatan berasal dari penjualan barang dagang di dalam negeri.'],
      revCat.length
        ? [{ title: 'Penjualan bruto berdasarkan kategori produk', columns: ['Kategori', `${year}`], align: ['left', 'right'], rows: revCat.map((r) => [r.category ?? 'Lainnya', n(r.v)]) }]
        : [],
      'inc',
    );
    itemNote('cogs', 'Beban pokok penjualan', ['COST_OF_SALES'], ['Beban pokok penjualan dihitung dari biaya rata-rata tertimbang barang yang terjual, termasuk selisih hasil perhitungan fisik persediaan.'], [], 'inc', true);
    itemNote('selling', 'Beban penjualan', ['SELLING_EXPENSE'], ['Rincian beban penjualan:'], [], 'inc', true);
    itemNote('admin', 'Beban umum dan administrasi', ['ADMIN_EXPENSE'], ['Rincian beban umum dan administrasi:'], [], 'inc', true);
    itemNote('other', 'Pendapatan dan beban lain-lain', ['OTHER_INCOME', 'OTHER_EXPENSE', 'FINANCE_INCOME', 'FINANCE_COST'], ['Rincian pendapatan (beban) lain-lain dan keuangan — neto:'], [], 'inc');

    // Pajak penghasilan
    if (fiscal) {
      const rows: Cell[][] = [
        ['Laba sebelum pajak penghasilan (komersial)', n(fiscal.profitBeforeTax)],
        ...fiscal.positive.map((p) => [`Koreksi positif: ${p.label}`, n(p.amount)] as Cell[]),
        ...fiscal.negative.map((p) => [`Koreksi negatif: ${p.label}`, -n(p.amount)] as Cell[]),
        ['Laba fiskal', n(fiscal.fiscalProfit)],
        ...(n(fiscal.lossCarryforward) ? [['Kompensasi kerugian fiskal', -n(fiscal.lossCarryforward)] as Cell[]] : []),
        ['Penghasilan kena pajak (dibulatkan)', n(fiscal.pkp)],
        ['Pajak penghasilan terutang', n(fiscal.taxDue)],
        ['Dikurangi kredit pajak (PPh 22, 23, 25)', -n(fiscal.credits)],
        [n(fiscal.pph29) >= 0 ? 'Kurang bayar (PPh Pasal 29)' : 'Lebih bayar', n(fiscal.pph29)],
      ];
      push({
        key: 'income-tax',
        title: 'Pajak penghasilan',
        groups: ['INCOME_TAX'],
        paragraphs:
          fiscal.scheme === 'FINAL_UMKM'
            ? [`Pajak penghasilan final 0,5% atas peredaran bruto ${fmtRp(n(fiscal.grossRevenue))} adalah ${fmtRp(n(fiscal.taxDue))}.`]
            : [
                `Rekonsiliasi antara laba sebelum pajak menurut laporan laba rugi dengan penghasilan kena pajak tahun ${year}. Dasar perhitungan: ${fiscal.method}.`,
                ...(fiscal.deferred && n(fiscal.deferred.target) !== 0
                  ? [`Perbedaan temporer atas aset tetap dan penurunan nilai persediaan sebesar ${fmtRp(n(fiscal.deferred.temporaryDifference))} menghasilkan ${n(fiscal.deferred.target) >= 0 ? 'aset' : 'liabilitas'} pajak tangguhan ${fmtRp(Math.abs(n(fiscal.deferred.target)))}.`]
                  : []),
              ],
        tables: fiscal.scheme === 'FINAL_UMKM' ? [] : [{ columns: ['Keterangan', `${year}`], align: ['left', 'right'], rows }],
      });
    }

    // Komitmen: pesanan pembelian terkonfirmasi yang belum ditagih
    const commitRows = (
      await this.db.execute<{ number: string; supplier: string; date: string; total: string }>(sql`
        SELECT o.number, s.name AS supplier, o.date, o.total FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.status = 'CONFIRMED' AND o.date <= ${to} ORDER BY o.date, o.number`)
    ).rows;
    const commitTotal = commitRows.reduce((a, r) => a + n(r.total), 0);
    push({
      key: 'commitments',
      title: 'Komitmen dan kontinjensi',
      paragraphs: [
        commitRows.length
          ? `Pada tanggal laporan, Perusahaan memiliki komitmen pembelian atas ${commitRows.length} pesanan pembelian yang telah dikonfirmasi kepada pemasok namun belum diterima dan ditagih, dengan nilai sebesar ${fmtRp(commitTotal)}.`
          : 'Pada tanggal laporan, tidak terdapat komitmen pembelian yang signifikan atas pesanan pembelian yang telah dikonfirmasi namun belum ditagih.',
        'Tidak terdapat kewajiban kontinjensi yang signifikan, termasuk perkara hukum, pada tanggal laporan keuangan.',
      ],
      tables: commitRows.length
        ? [
            {
              title: 'Pesanan pembelian terkonfirmasi yang belum ditagih',
              columns: ['No. PO', 'Pemasok', 'Tanggal', 'Nilai'],
              align: ['left', 'left', 'left', 'right'],
              rows: commitRows.map((r) => [r.number, r.supplier, r.date, n(r.total)]),
              total: ['Jumlah', '', '', commitTotal],
            },
          ]
        : [],
    });
    push({
      key: 'related-parties',
      title: 'Transaksi dengan pihak berelasi',
      paragraphs: [`Tidak terdapat transaksi maupun saldo yang signifikan dengan pihak berelasi pada tahun ${year}.`],
      tables: [],
    });

    push({
      key: 'subsequent',
      title: 'Peristiwa setelah periode pelaporan',
      paragraphs: ['Tidak terdapat peristiwa penting setelah tanggal laporan posisi keuangan yang memerlukan penyesuaian atau pengungkapan dalam laporan keuangan.'],
      tables: [],
    });
    push({
      key: 'approval',
      title: 'Tanggung jawab manajemen dan persetujuan laporan keuangan',
      paragraphs: [
        `Manajemen bertanggung jawab atas penyusunan dan penyajian wajar laporan keuangan ini sesuai ${ep ? 'SAK EP' : 'SAK EMKM'}. Laporan keuangan disetujui untuk diterbitkan${reporting.city ? ` di ${reporting.city}` : ''}${reporting.directorName ? ` oleh ${reporting.directorName}` : ''}.`,
      ],
      tables: [],
    });

    // Peta grup laporan → nomor catatan (untuk kolom "Catatan" di laporan)
    const refs: Partial<Record<ReportGroup, string>> = {};
    for (const s of sections) s.groups?.forEach((g) => (refs[g] = s.number));
    return {
      year,
      framework: reporting.framework,
      company: { name: tenant.name, address: tenant.address, npwp: tenant.npwp, legalForm: legal, city: reporting.city, directorName: reporting.directorName, directorTitle: reporting.directorTitle },
      period: { from: pkg.from, to: pkg.to },
      sections,
      refs,
      totals: { assets: D(pkg.position.totals.assets.amount).toFixed(2), netProfit: pkg.income.netProfit },
    };
  }

  async save(tenantId: string, year: number, key: string, content: string) {
    await this.db
      .insert(reportNotes)
      .values({ tenantId, year, key, content })
      .onConflictDoUpdate({ target: [reportNotes.tenantId, reportNotes.year, reportNotes.key], set: { content, updatedAt: new Date() } });
    return this.build(tenantId, year);
  }

  async reset(tenantId: string, year: number, key: string) {
    await this.db.delete(reportNotes).where(and(eq(reportNotes.tenantId, tenantId), eq(reportNotes.year, year), eq(reportNotes.key, key)));
    return this.build(tenantId, year);
  }
}
