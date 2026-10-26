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
}

export const AR_SPEC: PartySpec = {
  invoice: 'invoices',
  invoiceParty: 'customer_id',
  payment: 'payments',
  paymentParty: 'customer_id',
  returns: 'sales_returns',
  returnParty: 'customer_id',
  party: 'customers',
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

  /** Rincian satu akun menurut sumber jurnal (faktur, kas, penyusutan, penilaian ulang, dst.) dalam rentang tanggal */
  sourceBreakdown(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string) {
    return db.execute<{ source_type: string; n: number; debit: string; credit: string }>(sql`
      SELECT j.source_type, COUNT(*)::int AS n, COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'
      GROUP BY j.source_type ORDER BY SUM(ABS(l.debit - l.credit)) DESC`);
  }

  /** Transaksi terbesar pada satu akun (menurut nilai mutlak) */
  topLines(db: DbOrTx, tenantId: string, accountId: string, from: string, to: string, limit = 10) {
    return db.execute<{ number: string; date: string; description: string; source_type: string; debit: string; credit: string }>(sql`
      SELECT j.number, j.date::text AS date, COALESCE(NULLIF(l.memo, ''), j.description) AS description, j.source_type,
             l.debit::text AS debit, l.credit::text AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'
      ORDER BY ABS(l.debit - l.credit) DESC, j.date LIMIT ${limit}`);
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
}
