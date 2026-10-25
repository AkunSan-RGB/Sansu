import { sql } from 'drizzle-orm';
import { addDays, diffDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { rp, reconCheck } from './health-context';
import type { Check, HealthContext } from './health-context';

export async function ledgerChecks(c: HealthContext) {
  const { deps, tenantId, asOf, bal, bySys, q, checks } = c;
  // 1. Neraca saldo seimbang
  const totD = [...bal.values()].reduce<Dec>((s, x) => s.plus(x.debit), ZERO);
  const totC = [...bal.values()].reduce<Dec>((s, x) => s.plus(x.credit), ZERO);
  checks.push({
    key: 'trial-balance',
    category: 'Integritas',
    title: 'Neraca saldo seimbang',
    status: totD.eq(totC) ? 'OK' : 'ERROR',
    message: totD.eq(totC)
      ? `Total debit = total kredit (${rp(totD)})`
      : `Selisih ${rp(totD.minus(totC))} — hubungi dukungan`,
    link: '/trial-balance',
  });

  // 2. Persamaan akuntansi
  const fp = await deps.statements.financialPosition(tenantId, asOf);
  checks.push({
    key: 'equation',
    category: 'Integritas',
    title: 'Aset = Liabilitas + Ekuitas',
    status: fp.balanced ? 'OK' : 'ERROR',
    message: fp.balanced ? `Aset ${rp(D(fp.totals.assets.amount))} seimbang` : 'Laporan posisi keuangan tidak seimbang',
    link: '/reports?tab=position',
  });

  // 3. Piutang: buku besar vs buku pembantu faktur
  const [arSub] = await q<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM invoices WHERE tenant_id = ${tenantId} AND date <= ${asOf}`);
  const arGl = bySys('AR');
  checks.push(
    reconCheck(
      'ar',
      'Piutang usaha: buku besar = rincian faktur',
      arGl,
      D(arSub.v),
      '/invoices',
      'Kemungkinan ada jurnal manual langsung ke akun piutang, atau pembayaran tanggal setelah laporan.',
    ),
  );

  // 3b. Uang muka pelanggan: buku besar = DPP uang muka yang belum dipakai
  const [dep] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(d.dpp - COALESCE((SELECT SUM(a.dpp) FROM deposit_applications a WHERE a.deposit_id = d.id AND a.date <= ${asOf}), 0)), 0) AS v,
             COUNT(*)::int AS n
      FROM customer_deposits d WHERE d.tenant_id = ${tenantId} AND d.date <= ${asOf}`);
  const depGl = bySys('CUSTOMER_DEPOSIT');
  if (dep.n || !depGl.isZero()) {
    checks.push(
      reconCheck(
        'customer-deposits',
        'Uang muka pelanggan: buku besar = rincian uang muka',
        depGl,
        D(dep.v),
        '/customer-deposits',
        'Ada jurnal manual ke akun Uang Muka Pelanggan. Catat DP lewat menu Uang muka pelanggan agar bisa dipakai melunasi faktur.',
      ),
    );
  }

  // 3b'. Proyek berjalan: kemajuan pekerjaan dicatat tiap akhir bulan (pengakuan pendapatan SAK EP Bab 23)
  if (asOf >= todayJakarta()) {
    const stale = await q<{ code: string; name: string; last: string | null }>(sql`
        SELECT p.code, p.name, (SELECT MAX(g.date)::text FROM project_progress g WHERE g.project_id = p.id) AS last
        FROM projects p
        WHERE p.tenant_id = ${tenantId} AND p.status = 'ACTIVE' AND p.contract_value > 0
          AND COALESCE(p.start_date, p.created_at::date) <= ${addDays(asOf, -30)}
          AND COALESCE((SELECT MAX(g.date) FROM project_progress g WHERE g.project_id = p.id), '1900-01-01') < ${addDays(asOf, -35)}`);
    if (stale.length) {
      checks.push({
        key: 'project-progress',
        category: 'Kelengkapan',
        title: 'Kemajuan proyek belum diperbarui',
        status: 'WARN',
        message: `${stale.length} proyek berjalan belum dicatat kemajuan pekerjaannya lebih dari sebulan. Catat % selesai di halaman proyek agar pendapatan yang sudah dikerjakan tetapi belum ditagih ikut terakui.`,
        detail: stale.map((p) => ({
          label: `${p.code} ${p.name}`,
          value: p.last ? `terakhir ${p.last}` : 'belum pernah',
        })),
        link: '/projects',
      });
    }
  }

  // 3c. Bukti potong PPh dari pelanggan (syarat kredit pajak PPh 23)
  const [slip] = await q<{ n: number; v: string }>(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(withholding_amount), 0) AS v FROM invoices
      WHERE tenant_id = ${tenantId} AND withholding_type = 'PPH23' AND withholding_amount > 0 AND withholding_slip_no IS NULL
        AND date <= ${addDays(asOf, -45)}`);
  if (slip.n) {
    checks.push({
      key: 'withholding-slips',
      category: 'Kepatuhan',
      title: 'Bukti potong PPh 23 dari pelanggan',
      status: 'WARN',
      message: `${slip.n} faktur jasa (PPh 23 Rp${D(slip.v).toFixed(0)}) belum dicatat nomor bukti potongnya lebih dari 45 hari. Tanpa bukti potong, PPh 23 tidak bisa dikreditkan di SPT Tahunan — minta ke pelanggan.`,
      link: '/tax/withheld',
    });
  }

  // 4. Utang usaha
  const [ap] = await q<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date <= ${asOf}`);
  checks.push(
    reconCheck(
      'ap',
      'Utang usaha: buku besar = rincian faktur supplier',
      bySys('AP'),
      D(ap.v),
      '/purchase-invoices',
      'Periksa jurnal manual ke akun utang usaha.',
    ),
  );

  // 4b. Mata uang asing: kurs terbaru dan penilaian ulang akhir bulan bagi piutang/utang valas yang masih terbuka
  if (asOf >= todayJakarta()) {
    const open = await q<{ currency: string; n: number }>(sql`
        SELECT currency, COUNT(*)::int AS n FROM (
          SELECT currency FROM invoices WHERE tenant_id = ${tenantId} AND currency <> 'IDR' AND status <> 'PAID'
          UNION ALL SELECT currency FROM purchase_invoices WHERE tenant_id = ${tenantId} AND currency <> 'IDR' AND status <> 'PAID') x GROUP BY currency`);
    if (open.length) {
      const [lastRate] = await q<{ d: string | null }>(
        sql`SELECT MAX(date)::text AS d FROM exchange_rates WHERE tenant_id = ${tenantId} AND currency IN (${sql.join(
          open.map((o) => sql`${o.currency}`),
          sql`, `,
        )})`,
      );
      const prevMonthStart = (() => {
        const [y, m] = asOf.split('-').map(Number);
        return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
      })();
      const [reval] = await q<{ d: string | null }>(
        sql`SELECT MAX(date)::text AS d FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'FX_REVAL'`,
      );
      const staleRate = !lastRate?.d || diffDays(lastRate.d, asOf) > 35;
      const noReval = !reval?.d || reval.d < prevMonthStart;
      checks.push({
        key: 'fx',
        category: 'Kepatuhan',
        title: 'Mata uang asing: kurs dan penilaian ulang',
        status: staleRate || noReval ? 'WARN' : 'OK',
        message:
          staleRate || noReval
            ? `Ada piutang/utang valas terbuka (${open.map((o) => `${o.currency} ${o.n} faktur`).join(', ')}). ${staleRate ? 'Kurs belum diperbarui dalam 35 hari terakhir. ' : ''}${noReval ? 'Penilaian ulang akhir bulan belum dicatat.' : ''}`.trim()
            : `Kurs ${lastRate.d} dan penilaian ulang terakhir ${reval.d} sudah mutakhir.`,
        link: '/fx',
      });
    }
  }

  // 5. Persediaan: buku besar vs kartu stok (hanya bila per hari ini)
  if (asOf >= todayJakarta()) {
    const stockValue = async (kind: 'GOODS' | 'SEMI') =>
      (
        await q<{ v: string }>(
          sql`SELECT COALESCE(SUM(b.qty * b.avg_cost), 0) AS v FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE b.tenant_id = ${tenantId} AND p.inventory_kind = ${kind}`,
        )
      )[0].v;
    checks.push(
      reconCheck(
        'inventory',
        'Persediaan: buku besar = nilai kartu stok',
        bySys('INVENTORY'),
        D(await stockValue('GOODS')),
        '/inventory',
        'Selisih kecil wajar karena pembulatan HPP; selisih besar berarti ada jurnal manual ke akun persediaan.',
        D(1000),
      ),
    );
    const semiStock = D(await stockValue('SEMI'));
    const semiGl = bySys('INVENTORY_SEMI');
    if (!semiStock.isZero() || !semiGl.isZero()) {
      checks.push(
        reconCheck(
          'inventory-semi',
          'Persediaan barang setengah jadi: buku besar = nilai kartu stok',
          semiGl,
          semiStock,
          '/inventory',
          'Barang setengah jadi hanya dibuat dan dipakai lewat perintah produksi; selisih besar berarti ada jurnal manual ke akun ini.',
          D(1000),
        ),
      );
    }
  }

  // 5a. Indikasi penurunan nilai persediaan (SAK EP 13): harga jual di bawah biaya rata-rata
  if (asOf >= todayJakarta()) {
    const [nrv] = await q<{ n: number; v: string }>(sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(b.qty * (b.avg_cost - p.sell_price)), 0) AS v
        FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND p.sell_price > 0 AND p.sell_price < b.avg_cost`);
    if (nrv.n) {
      checks.push({
        key: 'inventory-nrv',
        category: 'Kewajaran',
        title: 'Persediaan: harga jual di bawah harga pokok',
        status: 'WARN',
        message: `${nrv.n} barang dijual lebih murah dari biaya rata-ratanya (taksiran rugi ${D(nrv.v).toFixed(0)}). Bila harga itu memang wajar, turunkan nilainya di Inventori › Penurunan nilai.`,
        link: '/inventory/writedowns',
      });
    }
  }

  // 5a'. Barang dalam proses produksi: buku besar = bahan pada perintah produksi yang sedang berjalan
  const [wip] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(material_cost), 0) AS v, COUNT(*)::int AS n FROM production_orders
      WHERE tenant_id = ${tenantId} AND started_date <= ${asOf}
        AND (status = 'IN_PROGRESS' OR (status = 'COMPLETED' AND completed_date > ${asOf}) OR (status = 'CANCELLED' AND cancelled_date > ${asOf}))`);
  const wipGl = bySys('WIP');
  if (wip.n || !wipGl.isZero()) {
    checks.push(
      reconCheck(
        'wip',
        'Barang dalam proses: buku besar = produksi berjalan',
        wipGl,
        D(wip.v),
        '/production/orders',
        'Ada jurnal manual ke akun Barang dalam Proses Produksi. Catat produksi lewat menu Produksi.',
      ),
    );
  }

  // 5b. Barang dalam perjalanan antar gudang
  const [tr] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(total_value), 0) AS v, COUNT(*)::int AS n FROM stock_transfers WHERE tenant_id = ${tenantId} AND date <= ${asOf} AND (received_date IS NULL OR received_date > ${asOf})`);
  const trGl = bySys('INVENTORY_TRANSIT');
  if (tr.n || !trGl.isZero()) {
    checks.push(
      reconCheck(
        'transit',
        'Barang dalam perjalanan: buku besar = kiriman belum diterima',
        trGl,
        D(tr.v),
        '/inventory/transfers',
        'Ada jurnal manual ke akun Persediaan dalam Perjalanan, atau kiriman diterima setelah tanggal laporan.',
      ),
    );
  }

  // 5c. Opname kas rutin (kas fisik, bukan rekening bank)
  if (asOf >= todayJakarta()) {
    const kas = await q<{ name: string; last: string | null; active: boolean }>(sql`
        SELECT a.name, (SELECT MAX(c.date)::text FROM cash_counts c WHERE c.account_id = a.id AND c.status = 'POSTED') AS last,
               EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
                       WHERE l.account_id = a.id AND j.date > ${addDays(asOf, -90)}) AS active
        FROM accounts a
        WHERE a.tenant_id = ${tenantId} AND a.is_cash_account AND a.is_postable AND a.is_active AND COALESCE(a.system_key, '') <> 'BANK'
          AND a.name !~* '(bank|rekening|giro|tabungan|deposito|qris|wallet|virtual)'
          AND NOT EXISTS (SELECT 1 FROM bank_statements b WHERE b.cash_account_id = a.id)`);
    const due = kas.filter((k) => k.active && (!k.last || diffDays(k.last, asOf) > 35));
    if (kas.some((k) => k.active)) {
      checks.push({
        key: 'cash-count',
        category: 'Kelengkapan',
        title: 'Opname kas bulanan',
        status: due.length ? 'WARN' : 'OK',
        message: due.length
          ? `${due.map((k) => k.name).join(', ')} belum diopname lebih dari sebulan. Hitung fisik uang di Kas & Bank › Opname kas.`
          : 'Semua kas sudah diopname dalam sebulan terakhir',
        detail: kas
          .filter((k) => k.active)
          .map((k) => ({ label: k.name, value: k.last ? `opname terakhir ${k.last}` : 'belum pernah' })),
        link: '/cash/counts',
      });
    }
  }
  return { fp, dep };
}

export type Out0 = Awaited<ReturnType<typeof ledgerChecks>>;
