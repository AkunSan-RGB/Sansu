import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { exchangeRates } from '../../db/schema';
import { and, eq, lte, desc, sql } from 'drizzle-orm';
import { UpsertRateDto } from './fx.dto';
import { Dec } from '../../common/utils/money';

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
}
