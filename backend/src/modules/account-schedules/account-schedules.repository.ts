import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { assetCategories, fixedAssets } from '../../db/schema';

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
}
