import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { PeriodService } from '../../common/period/period.service';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { journalEntries, recurringJournals, scheduledReversals } from '../../db/schema';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/accounting.dto';
import { PostingService } from './posting.service';
import { AccountingRepository } from './accounting.repository';
import { AccountingService, nextOccurrence } from './accounting.service';

@Injectable()
export class RecurringJournalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('JurnalBerulang');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly period: PeriodService,
    private readonly audit: AuditService,
    private readonly repo: AccountingRepository,
    private readonly accounting: AccountingService,
  ) {}

  /** Jurnal berulang dijalankan otomatis setiap jam untuk semua perusahaan */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runAllDue().catch((e) => this.logger.error(e)), 60 * 60 * 1000);
    this.timer.unref();
    setTimeout(() => void this.runAllDue().catch((e) => this.logger.error(e)), 15_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Jurnal berulang ----------

  listRecurring(tenantId: string) {
    return this.db
      .select()
      .from(recurringJournals)
      .where(eq(recurringJournals.tenantId, tenantId))
      .orderBy(asc(recurringJournals.nextDate));
  }

  async createRecurring(user: AuthUser, dto: CreateRecurringDto) {
    await this.accounting.validateLines(user.tenantId, dto.lines);
    await this.accounting.assertNoControlAccounts(
      user,
      dto.lines.map((l) => l.accountId),
      undefined,
      'Jurnal berulang',
    );
    const [r] = await this.db
      .insert(recurringJournals)
      .values({
        ...dto,
        tenantId: user.tenantId,
        nextDate: toDocDate(dto.nextDate),
        endDate: dto.endDate ? toDocDate(dto.endDate) : null,
        isAdjustment: dto.isAdjustment ?? true,
      })
      .returning();
    return r;
  }

  async updateRecurring(user: AuthUser, id: string, dto: UpdateRecurringDto) {
    if (dto.lines) {
      await this.accounting.validateLines(user.tenantId, dto.lines);
      await this.accounting.assertNoControlAccounts(
        user,
        dto.lines.map((l) => l.accountId),
        undefined,
        'Jurnal berulang',
      );
    }
    const [r] = await this.db
      .update(recurringJournals)
      .set({ ...dto, nextDate: dto.nextDate ? toDocDate(dto.nextDate) : undefined })
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, user.tenantId)))
      .returning();
    if (!r) throw new NotFoundException('Jurnal berulang tidak ditemukan');
    return r;
  }

  async deleteRecurring(user: AuthUser, id: string) {
    const gone = await this.db
      .delete(recurringJournals)
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, user.tenantId)))
      .returning({ id: recurringJournals.id });
    if (!gone.length) throw new NotFoundException('Jurnal berulang tidak ditemukan');
    return { ok: true };
  }

  /**
   * Posting semua jurnal berulang yang jatuh tempo s/d hari ini (termasuk yang tertinggal) + jurnal balik terjadwal.
   * Setiap kemunculan diposting DAN tanggal berikutnya dimajukan dalam SATU transaksi dengan kunci baris templat, sehingga
   * penjadwal dan tombol manual yang berjalan bersamaan, atau proses yang terhenti di tengah, tidak pernah memposting dua kali.
   * (Database juga menolak jurnal ganda untuk templat dan tanggal yang sama.)
   */
  async runDue(tenantId: string, userId?: string) {
    const today = todayJakarta();
    const reversed = await this.runScheduledReversals(tenantId);
    const due = await this.db
      .select({ id: recurringJournals.id })
      .from(recurringJournals)
      .where(
        and(
          eq(recurringJournals.tenantId, tenantId),
          eq(recurringJournals.isActive, true),
          lte(recurringJournals.nextDate, today),
        ),
      );
    const posted: { name: string; number: string; date: string }[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const { id } of due) {
      let name = id;
      try {
        for (let guard = 0; guard < 1000; guard++) {
          const more = await this.db.transaction(async (tx) => {
            const r = await this.repo.recurringForUpdate(tx, tenantId, id);
            // proses lain mungkin sudah memajukannya
            if (!r || !r.isActive || r.nextDate > today) return false;
            name = r.name;
            const date = r.nextDate;
            const j = await this.posting.post(tx, {
              tenantId,
              date,
              description: r.description,
              sourceType: r.isAdjustment ? 'ADJUSTMENT' : 'RECURRING',
              sourceId: r.id,
              reference: `BRL-${r.id.slice(-6)}`,
              createdById: userId,
              lines: r.lines,
            });
            const next = nextOccurrence(date, r.frequency);
            const remaining = r.remaining != null ? r.remaining - 1 : null;
            const active = !((remaining != null && remaining <= 0) || (r.endDate && next > r.endDate));
            await tx
              .update(recurringJournals)
              .set({ nextDate: next, remaining, isActive: active, lastRunAt: new Date() })
              .where(eq(recurringJournals.id, r.id));
            posted.push({ name: r.name, number: j.number, date });
            return active && next <= today;
          });
          if (!more) break;
        }
      } catch (e) {
        errors.push({ name, error: (e as Error).message });
      }
    }
    return { posted, errors, reversed };
  }

  /**
   * Jurnal balik terjadwal (akrual "balik otomatis"): dibalik pada tanggal jadwalnya. Bila sudah dibalik manual, ditandai selesai
   * tanpa membuat pembalik kedua. Bila periode jadwal sudah terkunci, memakai hari ini.
   */
  async runScheduledReversals(tenantId: string) {
    const today = todayJakarta();
    const due = await this.db
      .select({ id: scheduledReversals.id })
      .from(scheduledReversals)
      .where(
        and(
          eq(scheduledReversals.tenantId, tenantId),
          eq(scheduledReversals.status, 'PENDING'),
          lte(scheduledReversals.reverseOn, today),
        ),
      );
    const done: { journalNumber: string; reversalNumber: string | null; date: string; skipped?: boolean }[] = [];
    for (const { id } of due) {
      try {
        await this.db.transaction(async (tx) => {
          const row = await this.repo.scheduledReversalForUpdate(tx, id);
          if (!row || row.status !== 'PENDING') return;
          const orig = await tx.query.journalEntries.findFirst({ where: eq(journalEntries.id, row.journalId) });
          const already = await tx.query.journalEntries.findFirst({
            where: eq(journalEntries.reversalOfId, row.journalId),
          });
          if (!orig || already) {
            await tx
              .update(scheduledReversals)
              .set({ status: 'SKIPPED', processedAt: new Date(), reversalJournalId: already?.id ?? null })
              .where(eq(scheduledReversals.id, id));
            done.push({
              journalNumber: orig?.number ?? '-',
              reversalNumber: already?.number ?? null,
              date: row.reverseOn,
              skipped: true,
            });
            return;
          }
          const locked = await this.period.lockedUntil(tx, tenantId);
          const date = locked && row.reverseOn <= locked ? today : row.reverseOn;
          const rev = await this.posting.reverse(tx, tenantId, row.journalId, date, row.createdById ?? undefined, true);
          await tx
            .update(scheduledReversals)
            .set({ status: 'DONE', processedAt: new Date(), reversalJournalId: rev.id, lastError: null })
            .where(eq(scheduledReversals.id, id));
          done.push({ journalNumber: orig.number, reversalNumber: rev.number, date });
        });
      } catch (e) {
        await this.db
          .update(scheduledReversals)
          .set({ lastError: (e as Error).message })
          .where(eq(scheduledReversals.id, id));
      }
    }
    return done;
  }

  /** Batalkan jadwal balik otomatis sebuah jurnal (jurnalnya sendiri tidak berubah) */
  async cancelScheduledReversal(user: AuthUser, journalId: string) {
    const r = await this.db
      .update(scheduledReversals)
      .set({ status: 'CANCELLED', processedAt: new Date() })
      .where(
        and(
          eq(scheduledReversals.journalId, journalId),
          eq(scheduledReversals.tenantId, user.tenantId),
          eq(scheduledReversals.status, 'PENDING'),
        ),
      )
      .returning({ id: scheduledReversals.id });
    if (!r.length) throw new NotFoundException('Tidak ada jadwal balik otomatis yang menunggu untuk jurnal ini');
    await this.audit.log(this.db, {
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'CANCEL_SCHEDULED_REVERSAL',
      entity: 'Journal',
      entityId: journalId,
    });
    return { ok: true };
  }

  async runAllDue() {
    const rec = await this.db
      .selectDistinct({ id: recurringJournals.tenantId })
      .from(recurringJournals)
      .where(eq(recurringJournals.isActive, true));
    const rev = await this.db
      .selectDistinct({ id: scheduledReversals.tenantId })
      .from(scheduledReversals)
      .where(eq(scheduledReversals.status, 'PENDING'));
    for (const id of new Set([...rec.map((x) => x.id), ...rev.map((x) => x.id)])) {
      const r = await this.runDue(id);
      if (r.posted.length) this.logger.log(`${r.posted.length} jurnal berulang diposting untuk tenant ${id}`);
      if (r.reversed.length) this.logger.log(`${r.reversed.length} jurnal balik terjadwal diproses untuk tenant ${id}`);
      for (const e of r.errors) this.logger.warn(`Jurnal berulang "${e.name}" gagal untuk tenant ${id}: ${e.error}`);
    }
  }
}
