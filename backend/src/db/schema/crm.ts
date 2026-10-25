// Skema database — crm
import { relations } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { tenantId, users } from './tenancy';
import { customers } from './master-data';
import { activityTypeEnum, leadStatusEnum } from './enums';
import { quotations } from './sales';

export const crmStages = pgTable('crm_stages', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  sequence: integer('sequence').notNull(),
  /** Peluang default (%) saat prospek masuk tahap ini */
  probability: integer('probability').notNull().default(10),
});

export const leads = pgTable(
  'leads',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    contactName: text('contact_name'),
    companyName: text('company_name'),
    phone: text('phone'),
    email: text('email'),
    source: text('source'),
    expectedRevenue: money('expected_revenue').notNull().default('0'),
    probability: integer('probability').notNull().default(10),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => crmStages.id),
    ownerId: uuid('owner_id').references(() => users.id),
    status: leadStatusEnum('status').notNull().default('OPEN'),
    lostReason: text('lost_reason'),
    expectedCloseDate: date('expected_close_date'),
    notes: text('notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('leads_tenant_stage_idx').on(t.tenantId, t.status, t.stageId)],
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: id(),
    tenantId: tenantId(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull(),
    summary: text('summary').notNull(),
    dueDate: date('due_date').notNull(),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    result: text('result'),
    userId: uuid('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('crm_activities_due_idx').on(t.tenantId, t.done, t.dueDate)],
);

export const leadsRelations = relations(leads, ({ one, many }) => ({
  stage: one(crmStages, { fields: [leads.stageId], references: [crmStages.id] }),
  customer: one(customers, { fields: [leads.customerId], references: [customers.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  activities: many(crmActivities),
  quotations: many(quotations),
}));

export const crmActivitiesRelations = relations(crmActivities, ({ one }) => ({
  lead: one(leads, { fields: [crmActivities.leadId], references: [leads.id] }),
  user: one(users, { fields: [crmActivities.userId], references: [users.id] }),
}));
