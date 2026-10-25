import { LEDGER_KEYS } from '@/api/queries';

export type TransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

export interface TransferDetail {
  id: string;
  number: string;
  date: string;
  notes: string | null;
  totalValue: string;
  status: TransferStatus;
  receivedDate: string | null;
  receiveNotes: string | null;
  createdBy: string | null;
  receivedBy: string | null;
  from: { id: string; code: string; name: string; address: string | null };
  to: { id: string; code: string; name: string; address: string | null };
  lines: {
    productId: string;
    sku: string;
    name: string;
    baseUom: string;
    qty: string;
    unitCost: string;
    receivedQty: string | null;
  }[];
}

export const KEYS = ['transfers', 'stock', 'stock-moves', 'matrix', 'low-stock', 'dashboard', ...LEDGER_KEYS];
