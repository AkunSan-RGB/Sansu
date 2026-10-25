// Skema database — reminders
import { date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';
import { tenantId, users } from './tenancy';

/** Pengingat yang ditunda pengguna sampai tanggal tertentu */
export const reminderSnoozes = pgTable(
  'reminder_snoozes',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    until: date('until').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('reminder_snoozes_user_key_uq').on(t.userId, t.key)],
);

/** Catatan pengiriman pengingat agar tidak terkirim dua kali (ringkasan harian, pengingat tagihan pelanggan) */
export const reminderLog = pgTable(
  'reminder_log',
  {
    id: id(),
    tenantId: tenantId(),
    /** DIGEST = ringkasan harian ke pengguna; CUSTOMER = pengingat tagihan ke pelanggan */
    kind: text('kind').$type<'DIGEST' | 'CUSTOMER'>().notNull(),
    /** Pengguna (DIGEST) atau faktur (CUSTOMER) */
    ref: text('ref').notNull(),
    /** Tanggal (DIGEST) atau tahap pengingat (CUSTOMER: BEFORE, DUE, OVERDUE-1, ...) */
    stage: text('stage').notNull(),
    sentTo: text('sent_to'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reminder_log_uq').on(t.tenantId, t.kind, t.ref, t.stage)],
);
