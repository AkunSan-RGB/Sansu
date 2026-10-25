// Skema database — workflow
import { bigserial, boolean, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { tenantId } from './tenancy';
import { customers, suppliers } from './master-data';

/** Alur kerja operasional: satu kasus = satu proses (mis. proyek jasa, order outlet) yang bergerak antar tahap sesuai pipeline jenis usahanya */
export const workflowCases = pgTable(
  'workflow_cases',
  {
    id: id(),
    tenantId: tenantId(),
    pipeline: text('pipeline').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    stage: text('stage').notNull(),
    status: text('status').$type<'ACTIVE' | 'DONE' | 'CANCELLED'>().notNull().default('ACTIVE'),
    customerId: uuid('customer_id').references(() => customers.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    amount: money('amount').notNull().default('0'),
    dueDate: date('due_date'),
    createdById: uuid('created_by_id').notNull(),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    stageEnteredById: uuid('stage_entered_by_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Kunci kasus buatan sistem (mis. RESTOCK:produk:gudang) agar tidak ganda */
    refKey: text('ref_key'),
    autoOpened: boolean('auto_opened').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_cases_number_uq').on(t.tenantId, t.number), index('workflow_cases_pipeline_idx').on(t.tenantId, t.pipeline, t.status, t.stage)],
);

export const workflowLinks = pgTable(
  'workflow_links',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id').notNull().references(() => workflowCases.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    docId: uuid('doc_id').notNull(),
    docNumber: text('doc_number').notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_links_doc_uq').on(t.tenantId, t.linkType, t.docId), index('workflow_links_case_idx').on(t.caseId)],
);

export const workflowEvents = pgTable(
  'workflow_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    caseId: uuid('case_id').notNull().references(() => workflowCases.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage'),
    note: text('note'),
    byId: uuid('by_id'),
    auto: boolean('auto').notNull().default(false),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workflow_events_case_idx').on(t.caseId, t.id)],
);
