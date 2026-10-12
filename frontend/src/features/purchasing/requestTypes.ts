export type PurchaseRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'CANCELLED';

export const PR_STATUS: Record<PurchaseRequestStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'default' },
  SUBMITTED: { label: 'Menunggu persetujuan', color: 'gold' },
  APPROVED: { label: 'Disetujui', color: 'green' },
  REJECTED: { label: 'Ditolak', color: 'red' },
  CONVERTED: { label: 'Sudah jadi PO', color: 'blue' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};

export interface PurchaseRequestRow {
  id: string;
  number: string;
  date: string;
  neededBy: string | null;
  status: PurchaseRequestStatus;
  autoApproved: boolean;
  warehouse: { code: string; name: string };
  requestedBy: string | null;
  lineCount: number;
  orderedCount: number;
}

export interface PurchaseRequest extends Omit<PurchaseRequestRow, 'lineCount' | 'orderedCount'> {
  notes: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  estimatedTotal: number;
  estimateComplete: boolean;
  warehouse: { id: string; code: string; name: string };
  lines: {
    id: string;
    productId: string;
    uom: string;
    qty: string;
    estPrice: string | null;
    supplierId: string | null;
    product: { sku: string; name: string; baseUom: string };
    supplier: { id: string; code: string; name: string } | null;
    order: { id: string; number: string; status: string } | null;
  }[];
}

export interface Suggestion {
  productId: string;
  sku: string;
  name: string;
  baseUom: string;
  warehouseId: string;
  warehouseCode: string;
  minQty: number;
  onHand: number;
  onOrder: number;
  requested: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
  lastPrice: number | null;
}
