/**
 * Serah terima dokumen antar bagian. Tiap peristiwa penting (pesanan dikonfirmasi, barang dikirim/diterima, produksi selesai,
 * sesi kasir ditutup, gaji diposting, ...) memberi tahu bagian yang harus bertindak berikutnya. Pelaku tidak diberi tahu
 * (dia yang baru bertindak); pemisahan fungsi tetap ditegakkan di tiap langkah oleh server.
 */
import type { Role } from './domain.js';

export const HANDOFF_EVENTS = [
  'SALES_ORDER_CONFIRMED',
  'DELIVERY_POSTED',
  'PO_CONFIRMED',
  'GOODS_RECEIVED',
  'PR_APPROVED',
  'PRODUCTION_COMPLETED',
  'POS_SESSION_CLOSED',
  'PAYROLL_POSTED',
] as const;
export type HandoffEvent = (typeof HANDOFF_EVENTS)[number];

export interface HandoffRule {
  /** Bagian yang diberi tahu (OWNER tidak diberi tahu otomatis kecuali tertulis) */
  to: Role[];
  /** Judul pemberitahuan; `{no}` diganti nomor dokumen */
  title: string;
  /** Apa yang harus dilakukan bagian penerima */
  action: string;
  path: string;
}

export const HANDOFFS: Record<HandoffEvent, HandoffRule> = {
  SALES_ORDER_CONFIRMED: { to: ['WAREHOUSE'], title: 'Pesanan {no} dikonfirmasi', action: 'Siapkan dan kirim barang (buat surat jalan).', path: '/sales-orders' },
  DELIVERY_POSTED: { to: ['FINANCE'], title: 'Surat jalan {no} terkirim', action: 'Terbitkan faktur penjualan atas pengiriman ini.', path: '/deliveries' },
  PO_CONFIRMED: { to: ['WAREHOUSE'], title: 'PO {no} dikonfirmasi ke pemasok', action: 'Siapkan penerimaan barang saat pemasok mengirim.', path: '/purchase-orders' },
  GOODS_RECEIVED: { to: ['FINANCE'], title: 'Barang diterima {no}', action: 'Catat tagihan pemasok dan cocokkan dengan penerimaan (3-way match).', path: '/goods-receipts' },
  PR_APPROVED: { to: ['PURCHASING'], title: 'Permintaan beli {no} disetujui', action: 'Jadikan Purchase Order.', path: '/purchase-requests?status=APPROVED' },
  PRODUCTION_COMPLETED: { to: ['WAREHOUSE', 'SALES'], title: 'Produksi {no} selesai', action: 'Barang jadi masuk stok: simpan, lalu kirim ke pelanggan bila ada pesanan.', path: '/production/orders' },
  POS_SESSION_CLOSED: { to: ['FINANCE', 'ADMIN'], title: 'Sesi kasir {no} ditutup', action: 'Periksa hitungan uang dan setorannya.', path: '/pos/sessions' },
  PAYROLL_POSTED: { to: ['FINANCE'], title: 'Gaji {no} diposting', action: 'Siapkan dan lakukan pembayaran gaji.', path: '/payroll' },
};
