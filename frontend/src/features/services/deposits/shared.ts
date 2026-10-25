import { LEDGER_KEYS } from '@/api/queries';

export const INVALIDATE = ['deposits', 'invoices', 'invoice', 'projects', 'customers', ...LEDGER_KEYS];
