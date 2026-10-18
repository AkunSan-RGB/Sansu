/**
 * Alur kerja operasional per jenis usaha. Tiap jenis usaha punya pipeline sendiri (tahap → tahap) yang dijalankan server:
 * tahap hanya boleh maju sesuai urutan, oleh peran yang berhak, dengan syarat (dokumen terkait, catatan, pemeriksa berbeda),
 * dan tahap yang bisa dipastikan dari dokumen (mis. faktur lunas) maju otomatis.
 */
import type { BusinessModel } from './apps.js';
import type { Role } from './domain.js';

export const WORKFLOW_LINK_TYPES = [
  'QUOTATION', 'SALES_ORDER', 'DELIVERY_ORDER', 'INVOICE', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PRODUCTION_ORDER', 'PROJECT', 'POS_SESSION', 'PRINCIPAL_CLAIM', 'CANVASS', 'STOCK_TRANSFER',
] as const;
export type WorkflowLinkType = (typeof WORKFLOW_LINK_TYPES)[number];
export const WORKFLOW_LINK_LABELS: Record<WorkflowLinkType, string> = {
  QUOTATION: 'Penawaran', SALES_ORDER: 'Pesanan penjualan', DELIVERY_ORDER: 'Surat jalan', INVOICE: 'Faktur / tagihan', PURCHASE_ORDER: 'Pesanan pembelian', GOODS_RECEIPT: 'Penerimaan barang',
  PURCHASE_INVOICE: 'Tagihan pemasok', PRODUCTION_ORDER: 'Perintah produksi', PROJECT: 'Proyek', POS_SESSION: 'Sesi kasir', PRINCIPAL_CLAIM: 'Klaim prinsipal', CANVASS: 'Setoran kanvas', STOCK_TRANSFER: 'Transfer stok',
};

/** Aturan maju otomatis: bila ada dokumen terkait bertipe `link` dengan status salah satu dari `status`, kasus dipindah ke tahap ini */
export interface AutoRule {
  link: WorkflowLinkType;
  status: string[];
}
export interface WorkflowStage {
  key: string;
  label: string;
  hint: string;
  /** Tahap berikutnya yang sah (maju); kasus tidak bisa loncat ke tahap lain */
  next: string[];
  /** Peran yang boleh memindahkan kasus KE tahap ini (Pemilik selalu boleh) */
  roles: Role[];
  /** Harus ada dokumen terkait bertipe ini (dan tidak dibatalkan) sebelum masuk tahap ini */
  requireLink?: WorkflowLinkType[];
  /** Wajib mengisi catatan / bukti (mis. berita acara, hasil QC) */
  requireNote?: boolean;
  /** Pemisahan fungsi: yang memindahkan kasus ke tahap sebelumnya tidak boleh memindahkan ke tahap ini (selain Pemilik) */
  sod?: boolean;
  auto?: AutoRule[];
  /** Batas hari berada di tahap ini sebelum dianggap macet */
  slaDays?: number;
  terminal?: 'DONE';
}
export interface WorkflowPipeline {
  key: string;
  model: BusinessModel;
  label: string;
  summary: string;
  /** Pihak yang ditangani kasus: pelanggan, pemasok, atau tidak ada */
  subject: 'CUSTOMER' | 'SUPPLIER' | 'NONE';
  /** Jenis dokumen yang boleh ditautkan */
  links: WorkflowLinkType[];
  start: string;
  stages: WorkflowStage[];
}

const SALES: Role[] = ['SALES', 'ADMIN', 'FINANCE'];
const WH: Role[] = ['WAREHOUSE', 'ADMIN'];
const FIN: Role[] = ['FINANCE', 'ADMIN'];
const BUY: Role[] = ['PURCHASING', 'ADMIN'];

/** Alur "pesanan → pengiriman → tagihan → lunas" (dipakai Dagang dan FMCG dengan istilah tahap berbeda) */
const orderToCash = (model: BusinessModel, key: string, label: string, summary: string, stageLabels: { order: string; approve: string; ship: string }): WorkflowPipeline => ({
  key, model, label, summary, subject: 'CUSTOMER', links: ['QUOTATION', 'SALES_ORDER', 'DELIVERY_ORDER', 'INVOICE'], start: 'PESANAN',
  stages: [
    { key: 'PESANAN', label: stageLabels.order, hint: 'Pesanan diterima dari pelanggan; belum dikonfirmasi.', next: ['DISETUJUI', 'BATAL'], roles: SALES },
    { key: 'DISETUJUI', label: stageLabels.approve, hint: 'Pesanan penjualan dikonfirmasi (stok dicadangkan, batas kredit diperiksa).', next: ['TERKIRIM', 'BATAL'], roles: SALES, requireLink: ['SALES_ORDER'], auto: [{ link: 'SALES_ORDER', status: ['CONFIRMED'] }], slaDays: 3 },
    { key: 'TERKIRIM', label: stageLabels.ship, hint: 'Barang sudah keluar gudang dan diterima pelanggan.', next: ['DITAGIH', 'BATAL'], roles: WH, auto: [{ link: 'SALES_ORDER', status: ['DELIVERED', 'INVOICED'] }, { link: 'DELIVERY_ORDER', status: ['DELIVERED'] }], slaDays: 3 },
    { key: 'DITAGIH', label: 'Ditagih', hint: 'Faktur terbit; menunggu pembayaran.', next: ['LUNAS', 'BATAL'], roles: FIN, requireLink: ['INVOICE'], auto: [{ link: 'INVOICE', status: ['UNPAID', 'PARTIAL', 'PAID'] }], slaDays: 2 },
    { key: 'LUNAS', label: 'Lunas', hint: 'Faktur dibayar penuh.', next: [], roles: FIN, auto: [{ link: 'INVOICE', status: ['PAID'] }], terminal: 'DONE' },
    { key: 'BATAL', label: 'Dibatalkan', hint: 'Dihentikan sebelum selesai (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
  ],
});

const procureToPay = (model: BusinessModel, key: string, label: string, summary: string, need: string): WorkflowPipeline => ({
  key, model, label, summary, subject: 'SUPPLIER', links: ['PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE'], start: 'KEBUTUHAN',
  stages: [
    { key: 'KEBUTUHAN', label: need, hint: 'Kebutuhan barang/bahan dicatat.', next: ['DIPESAN', 'BATAL'], roles: [...BUY, 'WAREHOUSE', 'SALES'] },
    { key: 'DIPESAN', label: 'Dipesan', hint: 'Pesanan pembelian dikonfirmasi ke pemasok.', next: ['DITERIMA', 'BATAL'], roles: BUY, requireLink: ['PURCHASE_ORDER'], auto: [{ link: 'PURCHASE_ORDER', status: ['CONFIRMED', 'BILLED'] }], slaDays: 3 },
    { key: 'DITERIMA', label: 'Diterima', hint: 'Barang diterima dan dicek jumlah serta kondisinya (oleh gudang, bukan pemesan).', next: ['DITAGIH', 'BATAL'], roles: WH, requireLink: ['GOODS_RECEIPT'], sod: true, auto: [{ link: 'GOODS_RECEIPT', status: ['RECEIVED'] }], slaDays: 14 },
    { key: 'DITAGIH', label: 'Tagihan masuk', hint: 'Tagihan pemasok dicatat dan dicocokkan dengan penerimaan.', next: ['DIBAYAR', 'BATAL'], roles: FIN, requireLink: ['PURCHASE_INVOICE'], sod: true, auto: [{ link: 'PURCHASE_INVOICE', status: ['UNPAID', 'PARTIAL', 'PAID'] }], slaDays: 7 },
    { key: 'DIBAYAR', label: 'Dibayar', hint: 'Tagihan pemasok lunas.', next: [], roles: FIN, auto: [{ link: 'PURCHASE_INVOICE', status: ['PAID'] }], terminal: 'DONE' },
    { key: 'BATAL', label: 'Dibatalkan', hint: 'Dihentikan sebelum selesai (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
  ],
});

/** Shift kasir: buka → tutup → setoran diperiksa orang lain → selesai */
const cashierShift = (model: BusinessModel, key: string, label: string): WorkflowPipeline => ({
  key, model, label, summary: 'Satu kasus per shift kasir: sesi dibuka, ditutup, uangnya diperiksa orang lain, lalu disetor.', subject: 'NONE', links: ['POS_SESSION'], start: 'DIBUKA',
  stages: [
    { key: 'DIBUKA', label: 'Shift dibuka', hint: 'Sesi kasir dibuka dengan kas awal.', next: ['DITUTUP', 'BATAL'], roles: ['CASHIER', 'ADMIN'], requireLink: ['POS_SESSION'] },
    { key: 'DITUTUP', label: 'Shift ditutup', hint: 'Sesi kasir ditutup; selisih kas tercatat.', next: ['DIPERIKSA', 'BATAL'], roles: ['CASHIER', 'ADMIN'], auto: [{ link: 'POS_SESSION', status: ['CLOSED'] }], slaDays: 1 },
    { key: 'DIPERIKSA', label: 'Uang diperiksa', hint: 'Uang dihitung ulang dan dicocokkan oleh orang selain kasir.', next: ['DISETOR', 'BATAL'], roles: FIN, requireNote: true, sod: true, slaDays: 1 },
    { key: 'DISETOR', label: 'Disetor', hint: 'Uang disetor ke bank / brankas.', next: [], roles: FIN, requireNote: true, terminal: 'DONE' },
    { key: 'BATAL', label: 'Dibatalkan', hint: 'Dihentikan (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
  ],
});

export const WORKFLOW_PIPELINES: WorkflowPipeline[] = [
  // ---- Dagang ----
  orderToCash('DAGANG', 'DAGANG_PENJUALAN', 'Penjualan: pesanan → pengiriman → pembayaran', 'Dari pesanan pelanggan sampai faktur lunas.', { order: 'Pesanan masuk', approve: 'Pesanan dikonfirmasi', ship: 'Terkirim' }),
  procureToPay('DAGANG', 'DAGANG_PEMBELIAN', 'Pembelian: kebutuhan → penerimaan → pembayaran', 'Dari kebutuhan barang sampai tagihan pemasok lunas.', 'Kebutuhan barang'),
  // ---- Ritel ----
  procureToPay('RITEL', 'RITEL_RESTOK', 'Restok toko: stok menipis → rak', 'Dari stok menipis sampai barang tiba dan ditagih.', 'Stok menipis'),
  cashierShift('RITEL', 'RITEL_SHIFT', 'Shift kasir toko'),
  // ---- Jasa ----
  {
    key: 'JASA_PROYEK', model: 'JASA', label: 'Proyek jasa: survei → serah terima → retensi', summary: 'Dari survei kebutuhan klien sampai pekerjaan diserahterimakan, ditagih, dan retensi selesai.', subject: 'CUSTOMER',
    links: ['QUOTATION', 'PROJECT', 'INVOICE'], start: 'SURVEI',
    stages: [
      { key: 'SURVEI', label: 'Survei / briefing', hint: 'Kebutuhan klien dipahami; lingkup dan perkiraan biaya dibuat.', next: ['PENAWARAN', 'BATAL'], roles: ['SALES', 'ADMIN'] },
      { key: 'PENAWARAN', label: 'Penawaran', hint: 'Penawaran terkirim ke klien.', next: ['KONTRAK', 'BATAL'], roles: ['SALES', 'ADMIN'], requireLink: ['QUOTATION'], auto: [{ link: 'QUOTATION', status: ['SENT'] }], slaDays: 7 },
      { key: 'KONTRAK', label: 'Kontrak disepakati', hint: 'Penawaran diterima klien; kontrak/SPK ditandatangani (catat nomor kontrak).', next: ['PENGERJAAN', 'BATAL'], roles: ['ADMIN'], requireLink: ['QUOTATION'], requireNote: true, sod: true, slaDays: 14 },
      { key: 'PENGERJAAN', label: 'Pengerjaan', hint: 'Proyek dibuat dan dikerjakan; biaya dan upah dicatat ke proyek.', next: ['SERAH_TERIMA', 'BATAL'], roles: ['ADMIN'], requireLink: ['PROJECT'], slaDays: 90 },
      { key: 'SERAH_TERIMA', label: 'Serah terima', hint: 'Pekerjaan diserahkan ke klien; berita acara ditandatangani (catat nomor BA).', next: ['DITAGIH', 'BATAL'], roles: ['ADMIN'], requireNote: true, sod: true, slaDays: 14 },
      { key: 'DITAGIH', label: 'Ditagih', hint: 'Tagihan terbit dan menunggu pembayaran.', next: ['RETENSI', 'SELESAI'], roles: FIN, requireLink: ['INVOICE'], auto: [{ link: 'INVOICE', status: ['UNPAID', 'PARTIAL'] }], slaDays: 30 },
      { key: 'RETENSI', label: 'Masa retensi', hint: 'Tagihan lunas; sebagian nilai kontrak ditahan sampai masa pemeliharaan selesai.', next: ['SELESAI'], roles: FIN, requireNote: true, slaDays: 180 },
      { key: 'SELESAI', label: 'Selesai', hint: 'Seluruh nilai kontrak tertagih dan retensi dilepas.', next: [], roles: FIN, requireNote: true, sod: true, terminal: 'DONE' },
      { key: 'BATAL', label: 'Dibatalkan', hint: 'Dihentikan sebelum selesai (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
    ],
  },
  // ---- FMCG ----
  orderToCash('FMCG', 'FMCG_ORDER', 'Order outlet: sales → muat → kirim → tagih', 'Dari order sales ke outlet sampai faktur lunas.', { order: 'Order sales', approve: 'Disetujui (kredit & promo)', ship: 'Terkirim ke outlet' }),
  {
    key: 'FMCG_KLAIM', model: 'FMCG', label: 'Klaim trade promo ke prinsipal', summary: 'Dari klaim disusun, diajukan, disetujui prinsipal, sampai dananya diterima.', subject: 'NONE', links: ['PRINCIPAL_CLAIM'], start: 'DISUSUN',
    stages: [
      { key: 'DISUSUN', label: 'Klaim disusun', hint: 'Klaim bulanan dihitung dari promo yang ditanggung prinsipal.', next: ['DIAJUKAN', 'BATAL'], roles: ['ADMIN', 'FINANCE'], requireLink: ['PRINCIPAL_CLAIM'] },
      { key: 'DIAJUKAN', label: 'Diajukan', hint: 'Klaim dikirim ke prinsipal.', next: ['DISETUJUI', 'BATAL'], roles: FIN, auto: [{ link: 'PRINCIPAL_CLAIM', status: ['SUBMITTED'] }], slaDays: 14 },
      { key: 'DISETUJUI', label: 'Disetujui prinsipal', hint: 'Prinsipal menyetujui sebagian/seluruh klaim.', next: ['DITERIMA', 'BATAL'], roles: FIN, auto: [{ link: 'PRINCIPAL_CLAIM', status: ['APPROVED'] }], slaDays: 30 },
      { key: 'DITERIMA', label: 'Dana diterima', hint: 'Dana klaim diterima dan dicatat.', next: [], roles: FIN, auto: [{ link: 'PRINCIPAL_CLAIM', status: ['PAID'] }], terminal: 'DONE' },
      { key: 'BATAL', label: 'Ditolak / dibatalkan', hint: 'Klaim ditolak prinsipal atau dibatalkan (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
    ],
  },
  // ---- Manufaktur ----
  {
    key: 'MFG_PRODUKSI', model: 'MANUFAKTUR', label: 'Produksi: permintaan → QC → pengiriman', summary: 'Dari permintaan produksi sampai barang jadi lolos QC dan dikirim.', subject: 'NONE', links: ['PRODUCTION_ORDER', 'SALES_ORDER', 'DELIVERY_ORDER'], start: 'PERMINTAAN',
    stages: [
      { key: 'PERMINTAAN', label: 'Permintaan produksi', hint: 'Kebutuhan produksi dicatat (pesanan klien atau stok).', next: ['MATERIAL_SIAP', 'BATAL'], roles: ['SALES', 'ADMIN', 'WAREHOUSE'] },
      { key: 'MATERIAL_SIAP', label: 'Bahan siap', hint: 'Ketersediaan bahan baku diperiksa gudang (catat hasil cek).', next: ['PRODUKSI', 'BATAL'], roles: WH, requireNote: true, slaDays: 3 },
      { key: 'PRODUKSI', label: 'Produksi berjalan', hint: 'Perintah produksi dimulai; bahan dipakai.', next: ['QC', 'BATAL'], roles: ['ADMIN', 'WAREHOUSE'], requireLink: ['PRODUCTION_ORDER'], auto: [{ link: 'PRODUCTION_ORDER', status: ['IN_PROGRESS'] }], slaDays: 14 },
      { key: 'QC', label: 'Pemeriksaan mutu (QC)', hint: 'Hasil produksi diperiksa oleh orang selain operator (catat hasil QC).', next: ['BARANG_JADI', 'PRODUKSI'], roles: ['ADMIN'], requireNote: true, sod: true, slaDays: 2 },
      { key: 'BARANG_JADI', label: 'Barang jadi', hint: 'Produksi selesai; barang jadi masuk stok.', next: ['DIKIRIM', 'SELESAI'], roles: WH, requireLink: ['PRODUCTION_ORDER'], auto: [{ link: 'PRODUCTION_ORDER', status: ['COMPLETED'] }], slaDays: 3 },
      { key: 'DIKIRIM', label: 'Dikirim', hint: 'Barang jadi dikirim ke pelanggan.', next: ['SELESAI'], roles: WH, auto: [{ link: 'DELIVERY_ORDER', status: ['DELIVERED'] }, { link: 'SALES_ORDER', status: ['DELIVERED', 'INVOICED'] }], slaDays: 7 },
      { key: 'SELESAI', label: 'Selesai', hint: 'Seluruh proses produksi selesai.', next: [], roles: ['ADMIN', 'WAREHOUSE'], terminal: 'DONE' },
      { key: 'BATAL', label: 'Dibatalkan', hint: 'Dihentikan sebelum selesai (wajib alasan).', next: [], roles: ['ADMIN'], requireNote: true, terminal: 'DONE' },
    ],
  },
  // ---- F&B ----
  procureToPay('FNB', 'FNB_BAHAN', 'Pengadaan bahan: kebutuhan → penerimaan → pembayaran', 'Dari kebutuhan bahan dapur sampai tagihan pemasok lunas.', 'Kebutuhan bahan'),
  cashierShift('FNB', 'FNB_SHIFT', 'Shift kasir restoran'),
];

export const WORKFLOW_PIPELINE_BY_KEY: Record<string, WorkflowPipeline> = Object.fromEntries(WORKFLOW_PIPELINES.map((p) => [p.key, p]));
export const pipelinesFor = (model: BusinessModel | string | null | undefined) => WORKFLOW_PIPELINES.filter((p) => p.model === model);
export const stageOf = (p: WorkflowPipeline, key: string) => p.stages.find((s) => s.key === key);
