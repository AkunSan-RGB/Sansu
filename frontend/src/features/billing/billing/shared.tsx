import { type BillingInvoice } from '@sansu/shared';

export const INV_COLOR: Record<BillingInvoice['status'], string> = {
  UNPAID: 'gold',
  WAITING: 'blue',
  PAID: 'green',
  CANCELLED: 'default',
};

export const CYCLE = { MONTHLY: 'Bulanan', YEARLY: 'Tahunan' } as const;
