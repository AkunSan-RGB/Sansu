
import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid, customType } from 'drizzle-orm/pg-core';
import { decryptField, encryptField } from '../../common/utils/secret';

/** Kolom identitas/rekening: terenkripsi AES-256-GCM di database, otomatis dibuka/ditutup saat dibaca/ditulis (lihat secret.ts) */
export const encryptedText = customType<{ data: string | null; driverData: string | null }>({
  dataType: () => 'text',
  toDriver: (v) => encryptField(v),
  fromDriver: (v) => decryptField(v),
});

export const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

export const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** UUIDv7 (bawaan PostgreSQL 18): berurutan waktu → indeks B-tree lebih rapat & insert lebih cepat */
export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
