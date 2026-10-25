import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { exchangeRates } from '../../db/schema';
import { and, eq, lte, desc, sql } from 'drizzle-orm';
import { UpsertRateDto } from './fx.dto';
import { Dec } from '../../common/utils/money';

/** Satu baris piutang/utang valas terbuka hasil kueri (angka dalam teks dari database) */
export type OpenItemRow = {
  id: string;
  number: string;
  party: string;
  currency: string;
  date: string;
  out_f: string;
  carrying: string;
};

/** Akses data untuk Fx: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class FxRepository {
  /** Dipakai oleh FxService.rateOn */
  findExchangeRatesByCurrencyAndDate(db: DbOrTx, tenantId: string, currency: string, date: string) {
    return db
      .select({ rate: exchangeRates.rate })
      .from(exchangeRates)
      .where(
        and(eq(exchangeRates.tenantId, tenantId), eq(exchangeRates.currency, currency), lte(exchangeRates.date, date)),
      )
      .orderBy(desc(exchangeRates.date))
      .limit(1);
  }

  /** Dipakai oleh FxService.upsert */
  insertExchangeRates(db: DbOrTx, tenantId: string, dto: UpsertRateDto, date: string, rate: Dec) {
    return db
      .insert(exchangeRates)
      .values({ tenantId: tenantId, currency: dto.currency, date: date, rate: rate.toFixed(6), note: dto.note })
      .onConflictDoUpdate({
        target: [exchangeRates.tenantId, exchangeRates.currency, exchangeRates.date],
        set: { rate: rate.toFixed(6), note: dto.note ?? null },
      })
      .returning();
  }

  /** Dipakai oleh FxService.remove */
  deleteExchangeRatesById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .delete(exchangeRates)
      .where(and(eq(exchangeRates.id, id), eq(exchangeRates.tenantId, tenantId)))
      .returning();
  }

  /** Dipakai oleh FxService.revalue */
  queryJournalEntry(db: DbOrTx, tenantId: string, date: string) {
    return db.execute<{ number: string }>(sql`
        SELECT e.number FROM journal_entries e WHERE e.tenant_id = ${tenantId} AND e.source_type = 'FX_REVAL' AND e.date = ${date} LIMIT 1`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh FxService.openItems */
  queryInvoice(db: DbOrTx, asOf: string, tenantId: string) {
    return db.execute<OpenItemRow>(sql`
      SELECT i.id, i.number, c.name AS party, i.currency, i.date::text AS date,
             i.total_foreign - i.returned_foreign - COALESCE(p.f, 0) AS out_f, i.total - i.returned_amount - COALESCE(p.idr, 0) AS carrying
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      LEFT JOIN LATERAL (SELECT SUM(amount_foreign) AS f, SUM(amount) AS idr FROM payments y WHERE y.invoice_id = i.id AND y.date <= ${asOf}) p ON true
      WHERE i.tenant_id = ${tenantId} AND i.currency <> 'IDR' AND i.date <= ${asOf}`);
  }

  /** Dipakai oleh FxService.openItems */
  queryPurchaseInvoice(db: DbOrTx, asOf: string, tenantId: string) {
    return db.execute<OpenItemRow>(sql`
      SELECT i.id, i.number, s.name AS party, i.currency, i.date::text AS date,
             i.total_foreign - i.returned_foreign - COALESCE(p.f, 0) AS out_f, i.total - i.returned_amount - COALESCE(p.idr, 0) AS carrying
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN LATERAL (SELECT SUM(amount_foreign) AS f, SUM(amount) AS idr FROM supplier_payments y WHERE y.purchase_invoice_id = i.id AND y.status = 'POSTED' AND y.date <= ${asOf}) p ON true
      WHERE i.tenant_id = ${tenantId} AND i.currency <> 'IDR' AND i.date <= ${asOf}`);
  }
}
