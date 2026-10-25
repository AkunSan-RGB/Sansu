

export const AUDIT_CATEGORIES = ['sales', 'purchase', 'inventory', 'accounting', 'master', 'hr', 'settings', 'security'] as const;

export type Category = (typeof AUDIT_CATEGORIES)[number];

const NOUN: Record<string, [string, Category]> = {
  // entitas dari catatan rinci
  SalesOrder: ['sales order', 'sales'],
  DeliveryTrip: ['rute pengiriman', 'sales'],
  DeliveryVehicle: ['kendaraan pengiriman', 'sales'],
  TimeEntry: ['catatan waktu', 'sales'],
  WorkCenter: ['pusat kerja', 'inventory'],
  WorkCenterDowntime: ['mesin mati', 'inventory'],
  BomOperations: ['operasi resep', 'inventory'],
  ProductionOperation: ['operasi produksi', 'inventory'],
  QcSetup: ['karantina QC', 'inventory'],
  QcPlan: ['rencana QC', 'inventory'],
  QcInspection: ['inspeksi QC', 'inventory'],
  TimesheetBilling: ['penagihan lembar waktu', 'sales'],
  BillingRate: ['tarif tagih per jam', 'sales'],
  SchedulingResource: ['sumber daya jadwal', 'sales'],
  ResourceBooking: ['pemesanan jadwal', 'sales'],
  LoyaltySettings: ['pengaturan loyalitas', 'sales'],
  LoyaltyAdjustment: ['penyesuaian poin', 'sales'],
  LoyaltyExpiry: ['kedaluwarsa poin', 'sales'],
  CardSettlementSettings: ['pengaturan MDR', 'sales'],
  PosCardSettlement: ['pencairan QRIS/kartu', 'sales'],
  UtilityIngestKey: ['kunci API meter', 'sales'],
  UtilityRemittance: ['setoran kas loket', 'sales'],
  UtilityCounterReceipt: ['penerimaan loket', 'sales'],
  Invoice: ['faktur penjualan', 'sales'],
  Payment: ['pembayaran pelanggan', 'sales'],
  SalesReturn: ['retur penjualan', 'sales'],
  Quotation: ['penawaran', 'sales'],
  Lead: ['prospek', 'sales'],
  PosSession: ['sesi kasir', 'sales'],
  Marketplace: ['pesanan marketplace', 'sales'],
  PurchaseOrder: ['purchase order', 'purchase'],
  PurchaseInvoice: ['faktur pembelian', 'purchase'],
  PurchaseBill: ['tagihan biaya/aset', 'purchase'],
  SupplierPayment: ['pembayaran supplier', 'purchase'],
  PurchaseReturn: ['retur pembelian', 'purchase'],
  StockAdjustment: ['penyesuaian stok', 'inventory'],
  CashTransaction: ['transaksi kas', 'accounting'],
  BankStatement: ['mutasi bank', 'accounting'],
  TaxPayment: ['setoran pajak', 'accounting'],
  FixedAsset: ['aset tetap', 'accounting'],
  Tenant: ['perusahaan', 'settings'],
  Branding: ['kop surat', 'settings'],
  Import: ['impor data Excel', 'master'],
  Employee: ['karyawan', 'hr'],
  PayrollRun: ['penggajian', 'hr'],
  LeaveRequest: ['cuti', 'hr'],
  User: ['pengguna', 'security'],
  // segmen rute API (catatan otomatis)
  journals: ['jurnal umum', 'accounting'],
  recurring: ['jurnal berulang', 'accounting'],
  'opening-balances': ['saldo awal', 'accounting'],
  period: ['periode akuntansi', 'accounting'],
  accounts: ['akun', 'accounting'],
  notes: ['catatan laporan (CALK)', 'accounting'],
  fiscal: ['rekonsiliasi fiskal', 'accounting'],
  depreciation: ['penyusutan', 'accounting'],
  categories: ['kategori aset', 'accounting'],
  transactions: ['transaksi kas', 'accounting'],
  statements: ['mutasi bank', 'accounting'],
  lines: ['baris mutasi bank', 'accounting'],
  payments: ['pembayaran', 'accounting'],
  tax: ['pajak', 'accounting'],
  products: ['produk', 'master'],
  customers: ['pelanggan', 'master'],
  suppliers: ['supplier', 'master'],
  warehouses: ['gudang', 'master'],
  imports: ['impor data Excel', 'master'],
  invoices: ['faktur penjualan', 'sales'],
  'sales-orders': ['sales order', 'sales'],
  'sales-returns': ['retur penjualan', 'sales'],
  quotations: ['penawaran', 'sales'],
  leads: ['prospek', 'sales'],
  activities: ['aktivitas CRM', 'sales'],
  stages: ['tahap pipeline', 'sales'],
  orders: ['transaksi kasir', 'sales'],
  sessions: ['sesi kasir', 'sales'],
  marketplace: ['pesanan marketplace', 'sales'],
  'purchase-orders': ['purchase order', 'purchase'],
  'purchase-invoices': ['faktur pembelian', 'purchase'],
  'purchase-returns': ['retur pembelian', 'purchase'],
  bills: ['tagihan biaya/aset', 'purchase'],
  adjustments: ['penyesuaian stok', 'inventory'],
  employees: ['karyawan', 'hr'],
  attendance: ['absensi', 'hr'],
  leaves: ['cuti', 'hr'],
  runs: ['penggajian', 'hr'],
  users: ['pengguna', 'security'],
  apps: ['aplikasi', 'settings'],
  settings: ['pengaturan', 'settings'],
  company: ['data perusahaan', 'settings'],
  branding: ['kop surat', 'settings'],
  reporting: ['pengaturan pelaporan', 'settings'],
  payroll: ['pengaturan penggajian', 'settings'],
  integrations: ['pengaturan integrasi', 'settings'],
};

const VERB: Record<string, string> = {
  CREATE: 'Membuat',
  UPDATE: 'Mengubah',
  DELETE: 'Menghapus',
  CONFIRM: 'Mengonfirmasi',
  CANCEL: 'Membatalkan',
  POST: 'Memposting',
  OPEN: 'Membuka',
  CLOSE: 'Menutup',
  SETTLE: 'Mencatat pencairan',
  DISPOSE: 'Melepas',
  STOCK_ADJUST: 'Mencatat',
  CLOSE_YEAR: 'Menutup buku tahun',
  IMPORT: 'Mengimpor',
  LOGIN: 'Masuk ke aplikasi',
  ADD_STOPS: 'Menambah stop pada',
  REMOVE_STOP: 'Melepas stop dari',
  REORDER: 'Mengurutkan stop',
  DEPART: 'Memberangkatkan',
  STOP_DELIVERED: 'Mencatat terkirim pada',
  STOP_FAILED: 'Mencatat gagal kirim pada',
  COMPLETE: 'Menyelesaikan',
  // aksi pada rute :id/<aksi>
  confirm: 'Mengonfirmasi',
  cancel: 'Membatalkan',
  reverse: 'Membalik',
  close: 'Menutup',
  post: 'Memposting',
  pay: 'Membayar',
  run: 'Menjalankan',
  recompute: 'Menghitung ulang',
  delete: 'Menghapus',
  install: 'Mengaktifkan',
  uninstall: 'Menonaktifkan',
  send: 'Mengirim',
  reject: 'Menolak',
  convert: 'Mengubah jadi sales order',
  mark: 'Menandai',
  done: 'Menyelesaikan',
  decide: 'Memutuskan',
  match: 'Mencocokkan',
  unmatch: 'Membatalkan pencocokan',
  ignore: 'Mengabaikan',
  create: 'Membuat jurnal dari',
  'auto-match': 'Mencocokkan otomatis',
  lock: 'Mengunci',
  'close-year': 'Menutup buku tahun',
  journal: 'Menjurnal',
  settle: 'Mencatat pencairan',
  import: 'Mengimpor',
};

export function describe(action: string, entity: string, data: Record<string, unknown> | null): { label: string; category: Category } {
  if (action === 'LOGIN') return { label: 'Masuk ke aplikasi', category: 'security' };
  if (entity !== 'API') {
    const [noun, category] = NOUN[entity] ?? [entity, 'settings'];
    return { label: `${VERB[action] ?? action} ${noun}`.trim(), category };
  }
  // catatan otomatis: "PATCH /api/products/:id" → "Mengubah produk"
  const route = String(data?.route ?? '');
  const [method, path = ''] = route.split(' ');
  const segs = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const words = segs.filter((s) => !s.startsWith(':'));
  const last = words[words.length - 1];
  const tail = segs[segs.length - 1];
  const resource = [...words].reverse().find((w) => NOUN[w]) ?? words[0];
  const [noun, category] = NOUN[resource] ?? [resource ?? 'data', 'settings'];
  let verb = method === 'POST' ? 'Membuat' : method === 'DELETE' ? 'Menghapus' : 'Mengubah';
  if (last && VERB[last] && !NOUN[last] && !tail?.startsWith(':')) verb = VERB[last];
  if (resource === 'users' && method === 'PATCH') verb = 'Mengubah akses';
  return { label: `${verb} ${noun}`, category };
}

export const describeAudit = describe;
