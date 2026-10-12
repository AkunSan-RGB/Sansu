import {
  INVOICE_STATUS_LABELS,
  type InvoiceStatus,
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderStatus,
  SALES_ORDER_STATUS_LABELS,
  type SalesOrderStatus,
  toOptions,
} from '@sansu/shared';
import { Tag } from 'antd';

const SO_COLOR: Record<SalesOrderStatus, string> = { DRAFT: 'default', CONFIRMED: 'blue', DELIVERED: 'cyan', INVOICED: 'green', CANCELLED: 'red' };
const PO_COLOR: Record<PurchaseOrderStatus, string> = { DRAFT: 'default', CONFIRMED: 'blue', BILLED: 'green', CANCELLED: 'red' };
const INV_COLOR: Record<InvoiceStatus, string> = { UNPAID: 'orange', PARTIAL: 'gold', PAID: 'green' };

export const SalesOrderStatusTag = ({ status }: { status: SalesOrderStatus }) => (
  <Tag color={SO_COLOR[status]}>{SALES_ORDER_STATUS_LABELS[status]}</Tag>
);

export const InvoiceStatusTag = ({ status }: { status: InvoiceStatus }) => (
  <Tag color={INV_COLOR[status]}>{INVOICE_STATUS_LABELS[status]}</Tag>
);

export const SO_STATUS_OPTIONS = toOptions(SALES_ORDER_STATUS_LABELS);
export const INV_STATUS_OPTIONS = toOptions(INVOICE_STATUS_LABELS);

export const PurchaseOrderStatusTag = ({ status }: { status: PurchaseOrderStatus }) => (
  <Tag color={PO_COLOR[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Tag>
);

export const PO_STATUS_OPTIONS = toOptions(PURCHASE_ORDER_STATUS_LABELS);
