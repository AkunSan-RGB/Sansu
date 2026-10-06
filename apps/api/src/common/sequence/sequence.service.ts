import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Tx } from '../../db/db';
import { DocDate, period } from '../utils/dates';

export const DOC_PREFIX = {
  SALES_ORDER: 'SO',
  INVOICE: 'INV',
  PAYMENT: 'PAY',
  JOURNAL: 'JU',
  STOCK_ADJUSTMENT: 'ADJ',
  PURCHASE_ORDER: 'PO',
  PURCHASE_INVOICE: 'FB',
  SUPPLIER_PAYMENT: 'BH',
  SALES_RETURN: 'RJ',
  PURCHASE_RETURN: 'RB',
  CASH_IN: 'KM',
  CASH_OUT: 'KK',
  TRANSFER: 'TRF',
  POS_SESSION: 'KSR',
  POS_ORDER: 'POS',
  QUOTATION: 'SQ',
  PAYROLL: 'GJ',
  TAX_PAYMENT: 'SP',
  BANK_STATEMENT: 'RK',
  MARKETPLACE: 'MP',
  STOCK_TRANSFER: 'MG',
  STOCK_COUNT: 'OPN',
  CASH_COUNT: 'OPK',
  INVENTORY_WRITEDOWN: 'PNP',
  INVENTORY_WRITEUP: 'PMN',
  CUSTOMER_DEPOSIT: 'UMP',
  DEPOSIT_APPLICATION: 'PUM',
  PROJECT: 'PRJ',
  PROJECT_PROGRESS: 'KPK',
  PRODUCTION_ORDER: 'PRD',
} as const;

export type DocType = keyof typeof DOC_PREFIX;

@Injectable()
export class SequenceService {
  /**
   * Nomor dokumen berurutan tanpa celah, contoh: INV/2026/10/0001.
   * Atomik: INSERT ... ON CONFLICT DO UPDATE mengunci baris sequence sampai transaksi selesai,
   * dan nomor ikut di-rollback jika transaksi gagal.
   */
  async next(tx: Tx, tenantId: string, docType: DocType, date: DocDate): Promise<string> {
    const per = period(date);
    const res = await tx.execute<{ last_number: number }>(sql`
      INSERT INTO document_sequences (tenant_id, doc_type, period, last_number)
      VALUES (${tenantId}, ${docType}, ${per}, 1)
      ON CONFLICT (tenant_id, doc_type, period)
      DO UPDATE SET last_number = document_sequences.last_number + 1
      RETURNING last_number`);
    const n = res.rows[0].last_number;
    return `${DOC_PREFIX[docType]}/${per}/${String(n).padStart(4, '0')}`;
  }
}
