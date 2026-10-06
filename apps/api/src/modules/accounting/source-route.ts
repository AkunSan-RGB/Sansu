/**
 * Dokumen asal sebuah jurnal: alamat halaman di aplikasi untuk membuka dokumen (faktur, surat jalan, dst.) yang melahirkan
 * jurnal itu. Dipakai buku besar, daftar jurnal, dan laporan agar setiap angka bisa ditelusuri ke sumbernya.
 */
import { inArray, sql } from 'drizzle-orm';
import { Db } from '../../db/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Halaman daftar untuk jenis sumber yang belum punya halaman rincian per dokumen */
const LIST_ROUTE: Record<string, string> = {
  SALES_RETURN: '/returns?tab=sales',
  PURCHASE_INVOICE: '/purchase-invoices',
  SUPPLIER_PAYMENT: '/purchase-invoices',
  PURCHASE_RETURN: '/returns?tab=purchase',
  STOCK_ADJUSTMENT: '/inventory',
  STOCK_TRANSFER: '/inventory/transfers',
  STOCK_COUNT: '/inventory/counts',
  INVENTORY_WRITEDOWN: '/inventory/writedowns',
  CASH_IN: '/cash',
  CASH_OUT: '/cash',
  TRANSFER: '/cash',
  CASH_COUNT: '/cash/counts',
  POS: '/pos/sessions',
  POS_CLOSE: '/pos/sessions',
  PAYROLL: '/payroll',
  PAYROLL_PAYMENT: '/payroll',
  DEPRECIATION: '/fixed-assets',
  ASSET_ACQUISITION: '/fixed-assets',
  ASSET_DISPOSAL: '/fixed-assets',
  TAX_PAYMENT: '/tax',
};

/** Alamat halaman dokumen asal untuk setiap pasangan (jenis sumber, id sumber); null bila tidak ada dokumen (mis. jurnal manual) */
export async function resolveSourceRoutes(db: Db, tenantId: string, items: { sourceType: string; sourceId: string | null }[]): Promise<(string | null)[]> {
  const paymentIds = [...new Set(items.filter((i) => i.sourceType === 'PAYMENT' && i.sourceId && UUID.test(i.sourceId)).map((i) => i.sourceId!))];
  const invoiceOf = new Map<string, string>();
  if (paymentIds.length) {
    const r = await db.execute<{ id: string; invoice_id: string }>(
      sql`SELECT id, invoice_id FROM payments WHERE tenant_id = ${tenantId} AND id IN (${sql.join(paymentIds.map((p) => sql`${p}`), sql`, `)})`,
    );
    for (const row of r.rows) invoiceOf.set(row.id, row.invoice_id);
  }
  return items.map((i) => {
    const id = i.sourceId && UUID.test(i.sourceId) ? i.sourceId : null;
    switch (i.sourceType) {
      case 'INVOICE':
        return id ? `/invoices/${id}` : null;
      case 'DELIVERY':
        return id ? `/deliveries/${id}` : null;
      case 'PAYMENT':
        return id && invoiceOf.has(id) ? `/invoices/${invoiceOf.get(id)}` : null;
      default:
        return LIST_ROUTE[i.sourceType] ?? null;
    }
  });
}
