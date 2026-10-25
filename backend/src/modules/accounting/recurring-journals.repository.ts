import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { recurringJournals, scheduledReversals } from '../../db/schema';
import { toDocDate } from '../../common/utils/dates';
import { and, eq, lte, asc } from 'drizzle-orm';
import { UpdateRecurringDto } from './dto/accounting.dto';

/** Akses data untuk RecurringJournals: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class RecurringJournalsRepository {
  /** Dipakai oleh RecurringJournalsService.updateRecurring */
  updateRecurringJournalsById(db: DbOrTx, dto: UpdateRecurringDto, id: string, tenantId: string) {
    return db
      .update(recurringJournals)
      .set({ ...dto, nextDate: dto.nextDate ? toDocDate(dto.nextDate) : undefined })
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, tenantId)))
      .returning();
  }

  /** Dipakai oleh RecurringJournalsService.deleteRecurring */
  deleteRecurringJournalsById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .delete(recurringJournals)
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, tenantId)))
      .returning({ id: recurringJournals.id });
  }

  /** Dipakai oleh RecurringJournalsService.runDue */
  listRecurringJournalsByIsActiveAndNextDate(db: DbOrTx, tenantId: string, today: string) {
    return db
      .select({ id: recurringJournals.id })
      .from(recurringJournals)
      .where(
        and(
          eq(recurringJournals.tenantId, tenantId),
          eq(recurringJournals.isActive, true),
          lte(recurringJournals.nextDate, today),
        ),
      );
  }

  /** Dipakai oleh RecurringJournalsService.runScheduledReversals */
  listScheduledReversalsByStatusAndReverseOn(db: DbOrTx, tenantId: string, today: string) {
    return db
      .select({ id: scheduledReversals.id })
      .from(scheduledReversals)
      .where(
        and(
          eq(scheduledReversals.tenantId, tenantId),
          eq(scheduledReversals.status, 'PENDING'),
          lte(scheduledReversals.reverseOn, today),
        ),
      );
  }

  /** Dipakai oleh RecurringJournalsService.cancelScheduledReversal */
  updateScheduledReversalsByJournalIdAndStatusAndId(db: DbOrTx, journalId: string, tenantId: string) {
    return db
      .update(scheduledReversals)
      .set({ status: 'CANCELLED', processedAt: new Date() })
      .where(
        and(
          eq(scheduledReversals.journalId, journalId),
          eq(scheduledReversals.tenantId, tenantId),
          eq(scheduledReversals.status, 'PENDING'),
        ),
      )
      .returning({ id: scheduledReversals.id });
  }

  /** Dipakai oleh RecurringJournalsService.runAllDue */
  listRecurringJournalsByIsActive(db: DbOrTx) {
    return db
      .selectDistinct({ id: recurringJournals.tenantId })
      .from(recurringJournals)
      .where(eq(recurringJournals.isActive, true));
  }

  /** Dipakai oleh RecurringJournalsService.runAllDue */
  listScheduledReversalsByStatus(db: DbOrTx) {
    return db
      .selectDistinct({ id: scheduledReversals.tenantId })
      .from(scheduledReversals)
      .where(eq(scheduledReversals.status, 'PENDING'));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh RecurringJournalsService.listRecurring */
  listRecurringJournalsByNextDate(
    db: DbOrTx,
    tenantId: NonNullable<(typeof recurringJournals.$inferSelect)['tenantId']>,
  ) {
    return db
      .select()
      .from(recurringJournals)
      .where(eq(recurringJournals.tenantId, tenantId))
      .orderBy(asc(recurringJournals.nextDate));
  }
}
