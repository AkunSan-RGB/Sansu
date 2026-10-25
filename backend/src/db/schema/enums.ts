// Skema database — enums
import { pgEnum } from 'drizzle-orm/pg-core';
import { ACCOUNT_TYPES, ACTIVITY_TYPES, ATTENDANCE_STATUSES, CASH_TX_TYPES, INVOICE_STATUSES, LEAD_STATUSES, LEAVE_STATUSES, LEAVE_TYPES, PAYROLL_STATUSES, POS_PAYMENT_METHODS, POS_SESSION_STATUSES, QUOTATION_STATUSES, PURCHASE_ORDER_STATUSES, ROLES, SALES_ORDER_STATUSES, STOCK_MOVE_TYPES } from '@sansu/shared';

// Nilai enum berasal dari @sansu/shared agar backend & frontend selalu sama
export const roleEnum = pgEnum('role', ROLES);

export const accountTypeEnum = pgEnum('account_type', ACCOUNT_TYPES);

export const salesOrderStatusEnum = pgEnum('sales_order_status', SALES_ORDER_STATUSES);

export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);

export const stockMoveTypeEnum = pgEnum('stock_move_type', STOCK_MOVE_TYPES);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', PURCHASE_ORDER_STATUSES);

export const cashTxTypeEnum = pgEnum('cash_tx_type', CASH_TX_TYPES);

export const posPaymentMethodEnum = pgEnum('pos_payment_method', POS_PAYMENT_METHODS);

export const posSessionStatusEnum = pgEnum('pos_session_status', POS_SESSION_STATUSES);

export const leadStatusEnum = pgEnum('lead_status', LEAD_STATUSES);

export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);

export const quotationStatusEnum = pgEnum('quotation_status', QUOTATION_STATUSES);

export const attendanceStatusEnum = pgEnum('attendance_status', ATTENDANCE_STATUSES);

export const leaveTypeEnum = pgEnum('leave_type', LEAVE_TYPES);

export const leaveStatusEnum = pgEnum('leave_status', LEAVE_STATUSES);

export const payrollStatusEnum = pgEnum('payroll_status', PAYROLL_STATUSES);

export type Role = (typeof roleEnum.enumValues)[number];

export type AccountType = (typeof accountTypeEnum.enumValues)[number];

export type SalesOrderStatus = (typeof salesOrderStatusEnum.enumValues)[number];

export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];

export type StockMoveType = (typeof stockMoveTypeEnum.enumValues)[number];

export type PurchaseOrderStatus = (typeof purchaseOrderStatusEnum.enumValues)[number];

export type CashTxType = (typeof cashTxTypeEnum.enumValues)[number];

/** Permintaan pembelian internal (gudang / divisi) — disetujui lalu diubah menjadi pesanan pembelian per supplier */
export const PURCHASE_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export type PosTabStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export type PosTabLineStatus = 'DRAFT' | 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'VOID';
