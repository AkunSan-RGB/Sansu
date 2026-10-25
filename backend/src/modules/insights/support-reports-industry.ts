import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { todayJakarta } from '../../common/utils/dates';
import { SupportQueries } from './support-queries';
import { Cell, num, CAP, L, R, sum, withRest } from './support-shared';

@Injectable()
export class IndustrySupportReports {
  constructor(private readonly queries: SupportQueries) {}

  // ------------------------------------------------------------------ Kasir (Ritel & F&B)
  async pos(tenantId: string, from: string, to: string) {
    const orderIn = sql`o.tenant_id = ${tenantId} AND o.date BETWEEN ${from} AND ${to}`;
    const cashiers = await this.queries.rows<{
      name: string;
      n: number;
      sub: string;
      tax: string;
      tot: string;
      rtot: string;
    }>(sql`
      SELECT u.name, COUNT(o.id)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax, SUM(o.total)::text AS tot,
        COALESCE(SUM((SELECT SUM(r.total) FROM pos_returns r WHERE r.order_id = o.id AND r.date <= ${to})), 0)::text AS rtot
      FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id JOIN users u ON u.id = s.user_id
      WHERE ${orderIn} GROUP BY u.id, u.name ORDER BY SUM(o.total) DESC`);
    const cashierRows: Cell[][] = cashiers.map((r) => [
      r.name,
      r.n,
      num(r.sub),
      num(r.tax),
      num(r.tot),
      num(r.rtot),
      num(r.tot) - num(r.rtot),
    ]);
    const sessions = await this.queries.rows<{
      number: string;
      name: string;
      opened: string;
      closed: string | null;
      status: string;
      n: number;
      tot: string;
      expected: string | null;
      counted: string | null;
      diff: string | null;
    }>(sql`
      SELECT s.number, u.name, to_char(s.opened_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS opened,
        to_char(s.closed_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS closed, s.status::text AS status,
        (SELECT COUNT(*)::int FROM pos_orders o WHERE o.session_id = s.id) AS n,
        COALESCE((SELECT SUM(o.total) FROM pos_orders o WHERE o.session_id = s.id), 0)::text AS tot,
        s.expected_cash::text AS expected, s.counted_cash::text AS counted, s.difference::text AS diff
      FROM pos_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.tenant_id = ${tenantId} AND (s.opened_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${from} AND ${to}
      ORDER BY s.opened_at LIMIT ${CAP}`);
    const sessionRows: Cell[][] = sessions.map((r) => [
      r.number,
      r.name,
      r.opened,
      r.closed ?? '-',
      r.status === 'OPEN' ? 'Terbuka' : 'Ditutup',
      r.n,
      num(r.tot),
      r.expected === null ? null : num(r.expected),
      r.counted === null ? null : num(r.counted),
      r.diff === null ? null : num(r.diff),
    ]);
    const methods = await this.queries.rows<{ method: string; n: number; amt: string }>(sql`
      SELECT p.method::text AS method, COUNT(DISTINCT p.order_id)::int AS n, SUM(p.amount)::text AS amt
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn} GROUP BY p.method ORDER BY SUM(p.amount) DESC`);
    const LABEL: Record<string, string> = {
      CASH: 'Tunai',
      QRIS: 'QRIS',
      DEBIT: 'Kartu debit',
      TRANSFER: 'Transfer',
      PLATFORM: 'Platform pesan-antar',
    };
    const methodRows: Cell[][] = methods.map((r) => [LABEL[r.method] ?? r.method, r.n, num(r.amt)]);

    const [docs] = await this.queries.rows<{
      sub: string;
      rsub: string;
      tot: string;
      pay: string;
      nonplat: string;
    }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL)::text AS sub,
             (SELECT COALESCE(SUM(subtotal), 0) FROM pos_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS rsub,
             (SELECT COALESCE(SUM(total), 0) FROM pos_orders o WHERE ${orderIn})::text AS tot,
             (SELECT COALESCE(SUM(p.amount), 0) FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn})::text AS pay,
             (SELECT COALESCE(SUM(p.amount), 0) FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn} AND p.method <> 'PLATFORM')::text AS nonplat`);
    const [gl] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to}
        AND (j.id IN (SELECT journal_id FROM pos_orders WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)
          OR j.id IN (SELECT journal_id FROM pos_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL))`);
    const [diffs] = await this.queries.rows<{ sessions: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(difference), 0) FROM pos_sessions WHERE tenant_id = ${tenantId} AND status = 'CLOSED' AND (closed_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${from} AND ${to})::text AS sessions,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND j.source_type = 'POS_CLOSE' AND a.system_key = 'CASH_DIFF' AND j.date BETWEEN ${from} AND ${to})::text AS gl`);
    const [dep] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit), 0)::text AS v FROM journal_lines l JOIN pos_orders o ON o.journal_id = l.journal_id JOIN pos_sessions s ON s.id = o.session_id
      WHERE ${orderIn} AND l.account_id IN (s.cash_account_id, s.bank_account_id)`);

    return {
      title: 'Laporan Pendukung Kasir (Ritel & F&B)',
      summary:
        'Penjualan kasir per kasir, sesi, dan metode bayar, selisih uang di laci, serta pencocokan dengan pendapatan, kas, dan bank di buku besar.',
      reconciliation: [
        this.queries.recon(
          'pos-revenue',
          'Penjualan kasir neto vs akun pendapatan',
          { label: 'Pesanan kasir − retur kasir (DPP)', value: Number(docs.sub) - Number(docs.rsub) },
          { label: 'Akun pendapatan pada jurnal kasir & retur kasir', value: Number(gl.v) },
          'Selisih berarti jurnal kasir diubah di luar transaksi kasir.',
        ),
        this.queries.recon(
          'pos-payments',
          'Pembayaran vs total pesanan',
          { label: 'Total pesanan kasir', value: Number(docs.tot) },
          { label: 'Jumlah pembayaran tercatat (semua metode)', value: Number(docs.pay) },
          'Tunai dihitung bersih setelah kembalian. Selisih menunjukkan pesanan yang pembayarannya tidak lengkap.',
        ),
        this.queries.recon(
          'pos-deposit',
          'Pembayaran tunai & non-tunai vs kas/bank',
          { label: 'Pembayaran bukan platform', value: Number(docs.nonplat) },
          { label: 'Debit ke akun laci kas & rekening kasir pada jurnal pesanan', value: Number(dep.v) },
          'Memastikan uang kasir benar-benar masuk ke laci kas dan rekening yang dipilih pada sesi.',
        ),
        this.queries.recon(
          'pos-cash-diff',
          'Selisih kas sesi ditutup vs akun selisih kas',
          { label: 'Jumlah selisih (dihitung − seharusnya) pada sesi ditutup', value: Number(diffs.sessions) },
          { label: 'Akun Selisih Kas Kasir pada jurnal tutup kasir (kredit − debit)', value: Number(diffs.gl) },
          'Selisih kurang tercatat sebagai beban, lebih sebagai pengurang beban.',
        ),
      ],
      sections: [
        {
          key: 'pos-cashier',
          number: 'K1',
          title: 'Penjualan per kasir',
          paragraphs: ['Berdasarkan sesi tempat pesanan dibuat. Retur kasir dihitung sampai tanggal akhir.'],
          tables: [
            {
              columns: ['Kasir', 'Pesanan', 'DPP', 'Pajak', 'Total', 'Retur', 'Neto'],
              align: [L, R, R, R, R, R, R],
              rows: cashierRows,
              total: cashierRows.length
                ? [
                    'Jumlah',
                    sum(cashierRows, 1),
                    sum(cashierRows, 2),
                    sum(cashierRows, 3),
                    sum(cashierRows, 4),
                    sum(cashierRows, 5),
                    sum(cashierRows, 6),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'pos-method',
          number: 'K2',
          title: 'Penjualan per metode bayar',
          paragraphs: ['Tunai bersih setelah kembalian. Pesanan dengan beberapa metode dihitung sekali per metode.'],
          tables: [
            {
              columns: ['Metode', 'Pesanan', 'Jumlah'],
              align: [L, R, R],
              rows: methodRows,
              total: methodRows.length ? ['Jumlah', null, sum(methodRows, 2)] : undefined,
            },
          ],
        },
        {
          key: 'pos-session',
          number: 'K3',
          title: 'Sesi kasir dan selisih uang di laci',
          paragraphs: [
            'Selisih = uang dihitung − uang seharusnya. Selisih kurang dicatat sebagai beban; periksa sesi dengan selisih berulang.',
          ],
          tables: [
            {
              columns: [
                'Sesi',
                'Kasir',
                'Dibuka',
                'Ditutup',
                'Status',
                'Pesanan',
                'Penjualan',
                'Seharusnya',
                'Dihitung',
                'Selisih',
              ],
              align: [L, L, L, L, L, R, R, R, R, R],
              rows: sessionRows,
              total: sessionRows.length
                ? [
                    'Jumlah',
                    null,
                    null,
                    null,
                    null,
                    sum(sessionRows, 5),
                    sum(sessionRows, 6),
                    sum(sessionRows, 7),
                    sum(sessionRows, 8),
                    sum(sessionRows, 9),
                  ]
                : undefined,
            },
          ],
        },
      ],
    };
  }

  // ------------------------------------------------------------------ F&B
  async fnb(tenantId: string, from: string, to: string) {
    const orderIn = sql`o.tenant_id = ${tenantId} AND o.date BETWEEN ${from} AND ${to}`;
    const menu = await this.queries.rows<{
      sku: string;
      name: string;
      qty: string;
      sales: string;
      recipe: boolean;
    }>(sql`
      SELECT p.sku, p.name, SUM(l.qty * l.uom_factor)::text AS qty, SUM(l.line_total)::text AS sales, bool_or(l.from_recipe) AS recipe
      FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
      WHERE ${orderIn} GROUP BY p.id, p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT ${CAP}`);
    const menuRowsAll: Cell[][] = menu.map((r) => [r.sku, r.name, num(r.qty), num(r.sales), r.recipe ? 'Ya' : 'Tidak']);
    const menuRows = withRest(menuRowsAll, 100, [2, 3]);
    const types = await this.queries.rows<{ t: string | null; n: number; sub: string; tax: string; tot: string }>(sql`
      SELECT o.order_type AS t, COUNT(*)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax, SUM(o.total)::text AS tot
      FROM pos_orders o WHERE ${orderIn} GROUP BY o.order_type ORDER BY SUM(o.total) DESC`);
    const TYPE: Record<string, string> = { DINE_IN: 'Makan di tempat', TAKEAWAY: 'Bawa pulang', DELIVERY: 'Antar' };
    const typeRows: Cell[][] = types.map((r) => [
      r.t ? (TYPE[r.t] ?? r.t) : 'Tidak dicatat',
      r.n,
      num(r.sub),
      num(r.tax),
      num(r.tot),
    ]);
    const taxes = await this.queries.rows<{ k: string; n: number; sub: string; tax: string; rtax: string }>(sql`
      SELECT o.tax_kind AS k, COUNT(*)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax,
        COALESCE(SUM((SELECT SUM(r.tax_amount) FROM pos_returns r WHERE r.order_id = o.id AND r.date BETWEEN ${from} AND ${to})), 0)::text AS rtax
      FROM pos_orders o WHERE ${orderIn} GROUP BY o.tax_kind ORDER BY 1`);
    const taxRows: Cell[][] = taxes.map((r) => [
      r.k === 'LOCAL' ? 'Pajak restoran daerah (PB1/PBJT)' : 'PPN',
      r.n,
      num(r.sub),
      num(r.tax),
      num(r.rtax),
      num(r.tax) - num(r.rtax),
    ]);
    const channels = await this.queries.rows<{
      c: string;
      n: number;
      tot: string;
      fee: string;
      settled: string;
      open: string;
    }>(sql`
      SELECT o.channel AS c, COUNT(*)::int AS n, SUM(o.total)::text AS tot, SUM(o.platform_fee)::text AS fee,
        COALESCE(SUM(o.total - o.platform_fee) FILTER (WHERE o.settlement_id IS NOT NULL), 0)::text AS settled,
        COALESCE(SUM(o.total - o.platform_fee) FILTER (WHERE o.settlement_id IS NULL), 0)::text AS open
      FROM pos_orders o WHERE ${orderIn} AND o.channel IS NOT NULL GROUP BY o.channel ORDER BY 1`);
    const channelRows: Cell[][] = channels.map((r) => [
      r.c,
      r.n,
      num(r.tot),
      num(r.fee),
      num(r.tot) - num(r.fee),
      num(r.settled),
      num(r.open),
    ]);
    const settlements = await this.queries.rows<{
      number: string;
      channel: string;
      d: string;
      n: number;
      expected: string;
      received: string;
      diff: string;
    }>(sql`
      SELECT number, channel, date::text AS d, order_count AS n, expected::text AS expected, received::text AS received, difference::text AS diff
      FROM pos_platform_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND date BETWEEN ${from} AND ${to} ORDER BY date, number LIMIT ${CAP}`);
    const settleRows: Cell[][] = settlements.map((r) => [
      r.number,
      r.channel,
      r.d,
      r.n,
      num(r.expected),
      num(r.received),
      num(r.diff),
    ]);

    // Bahan terpakai: seharusnya menurut resep aktif vs yang keluar dari kartu stok pada pesanan kasir
    const usage = await this.queries.rows<{ sku: string; name: string; expected: string; actual: string }>(sql`
      WITH menu_line AS (
        SELECT DISTINCT ON (l.id) l.id, l.product_id, l.qty * l.uom_factor AS q, b.id AS bom_id, b.output_qty
        FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        JOIN boms b ON b.tenant_id = ${tenantId} AND b.product_id = l.product_id AND b.created_at <= o.created_at
        WHERE ${orderIn} AND l.from_recipe ORDER BY l.id, b.created_at DESC),
      need AS (
        SELECT bl.product_id, SUM(m.q * bl.qty / NULLIF(m.output_qty, 0)) AS expected
        FROM menu_line m JOIN bom_lines bl ON bl.bom_id = m.bom_id GROUP BY bl.product_id),
      moved AS (
        SELECT sm.product_id, SUM(-sm.qty) AS q FROM stock_moves sm JOIN pos_orders o ON o.id::text = sm.ref_id
        WHERE sm.tenant_id = ${tenantId} AND sm.ref_type = 'POS_ORDER' AND ${orderIn} AND sm.product_id IN (SELECT product_id FROM need) GROUP BY sm.product_id),
      direct AS (
        SELECT l.product_id, SUM(l.qty * l.uom_factor) AS q FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        WHERE ${orderIn} AND NOT l.from_recipe AND l.product_id IN (SELECT product_id FROM need) GROUP BY l.product_id)
      SELECT p.sku, p.name, need.expected::text AS expected, (COALESCE(moved.q, 0) - COALESCE(direct.q, 0))::text AS actual
      FROM need JOIN products p ON p.id = need.product_id LEFT JOIN moved ON moved.product_id = need.product_id LEFT JOIN direct ON direct.product_id = need.product_id
      ORDER BY p.name LIMIT ${CAP}`);
    const usageRows: Cell[][] = usage.map((r) => [
      r.sku,
      r.name,
      num(r.expected),
      num(r.actual),
      Math.round((num(r.actual) - num(r.expected)) * 10000) / 10000,
    ]);
    const usageOk = usageRows.filter((r) => Math.abs(Number(r[4])) < 0.001).length;

    const [cogs] = await this.queries.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(cogs_amount), 0) FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL)::text AS doc,
             (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'COGS' AND j.id IN (SELECT journal_id FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL))::text AS gl`);
    const [pb1] = await this.queries.rows<{ doc: string; gl: string }>(sql`
      SELECT ((SELECT COALESCE(SUM(o.tax_amount), 0) FROM pos_orders o WHERE ${orderIn} AND o.tax_kind = 'LOCAL' AND o.journal_id IS NOT NULL)
              - (SELECT COALESCE(SUM(r.tax_amount), 0) FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${from} AND ${to} AND o.tax_kind = 'LOCAL' AND r.journal_id IS NOT NULL))::text AS doc,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'LOCAL_TAX' AND j.date BETWEEN ${from} AND ${to}
                AND (j.id IN (SELECT journal_id FROM pos_orders WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)
                  OR j.id IN (SELECT journal_id FROM pos_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)))::text AS gl`);
    const [plat] = await this.queries.rows<{ open: string }>(sql`
      SELECT COALESCE(SUM(o.total - o.platform_fee), 0)::text AS open FROM pos_orders o
      LEFT JOIN pos_platform_settlements s ON s.id = o.settlement_id AND s.status = 'POSTED'
      WHERE o.tenant_id = ${tenantId} AND o.channel IS NOT NULL AND o.date <= ${to} AND (s.id IS NULL OR s.date > ${to})`);
    const platGl = await this.queries.glBalance(tenantId, to, sql`a.system_key = 'PLATFORM_RECEIVABLE'`);

    return {
      title: 'Laporan Pendukung F&B',
      summary:
        'Penjualan per menu dan jenis pesanan, pajak restoran daerah, pencairan platform pesan-antar, dan pemakaian bahan dibanding resep.',
      reconciliation: [
        this.queries.recon(
          'fnb-pb1',
          'Pajak restoran daerah vs akun pajak daerah',
          { label: 'Pajak daerah pesanan − retur (dokumen)', value: Number(pb1.doc) },
          { label: 'Akun pajak restoran daerah pada jurnal kasir', value: Number(pb1.gl) },
          'Dasar angka setoran PB1/PBJT. Selisih berarti jurnal pajak diubah di luar transaksi kasir.',
        ),
        this.queries.recon(
          'fnb-platform',
          'Pesanan platform belum cair vs piutang platform',
          { label: 'Pesanan online belum dicairkan (bersih dari komisi)', value: Number(plat.open) },
          { label: 'Saldo akun Piutang Platform di buku besar', value: platGl },
          'Selisih biasanya dari jurnal manual ke akun piutang platform atau pencairan yang dibatalkan.',
        ),
        this.queries.recon(
          'fnb-cogs',
          'HPP pesanan kasir vs akun HPP',
          { label: 'HPP tercatat pada pesanan', value: Number(cogs.doc) },
          { label: 'Akun HPP pada jurnal pesanan', value: Number(cogs.gl) },
          'HPP menu adalah nilai bahan yang dipotong dari persediaan.',
        ),
        this.queries.recon(
          'fnb-usage',
          'Bahan sesuai resep',
          { label: 'Bahan yang dicek', value: usageRows.length },
          { label: 'Bahan dengan pemakaian sama dengan resep', value: usageOk },
          'Memakai resep yang berlaku saat pesanan dibuat. Selisih muncul bila isi resep diubah tanpa membuat resep baru, atau kartu stok bahan dikoreksi.',
        ),
      ],
      sections: [
        {
          key: 'fnb-menu',
          number: 'F1',
          title: 'Penjualan per menu (100 teratas, sisanya digabung)',
          paragraphs: ['Jumlah dalam satuan dasar. "Dari resep" berarti bahan menu dipotong sesuai resep saat dijual.'],
          tables: [
            {
              columns: ['SKU', 'Menu', 'Jumlah', 'Penjualan', 'Dari resep'],
              align: [L, L, R, R, L],
              rows: menuRows,
              total: menuRows.length ? ['Jumlah', null, sum(menuRows, 2), sum(menuRows, 3), null] : undefined,
            },
          ],
        },
        {
          key: 'fnb-type',
          number: 'F2',
          title: 'Penjualan per jenis pesanan',
          paragraphs: [],
          tables: [
            {
              columns: ['Jenis', 'Pesanan', 'DPP', 'Pajak', 'Total'],
              align: [L, R, R, R, R],
              rows: typeRows,
              total: typeRows.length
                ? ['Jumlah', sum(typeRows, 1), sum(typeRows, 2), sum(typeRows, 3), sum(typeRows, 4)]
                : undefined,
            },
          ],
        },
        {
          key: 'fnb-tax',
          number: 'F3',
          title: 'Pajak penjualan kasir',
          paragraphs: [
            'Pajak restoran daerah (PB1/PBJT) menggantikan PPN pada pesanan kasir bila dinyalakan di pengaturan.',
          ],
          tables: [
            {
              columns: ['Jenis pajak', 'Pesanan', 'DPP', 'Pajak', 'Retur', 'Pajak neto'],
              align: [L, R, R, R, R, R],
              rows: taxRows,
              total: taxRows.length
                ? ['Jumlah', sum(taxRows, 1), sum(taxRows, 2), sum(taxRows, 3), sum(taxRows, 4), sum(taxRows, 5)]
                : undefined,
            },
          ],
        },
        {
          key: 'fnb-platform',
          number: 'F4',
          title: 'Pesanan online dan pencairan platform',
          paragraphs: [
            'Piutang platform = total pesanan − komisi, hingga dicairkan. Selisih pencairan menunjukkan dana yang masuk berbeda dari seharusnya.',
          ],
          tables: [
            {
              title: 'Pesanan per kanal',
              columns: ['Kanal', 'Pesanan', 'Total', 'Komisi', 'Bersih', 'Sudah cair', 'Belum cair'],
              align: [L, R, R, R, R, R, R],
              rows: channelRows,
              total: channelRows.length
                ? [
                    'Jumlah',
                    sum(channelRows, 1),
                    sum(channelRows, 2),
                    sum(channelRows, 3),
                    sum(channelRows, 4),
                    sum(channelRows, 5),
                    sum(channelRows, 6),
                  ]
                : undefined,
            },
            {
              title: 'Pencairan dalam periode',
              columns: ['Nomor', 'Kanal', 'Tanggal', 'Pesanan', 'Seharusnya', 'Diterima', 'Selisih'],
              align: [L, L, L, R, R, R, R],
              rows: settleRows,
              total: settleRows.length
                ? ['Jumlah', null, null, sum(settleRows, 3), sum(settleRows, 4), sum(settleRows, 5), sum(settleRows, 6)]
                : undefined,
            },
          ],
        },
        {
          key: 'fnb-usage',
          number: 'F5',
          title: 'Bahan terpakai vs resep',
          paragraphs: [
            'Seharusnya = jumlah menu terjual × kebutuhan bahan menurut resep yang berlaku saat pesanan dibuat (resep terbaru yang sudah ada saat itu). Keluar = pengeluaran stok bahan dari pesanan kasir (tanpa penjualan langsung bahan itu). Satuan dasar bahan. Menu yang diretur tidak mengembalikan bahan ke stok (sudah diolah), jadi retur tidak mengurangi pemakaian.',
          ],
          tables: [
            { columns: ['SKU', 'Bahan', 'Seharusnya', 'Keluar', 'Selisih'], align: [L, L, R, R, R], rows: usageRows },
          ],
        },
      ],
    };
  }
}
