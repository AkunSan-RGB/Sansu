import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { assetCategories, fixedAssets, recurringJournals } from '../../db/schema';

/** Pihak lawan usaha: tabel dokumen dan tabel pendukungnya (faktur, pembayaran, retur) untuk jadwal piutang dan utang */
export interface PartySpec {
  invoice: string;
  invoiceParty: string;
  payment: string;
  paymentParty: string;
  paymentFilter?: string;
  returns: string;
  returnParty: string;
  party: string;
  /** Kolom faktur pada tabel pembayaran dan retur (untuk sisa tagihan per faktur) */
  paymentInvoice: string;
  returnInvoice: string;
}

export const AR_SPEC: PartySpec = {
  invoice: 'invoices',
  invoiceParty: 'customer_id',
  payment: 'payments',
  paymentParty: 'customer_id',
  returns: 'sales_returns',
  returnParty: 'customer_id',
  party: 'customers',
  paymentInvoice: 'invoice_id',
  returnInvoice: 'invoice_id',
};

export const AP_SPEC: PartySpec = {
  invoice: 'purchase_invoices',
  invoiceParty: 'supplier_id',
  payment: 'supplier_payments',
  paymentParty: 'supplier_id',
  paymentFilter: `status = 'POSTED'`,
  returns: 'purchase_returns',
  returnParty: 'supplier_id',
  party: 'suppliers',
  paymentInvoice: 'purchase_invoice_id',
  returnInvoice: 'purchase_invoice_id',
};

/** Akses data untuk jadwal akun: mutasi buku besar per bulan dan sumber rincian (aset, pihak lawan, persediaan). */
@Injectable()
export class AccountSchedulesRepository {
  /**
   * Debit/kredit per akun per bulan. Bulan 0 = saldo awal (semua jurnal sebelum 1 Januari).
   * Akun nominal (pendapatan/beban) tidak punya saldo awal dan tidak menghitung jurnal penutup, sama seperti laporan laba rugi.
   */
  movementsByAccountMonth(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ account_id: string; m: number; d: string; c: string }>(sql`
      SELECT l.account_id,
             CASE WHEN j.date < ${from} THEN 0 ELSE EXTRACT(MONTH FROM j.date)::int END AS m,
             SUM(l.debit)::text AS d, SUM(l.credit)::text AS c
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${to}
        AND NOT (a.type IN ('REVENUE', 'EXPENSE') AND (j.source_type = 'CLOSING' OR j.date < ${from}))
      GROUP BY 1, 2`);
  }

  /** Laba (rugi) yang belum ditutup ke saldo laba sampai tanggal itu: Σ(kredit − debit) akun pendapatan dan beban, termasuk jurnal penutup */
  unclosedEarningsAt(db: DbOrTx, tenantId: string, date: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${date} AND a.type IN ('REVENUE', 'EXPENSE')`);
  }

  /** Akun kas yang sudah pernah mengimpor rekening koran */
  bankStatementAccountIds(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(sql`SELECT DISTINCT cash_account_id AS id FROM bank_statements WHERE tenant_id = ${tenantId}`);
  }

  /** Baris jurnal satu akun dalam rentang tanggal (dasar rincian per jurnal untuk akun tanpa daftar sendiri) */
  journalLinesOfAccount(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{ journal_id: string; number: string; date: string; description: string; source_type: string; debit: string; credit: string }>(sql`
      SELECT j.id AS journal_id, j.number, j.date::text AS date, COALESCE(NULLIF(l.memo, ''), j.description) AS description, j.source_type,
             l.debit::text AS debit, l.credit::text AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to}
      ORDER BY j.date, j.number LIMIT 2000`);
  }

  /** Jurnal berulang aktif (amortisasi/akrual terjadwal) */
  activeRecurringJournals(db: DbOrTx, tenantId: string) {
    return db.select().from(recurringJournals).where(and(eq(recurringJournals.tenantId, tenantId), eq(recurringJournals.isActive, true)));
  }

  /** Jurnal balik terjadwal yang masih menunggu dan menyentuh akun ini */
  pendingReversalsOnAccount(db: DbOrTx, tenantId: string, accountId: string) {
    return db.execute<{ reverse_on: string; number: string; date: string; description: string; debit: string; credit: string }>(sql`
      SELECT sr.reverse_on::text AS reverse_on, j.number, j.date::text AS date, j.description,
             COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
      FROM scheduled_reversals sr
      JOIN journal_entries j ON j.id = sr.journal_id
      JOIN journal_lines l ON l.journal_id = j.id AND l.account_id = ${accountId}
      WHERE sr.tenant_id = ${tenantId} AND sr.status = 'PENDING'
      GROUP BY sr.reverse_on, j.number, j.date, j.description ORDER BY sr.reverse_on`);
  }

  listAssetsWithCategory(db: DbOrTx, tenantId: string) {
    return db
      .select({ asset: fixedAssets, category: assetCategories })
      .from(fixedAssets)
      .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
      .where(eq(fixedAssets.tenantId, tenantId))
      .orderBy(fixedAssets.code);
  }

  listAssetCategories(db: DbOrTx, tenantId: string) {
    return db.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId));
  }

  /** Penyusutan yang sudah dibukukan per aset per periode (YYYY-MM) sampai akhir tahun laporan */
  depreciationUpTo(db: DbOrTx, tenantId: string, lastPeriod: string) {
    return db.execute<{ asset_id: string; period: string; amount: string }>(sql`
      SELECT asset_id, period, amount::text AS amount FROM asset_depreciations
      WHERE tenant_id = ${tenantId} AND period <= ${lastPeriod}`);
  }

  /**
   * Mutasi dokumen per pihak lawan: saldo awal (sebelum `from`), penambahan (faktur), pengurangan (pembayaran, retur), dan saldo akhir.
   * Dasar perhitungan: total faktur − pembayaran − retur menurut tanggal dokumen.
   */
  partyMovements(db: DbOrTx, tenantId: string, spec: PartySpec, from: string, to: string) {
    const t = (name: string) => sql.identifier(name);
    const payFilter = spec.paymentFilter ? sql.raw(` AND ${spec.paymentFilter}`) : sql.raw('');
    return db.execute<{ code: string; name: string; opening: string; added: string; paid: string; returned: string }>(sql`
      WITH mv AS (
        SELECT ${t(spec.invoiceParty)} AS pid, date, total AS amt, 'ADD' AS k FROM ${t(spec.invoice)} WHERE tenant_id = ${tenantId} AND date <= ${to}
        UNION ALL
        SELECT ${t(spec.paymentParty)}, date, amount, 'PAY' FROM ${t(spec.payment)} WHERE tenant_id = ${tenantId} AND date <= ${to}${payFilter}
        UNION ALL
        SELECT ${t(spec.returnParty)}, date, total, 'RET' FROM ${t(spec.returns)} WHERE tenant_id = ${tenantId} AND date <= ${to}
      )
      SELECT p.code, p.name,
        COALESCE(SUM(CASE WHEN mv.k = 'ADD' THEN mv.amt ELSE -mv.amt END) FILTER (WHERE mv.date < ${from}), 0)::text AS opening,
        COALESCE(SUM(mv.amt) FILTER (WHERE mv.k = 'ADD' AND mv.date >= ${from}), 0)::text AS added,
        COALESCE(SUM(mv.amt) FILTER (WHERE mv.k = 'PAY' AND mv.date >= ${from}), 0)::text AS paid,
        COALESCE(SUM(mv.amt) FILTER (WHERE mv.k = 'RET' AND mv.date >= ${from}), 0)::text AS returned
      FROM mv JOIN ${t(spec.party)} p ON p.id = mv.pid
      GROUP BY p.id, p.code, p.name
      ORDER BY p.name`);
  }

  /** Kartu persediaan per produk: jumlah dan nilai (jumlah × biaya per mutasi) */
  stockMovementsByProduct(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{
      sku: string;
      name: string;
      uom: string;
      q0: string;
      v0: string;
      qin: string;
      vin: string;
      qout: string;
      vout: string;
      q1: string;
      v1: string;
    }>(sql`
      SELECT p.sku, p.name, p.base_uom AS uom,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date < ${from}), 0)::text AS q0,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date < ${from}), 0)::text AS v0,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty > 0), 0)::text AS qin,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty > 0), 0)::text AS vin,
        COALESCE(-SUM(m.qty) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty < 0), 0)::text AS qout,
        COALESCE(-SUM(m.qty * m.unit_cost) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty < 0), 0)::text AS vout,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date <= ${to}), 0)::text AS q1,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date <= ${to}), 0)::text AS v1
      FROM products p JOIN stock_moves m ON m.product_id = p.id AND m.tenant_id = ${tenantId}
      WHERE p.tenant_id = ${tenantId} GROUP BY p.id, p.sku, p.name, p.base_uom
      HAVING COALESCE(SUM(m.qty) FILTER (WHERE m.date <= ${to}), 0) <> 0
          OR COALESCE(SUM(ABS(m.qty)) FILTER (WHERE m.date BETWEEN ${from} AND ${to}), 0) <> 0
      ORDER BY p.sku`);
  }

  /** Pencairan platform pesan-antar per kanal: yang seharusnya cair, yang diterima, dan selisihnya */
  platformSettlements(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ channel: string; n: number; orders: number; expected: string; received: string; difference: string }>(sql`
      SELECT channel, COUNT(*)::int AS n, COALESCE(SUM(order_count), 0)::int AS orders, COALESCE(SUM(expected), 0)::text AS expected,
             COALESCE(SUM(received), 0)::text AS received, COALESCE(SUM(difference), 0)::text AS difference
      FROM pos_platform_settlements WHERE tenant_id = ${tenantId} AND status <> 'CANCELLED' AND date BETWEEN ${from} AND ${to}
      GROUP BY channel ORDER BY channel`);
  }

  /** Pencairan QRIS/kartu per metode: bruto, MDR, diterima, selisih */
  cardSettlements(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ method: string; n: number; gross: string; mdr: string; received: string; difference: string }>(sql`
      SELECT method, COUNT(*)::int AS n, COALESCE(SUM(gross), 0)::text AS gross, COALESCE(SUM(mdr_expected), 0)::text AS mdr,
             COALESCE(SUM(received), 0)::text AS received, COALESCE(SUM(difference), 0)::text AS difference
      FROM pos_card_settlements WHERE tenant_id = ${tenantId} AND status <> 'CANCELLED' AND date BETWEEN ${from} AND ${to}
      GROUP BY method ORDER BY method`);
  }

  /** Klaim promo ke prinsipal yang belum dibayar */
  openPrincipalClaims(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ number: string; supplier: string; period: string; claimed: string; approved: string | null; status: string; created: string }>(sql`
      SELECT c.number, s.name AS supplier, c.period, c.claimed_amount::text AS claimed, c.approved_amount::text AS approved, c.status, c.created_at::date::text AS created
      FROM principal_claims c JOIN suppliers s ON s.id = c.supplier_id
      WHERE c.tenant_id = ${tenantId} AND c.status IN ('SUBMITTED', 'APPROVED') AND c.created_at::date <= ${to}::date ORDER BY c.created_at`);
  }

  /** Saldo satu akun per cabang (baris tanpa cabang = pusat) sampai tanggal itu */
  branchBalances(db: DbOrTx, tenantId: string, accountId: string, to: string) {
    return db.execute<{ branch: string; debit: string; credit: string }>(sql`
      SELECT COALESCE(b.code || ' · ' || b.name, 'Pusat / tanpa cabang') AS branch, COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id LEFT JOIN branches b ON b.id = l.branch_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date <= ${to}
      GROUP BY b.id, b.code, b.name ORDER BY 1`);
  }

  /** Transfer antar gudang yang masih dalam perjalanan */
  transfersInTransit(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ number: string; date: string; from_wh: string; to_wh: string; value: string }>(sql`
      SELECT t.number, t.date::text AS date, f.name AS from_wh, d.name AS to_wh, t.total_value::text AS value
      FROM stock_transfers t JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses d ON d.id = t.to_warehouse_id
      WHERE t.tenant_id = ${tenantId} AND t.status = 'IN_TRANSIT' AND t.date <= ${to} ORDER BY t.date`);
  }

  /** Perintah produksi yang sedang berjalan (barang dalam proses) */
  productionInProgress(db: DbOrTx, tenantId: string) {
    return db.execute<{ number: string; product: string; started: string | null; planned: string; material: string; labor: string; overhead: string }>(sql`
      SELECT o.number, p.name AS product, o.started_date::text AS started, o.planned_qty::text AS planned,
             o.material_cost::text AS material, o.labor_cost::text AS labor, o.overhead_cost::text AS overhead
      FROM production_orders o JOIN products p ON p.id = o.product_id
      WHERE o.tenant_id = ${tenantId} AND o.status = 'IN_PROGRESS' ORDER BY o.started_date`);
  }

  /** Aset kontrak per proyek: nilai kontrak, pendapatan diakui, ditagih, dan akrual setelah kemajuan terakhir sampai tanggal itu */
  projectContractAssets(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ code: string; name: string; contract: string; percent: string; earned: string; billed: string; accrual: string }>(sql`
      SELECT p.code, p.name, p.contract_value::text AS contract, x.percent::text AS percent, x.earned::text AS earned, x.billed::text AS billed, x.accrual_after::text AS accrual
      FROM projects p
      JOIN LATERAL (SELECT percent, earned, billed, accrual_after FROM project_progress g WHERE g.project_id = p.id AND g.date <= ${to} ORDER BY g.date DESC, g.created_at DESC LIMIT 1) x ON true
      WHERE p.tenant_id = ${tenantId} ORDER BY p.code`);
  }

  /** Poin loyalitas: gerakan tahun berjalan per jenis dan saldo beredar sampai tanggal itu */
  loyaltyByKind(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ kind: string; points: string; value: string }>(sql`
      SELECT kind, COALESCE(SUM(points), 0)::text AS points, COALESCE(SUM(value), 0)::text AS value
      FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND created_at::date BETWEEN ${from}::date AND ${to}::date GROUP BY kind ORDER BY kind`);
  }

  loyaltyOutstanding(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ points: string; value: string; expiring: string }>(sql`
      SELECT COALESCE(SUM(remaining), 0)::text AS points,
             COALESCE(SUM(remaining * value / NULLIF(points, 0)) FILTER (WHERE points > 0), 0)::text AS value,
             COALESCE(SUM(remaining) FILTER (WHERE expires_on IS NOT NULL AND expires_on <= (${to}::date + 90)), 0)::text AS expiring
      FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND kind = 'EARN' AND created_at::date <= ${to}::date`);
  }

  /** Setoran pajak tahun berjalan per jenis pajak */
  taxPaymentsByType(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ type: string; n: number; amount: string }>(sql`
      SELECT type, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS amount
      FROM tax_payments WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY type ORDER BY type`);
  }

  /**
   * Setiap baris jurnal akun ini beserta dokumen sumbernya (nomor dokumen, pihak lawan, keterangan dokumen): faktur, pembayaran, retur,
   * surat jalan, penerimaan barang, kas, kasir, gaji, aset, uang muka, setoran pajak, kemajuan proyek, dan seterusnya.
   * Jurnal tanpa dokumen (manual, penyesuaian, saldo awal) tampil dengan nomor jurnalnya.
   */
  documentLines(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{
      journal_id: string; jn: string; date: string; st: string; doc_no: string | null; party: string | null; note: string | null; debit: string; credit: string;
    }>(sql`
      WITH base AS (
        SELECT j.id AS journal_id, j.number AS jn, j.date::text AS date, j.source_type AS st,
               COALESCE(NULLIF(l.memo, ''), j.description) AS jdesc,
               CASE WHEN j.source_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN j.source_id::uuid END AS sid,
               l.debit, l.credit
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'
      )
      SELECT b.journal_id, b.jn, b.date, b.st,
        COALESCE(inv.number, pay.number, srt.number, dlv.number, gr.number, pin.number, spy.number, prt.number, ctx.number, pos.number, prn.number,
                 run.number, dep.number, tpy.number, ppr.number, fa.code, b.jn) AS doc_no,
        COALESCE(c_inv.name, c_pay.name, c_srt.name, c_dlv.name, c_dep.name, c_pos.name, s_gr.name, s_pin.name, s_spy.name, s_prt.name, prj.name, fa.name) AS party,
        COALESCE(inv.description, pay.notes, ctx.description, run.period, tpy.type || ' ' || tpy.period, dep.description, fa.name, b.jdesc) AS note,
        b.debit::text AS debit, b.credit::text AS credit
      FROM base b
      LEFT JOIN invoices inv ON b.st = 'INVOICE' AND inv.id = b.sid
      LEFT JOIN customers c_inv ON c_inv.id = inv.customer_id
      LEFT JOIN payments pay ON b.st = 'PAYMENT' AND pay.id = b.sid
      LEFT JOIN customers c_pay ON c_pay.id = pay.customer_id
      LEFT JOIN sales_returns srt ON b.st = 'SALES_RETURN' AND srt.id = b.sid
      LEFT JOIN customers c_srt ON c_srt.id = srt.customer_id
      LEFT JOIN delivery_orders dlv ON b.st = 'DELIVERY' AND dlv.id = b.sid
      LEFT JOIN customers c_dlv ON c_dlv.id = dlv.customer_id
      LEFT JOIN goods_receipts gr ON b.st = 'GOODS_RECEIPT' AND gr.id = b.sid
      LEFT JOIN suppliers s_gr ON s_gr.id = gr.supplier_id
      LEFT JOIN purchase_invoices pin ON b.st = 'PURCHASE_INVOICE' AND pin.id = b.sid
      LEFT JOIN suppliers s_pin ON s_pin.id = pin.supplier_id
      LEFT JOIN supplier_payments spy ON b.st = 'SUPPLIER_PAYMENT' AND spy.id = b.sid
      LEFT JOIN suppliers s_spy ON s_spy.id = spy.supplier_id
      LEFT JOIN purchase_returns prt ON b.st = 'PURCHASE_RETURN' AND prt.id = b.sid
      LEFT JOIN suppliers s_prt ON s_prt.id = prt.supplier_id
      LEFT JOIN cash_transactions ctx ON b.st IN ('CASH_IN', 'CASH_OUT', 'TRANSFER') AND ctx.id = b.sid
      LEFT JOIN pos_orders pos ON b.st = 'POS' AND pos.id = b.sid
      LEFT JOIN customers c_pos ON c_pos.id = pos.customer_id
      LEFT JOIN pos_returns prn ON b.st = 'POS_RETURN' AND prn.id = b.sid
      LEFT JOIN payroll_runs run ON b.st IN ('PAYROLL', 'PAYROLL_PAYMENT') AND run.id = b.sid
      LEFT JOIN customer_deposits dep ON b.st IN ('CUSTOMER_DEPOSIT', 'DEPOSIT_APPLICATION') AND dep.id = b.sid
      LEFT JOIN customers c_dep ON c_dep.id = dep.customer_id
      LEFT JOIN tax_payments tpy ON b.st = 'TAX_PAYMENT' AND tpy.id = b.sid
      LEFT JOIN project_progress ppr ON b.st = 'PROJECT_PROGRESS' AND ppr.id = b.sid
      LEFT JOIN projects prj ON prj.id = ppr.project_id
      LEFT JOIN fixed_assets fa ON b.st IN ('ASSET_ACQUISITION', 'ASSET_DISPOSAL') AND fa.id = b.sid
      ORDER BY b.date, b.jn`);
  }

  /** Penjualan per produk dari baris faktur dan kasir yang menyentuh akun ini (kuantitas dan nilai sebelum PPN) */
  salesByProduct(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{ sku: string; name: string; qty: string; amount: string }>(sql`
      WITH src AS (
        SELECT j.source_type AS st, j.source_id AS sid FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type IN ('INVOICE', 'POS') GROUP BY 1, 2
      ), lines AS (
        SELECT il.product_id, il.qty * il.uom_factor AS qty, il.line_total AS amount FROM invoice_lines il JOIN src ON src.st = 'INVOICE' AND src.sid = il.invoice_id::text
        UNION ALL
        SELECT pl.product_id, pl.qty * pl.uom_factor, pl.line_total FROM pos_order_lines pl JOIN src ON src.st = 'POS' AND src.sid = pl.order_id::text
      )
      SELECT p.sku, p.name, SUM(lines.qty)::text AS qty, SUM(lines.amount)::text AS amount
      FROM lines JOIN products p ON p.id = lines.product_id GROUP BY p.id, p.sku, p.name ORDER BY SUM(lines.amount) DESC LIMIT 300`);
  }

  /** Harga pokok per produk dari mutasi stok keluar dokumen yang menyentuh akun ini */
  cogsByProduct(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{ sku: string; name: string; qty: string; amount: string }>(sql`
      WITH src AS (
        SELECT j.source_id AS sid FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_id IS NOT NULL GROUP BY 1
      )
      SELECT p.sku, p.name, SUM(-m.qty)::text AS qty, SUM(-m.qty * m.unit_cost)::text AS amount
      FROM stock_moves m JOIN src ON src.sid = m.ref_id::text JOIN products p ON p.id = m.product_id
      WHERE m.tenant_id = ${tenantId} AND m.qty < 0 GROUP BY p.id, p.sku, p.name ORDER BY SUM(-m.qty * m.unit_cost) DESC LIMIT 300`);
  }

  /** Slip gaji per karyawan dari penggajian yang menyentuh akun ini */
  payrollByEmployee(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{ code: string; name: string; slips: number; gross: string; net: string }>(sql`
      WITH runs AS (
        SELECT j.source_id AS sid FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type = 'PAYROLL' GROUP BY 1
      )
      SELECT e.code, e.name, COUNT(*)::int AS slips, SUM(s.gross_pay)::text AS gross, SUM(s.net_pay)::text AS net
      FROM payslips s JOIN runs ON runs.sid = s.run_id::text JOIN employees e ON e.id = s.employee_id
      GROUP BY e.id, e.code, e.name ORDER BY e.name`);
  }

  /** Faktur yang masih terbuka per tanggal (sisa = total − pembayaran − retur sampai tanggal itu), untuk umur piutang/utang per faktur */
  openDocuments(db: DbOrTx, tenantId: string, spec: PartySpec, to: string) {
    const t = (name: string) => sql.identifier(name);
    const payFilter = spec.paymentFilter ? sql.raw(` AND x.${spec.paymentFilter}`) : sql.raw('');
    return db.execute<{ number: string; party_code: string; party: string; date: string; due_date: string; total: string; outstanding: string }>(sql`
      SELECT i.number, p.code AS party_code, p.name AS party, i.date::text AS date, i.due_date::text AS due_date, i.total::text AS total,
        (i.total - COALESCE((SELECT SUM(x.amount) FROM ${t(spec.payment)} x WHERE x.${t(spec.paymentInvoice)} = i.id AND x.date <= ${to}${payFilter}), 0)
                 - COALESCE((SELECT SUM(r.total) FROM ${t(spec.returns)} r WHERE r.${t(spec.returnInvoice)} = i.id AND r.date <= ${to}), 0))::text AS outstanding
      FROM ${t(spec.invoice)} i JOIN ${t(spec.party)} p ON p.id = i.${t(spec.invoiceParty)}
      WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}
      ORDER BY i.due_date, i.number`);
  }

  /** Persediaan per gudang (jumlah dan nilai) sampai tanggal itu */
  stockByWarehouse(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ code: string; name: string; qty: string; value: string; products: number }>(sql`
      SELECT w.code, w.name, COALESCE(SUM(m.qty), 0)::text AS qty, COALESCE(SUM(m.qty * m.unit_cost), 0)::text AS value, COUNT(DISTINCT m.product_id)::int AS products
      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.date <= ${to} GROUP BY w.id, w.code, w.name
      HAVING COALESCE(SUM(m.qty), 0) <> 0 ORDER BY w.code`);
  }
}
