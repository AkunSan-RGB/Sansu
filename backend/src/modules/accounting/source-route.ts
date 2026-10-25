import { Db } from '../../db/db';
import { DOCUMENT_VIEW_TYPES } from './source-document';
import { queryPayment } from './source-route.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Halaman daftar untuk jenis sumber yang tidak punya dokumen tunggal (tutup buku, PPh badan) */
const LIST_ROUTE: Record<string, string> = {
  CLOSING: '/closing',
  INCOME_TAX: '/fiscal',
};

/** Alamat halaman dokumen asal untuk setiap pasangan (jenis sumber, id sumber); null bila tidak ada dokumen (mis. jurnal manual) */
export async function resolveSourceRoutes(
  db: Db,
  tenantId: string,
  items: { id: string; sourceType: string; sourceId: string | null }[],
): Promise<(string | null)[]> {
  const paymentIds = [
    ...new Set(
      items.filter((i) => i.sourceType === 'PAYMENT' && i.sourceId && UUID.test(i.sourceId)).map((i) => i.sourceId!),
    ),
  ];
  const invoiceOf = new Map<string, string>();
  if (paymentIds.length) {
    const r = await queryPayment(db, tenantId, paymentIds);
    for (const row of r.rows) invoiceOf.set(row.id, row.invoice_id);
  }
  return items.map((i) => {
    const id = i.sourceId && UUID.test(i.sourceId) ? i.sourceId : null;
    switch (i.sourceType) {
      case 'INVOICE':
        return id ? `/invoices/${id}` : null;
      case 'DELIVERY':
        return id ? `/deliveries/${id}` : null;
      case 'GOODS_RECEIPT':
        return id ? `/goods-receipts/${id}` : null;
      case 'PAYMENT':
        return id && invoiceOf.has(id) ? `/invoices/${invoiceOf.get(id)}` : null;
      case 'PAYROLL':
      case 'PAYROLL_PAYMENT':
        return id ? `/payroll/${id}` : null;
      case 'ASSET_ACQUISITION':
      case 'ASSET_DISPOSAL':
        return id ? `/fixed-assets?asset=${id}` : null;
      default:
        // dokumen tanpa halaman sendiri dibuka di halaman rincian dokumen (berdasarkan jurnalnya)
        if (DOCUMENT_VIEW_TYPES.has(i.sourceType) && (id || i.sourceType === 'DEPRECIATION'))
          return `/documents/${i.id}`;
        return LIST_ROUTE[i.sourceType] ?? null;
    }
  });
}
