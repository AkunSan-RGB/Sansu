import { type BusinessModel } from '@sansu/shared';
import { tradeTerms } from '../../db/schema';
import * as X from './demo.extra';
import { addCustomers, addSuppliers, Demo, expense, openingBalance, payBill, payroll, posDay, purchase, receive, sell } from './demo.kit';

type Prod = { sku: string; name: string; cat: string; price: number; cost: number; qty: number; uom?: string; per?: number };

/** Buat produk + stok awal 60 hari lalu; kembalikan id per SKU dan nilai persediaan */
async function stockItems(c: Demo, list: Prod[], extra: { uoms?: boolean } = {}) {
  const ids = new Map<string, string>();
  for (const [i, p] of list.entries()) {
    const r = await c.svc.products.create(c.tenantId, {
      sku: p.sku,
      name: p.name,
      category: p.cat,
      baseUom: p.uom ?? 'PCS',
      sellPrice: String(p.price),
      barcode: `8991${String(i + 1).padStart(9, '0')}`,
      ...(extra.uoms && p.per ? { uoms: [{ uom: 'DUS', factor: String(p.per) }] } : {}),
    } as never);
    ids.set(p.sku, r.id);
  }
  const lines = list.map((p) => ({ productId: ids.get(p.sku)!, qty: String(p.qty), unitCost: String(p.cost) }));
  await c.svc.inventory.adjust(c.admin as never, { warehouseId: c.wh, reason: 'OPENING', date: c.ago(120), notes: 'Saldo awal stok', lines } as never);
  const value = list.reduce((a, p) => a + p.qty * p.cost, 0);
  return { ids, value };
}

// ---------------------------------------------------------------- RITEL
const RITEL: Prod[] = [
  { sku: 'RT-MIE', name: 'Mi Instan Goreng', cat: 'Makanan', price: 3500, cost: 2800, qty: 600 },
  { sku: 'RT-BISK', name: 'Biskuit Kelapa 200g', cat: 'Makanan', price: 9500, cost: 7400, qty: 240 },
  { sku: 'RT-COKL', name: 'Cokelat Batang 40g', cat: 'Makanan', price: 8000, cost: 6200, qty: 180 },
  { sku: 'RT-AIR', name: 'Air Mineral 600ml', cat: 'Minuman', price: 4000, cost: 2900, qty: 480 },
  { sku: 'RT-TEH', name: 'Teh Kotak 300ml', cat: 'Minuman', price: 5500, cost: 4100, qty: 360 },
  { sku: 'RT-KOPI', name: 'Kopi Sachet', cat: 'Minuman', price: 2000, cost: 1450, qty: 800 },
  { sku: 'RT-SABUN', name: 'Sabun Mandi Batang', cat: 'Perawatan', price: 4500, cost: 3300, qty: 200 },
  { sku: 'RT-SHAMP', name: 'Sampo Sachet', cat: 'Perawatan', price: 1500, cost: 1050, qty: 500 },
  { sku: 'RT-DETER', name: 'Deterjen 800g', cat: 'Rumah Tangga', price: 21000, cost: 16500, qty: 90 },
  { sku: 'RT-TISU', name: 'Tisu Wajah 250s', cat: 'Rumah Tangga', price: 12500, cost: 9400, qty: 120 },
  { sku: 'RT-BERAS', name: 'Beras Pulen 5kg', cat: 'Sembako', price: 78000, cost: 68000, qty: 60 },
  { sku: 'RT-MINYAK', name: 'Minyak Goreng 1L', cat: 'Sembako', price: 17500, cost: 14800, qty: 150 },
];
async function seedRitel(c: Demo) {
  const { ids, value } = await stockItems(c, RITEL.map((p) => ({ ...p, qty: p.qty * 3 })));
  await openingBalance(c, { kas: 8_000_000, bank: 160_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-GROSIR', name: 'PT Grosir Makmur Sentosa', term: 14 },
    { code: 'SUP-FMCG', name: 'CV Distributor Harian Jaya', term: 7 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'MBR-01', name: 'Member Setia (umum)', address: 'Jakarta', term: 0 },
    { code: 'KTR-LANGGANAN', name: 'Kantor Notaris Prima (langganan)', address: 'Jl. Pasar Minggu No. 40, Jakarta', term: 14 },
    { code: 'WRG-MITRA', name: 'Warung Mitra Sekitar', address: 'Gg. Mawar, Pasar Minggu', term: 7 },
    { code: 'KTRN-CEMPAKA', name: 'Katering Cempaka', address: 'Jl. Cempaka Putih, Jakarta', term: 14 },
  ]);
  const items = RITEL.map((p) => ({ id: ids.get(p.sku)!, price: p.price }));
  for (let d = 28; d >= 1; d -= 1) await c.step(`kasir H-${d}`, () => posDay(c, d, items, c.int(5, 9)));
  await c.step('beli 1', () => purchase(c, sup.get('SUP-GROSIR')!, 26, [{ productId: ids.get('RT-BERAS')!, qty: 40, price: 68500 }, { productId: ids.get('RT-MINYAK')!, qty: 100, price: 14900 }], { pay: true, invoiceNo: 'GRM/0925/118' }));
  await c.step('beli 2', () => purchase(c, sup.get('SUP-FMCG')!, 14, [{ productId: ids.get('RT-MIE')!, qty: 400, price: 2800 }, { productId: ids.get('RT-AIR')!, qty: 300, price: 2900 }, { productId: ids.get('RT-TEH')!, qty: 200, price: 4100 }], { pay: true, invoiceNo: 'DHJ-2231' }));
  await c.step('beli 3 (belum lunas)', () => purchase(c, sup.get('SUP-GROSIR')!, 4, [{ productId: ids.get('RT-DETER')!, qty: 60, price: 16600 }, { productId: ids.get('RT-TISU')!, qty: 80, price: 9500 }], { invoiceNo: 'GRM/1025/044' }));
  await expense(c, 55, 'bank', '6-3000', 'Sewa kios bulan ini', 6_500_000, 'SEWA-KIOS');
  await expense(c, 25, 'bank', '6-4000', 'Listrik & air toko', 1_350_000);
  await expense(c, 12, 'kas', '6-6000', 'Kantong plastik & label harga', 420_000, 'NOTA-0112');
  await payroll(c, [
    { code: 'K-001', name: 'Rina Marlina', title: 'Kasir', dept: 'Toko', salary: 3_600_000, allowance: 300_000, ptkp: 'TK/0' },
    { code: 'K-002', name: 'Dedi Kurniawan', title: 'Penjaga Toko', dept: 'Toko', salary: 3_400_000, allowance: 250_000, ptkp: 'TK/0' },
  ]);
  // penjualan grosir ke langganan (faktur, piutang, retur) selain kasir
  let ritelUnpaid: string | undefined;
  const grosir: [string, number, [string, number][], boolean][] = [
    ['KTR-LANGGANAN', 70, [['RT-BERAS', 6], ['RT-MINYAK', 12], ['RT-KOPI', 40]], true],
    ['WRG-MITRA', 52, [['RT-MIE', 60], ['RT-AIR', 48]], true],
    ['KTRN-CEMPAKA', 36, [['RT-BERAS', 8], ['RT-MINYAK', 10]], true],
    ['KTR-LANGGANAN', 20, [['RT-AIR', 72], ['RT-TEH', 36]], true],
    ['WRG-MITRA', 9, [['RT-MIE', 40], ['RT-BISK', 20]], false],
    ['KTRN-CEMPAKA', 4, [['RT-BERAS', 5], ['RT-MINYAK', 8]], false],
  ];
  for (const [code, ago, items, paid] of grosir) {
    const inv = await c.step(`jual grosir ${code}`, () => sell(c, cu.get(code)!, ago, items.map(([k, q]) => ({ productId: ids.get(k)!, qty: q }))));
    if (inv && paid) await c.step('terima bayar grosir', () => receive(c, inv, Math.max(ago - 6, 2)));
    else if (inv) ritelUnpaid = inv;
  }
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kios bulanan', amount: 6_500_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik & air toko', amount: 1_350_000, from: 'bank', day: 12 },
    { code: '6-6000', desc: 'Kantong plastik & label harga', amount: 420_000, from: 'kas', day: 18 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-GROSIR', [
    { cat: 'Peralatan', name: 'Rak display & kulkas minuman', cost: 14_500_000, ago: 100, location: 'Toko' },
    { cat: 'Inventaris', name: 'Komputer kasir & printer struk', cost: 8_200_000, ago: 75, location: 'Kasir' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 6_500_000 }, { code: '6-4000', monthly: 1_500_000 }, { code: '6-1000', monthly: 8_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.stockOps(c, ids, RITEL.map((p) => p.sku), { saleInvoiceId: ritelUnpaid, billId: c.last.bill, supplierId: sup.get('SUP-FMCG') });
}

// ---------------------------------------------------------------- DAGANG
const DAGANG: Prod[] = [
  { sku: 'BB-SEMEN', name: 'Semen Portland 50kg', cat: 'Semen & Mortar', price: 68000, cost: 59500, qty: 800, uom: 'SAK' },
  { sku: 'BB-MORTAR', name: 'Mortar Instan 40kg', cat: 'Semen & Mortar', price: 92000, cost: 78000, qty: 300, uom: 'SAK' },
  { sku: 'BB-CAT-TEMBOK', name: 'Cat Tembok Interior 25kg', cat: 'Cat', price: 725000, cost: 610000, qty: 80, uom: 'PAIL' },
  { sku: 'BB-CAT-KAYU', name: 'Cat Kayu & Besi 1kg', cat: 'Cat', price: 62000, cost: 49500, qty: 240, uom: 'KLG' },
  { sku: 'BB-PIPA', name: 'Pipa PVC 3" (4m)', cat: 'Pipa', price: 98000, cost: 79000, qty: 220, uom: 'BTG' },
  { sku: 'BB-KERAMIK', name: 'Keramik Lantai 40x40', cat: 'Keramik', price: 215000, cost: 176000, qty: 150, uom: 'DUS' },
  { sku: 'BB-BESI', name: 'Besi Beton 10mm (12m)', cat: 'Besi', price: 98500, cost: 86000, qty: 400, uom: 'BTG' },
  { sku: 'BB-PAKU', name: 'Paku Beton 2" (1kg)', cat: 'Perkakas', price: 24000, cost: 17500, qty: 320, uom: 'KG' },
  { sku: 'BB-GENTENG', name: 'Genteng Beton', cat: 'Atap', price: 7800, cost: 6100, qty: 2500, uom: 'LBR' },
];
async function seedDagang(c: Demo) {
  const { ids, value } = await stockItems(c, DAGANG);
  await openingBalance(c, { kas: 15_000_000, bank: 640_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-SEMEN', name: 'PT Indo Semen Perkasa', term: 30 },
    { code: 'SUP-CAT', name: 'PT Warna Nusantara Coating', term: 30 },
    { code: 'SUP-BESI', name: 'CV Baja Utama Metal', term: 21 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'TB-MAJU', name: 'Toko Bangunan Maju Jaya', address: 'Jl. Raya Bekasi Km 18', term: 30 },
    { code: 'KTR-BINTANG', name: 'CV Kontraktor Bintang Timur', address: 'Jl. Pemuda No. 77, Jakarta', term: 45, limit: '300000000' },
    { code: 'PROP-GRAHA', name: 'PT Graha Properti Mandiri', address: 'Cluster Aurora, Tangerang', term: 30 },
    { code: 'TB-SUMBER', name: 'Toko Bangunan Sumber Makmur', address: 'Jl. Raya Bogor Km 30', term: 14 },
    { code: 'PRM-HARAPAN', name: 'Pemborong Harapan Baru', address: 'Depok', term: 14, limit: '60000000' },
  ]);
  const id = (s: string) => ids.get(s)!;
  const sales = [
    { cu: 'TB-MAJU', ago: 50, lines: [{ productId: id('BB-SEMEN'), qty: 120 }, { productId: id('BB-PAKU'), qty: 40 }], pay: 22 },
    { cu: 'KTR-BINTANG', ago: 44, lines: [{ productId: id('BB-BESI'), qty: 160 }, { productId: id('BB-SEMEN'), qty: 200 }], pay: 5 },
    { cu: 'PROP-GRAHA', ago: 40, lines: [{ productId: id('BB-KERAMIK'), qty: 60 }, { productId: id('BB-CAT-TEMBOK'), qty: 12 }], pay: 0 }, // belum dibayar: jatuh tempo
    { cu: 'TB-SUMBER', ago: 33, lines: [{ productId: id('BB-PIPA'), qty: 60 }, { productId: id('BB-MORTAR'), qty: 50 }], pay: 18 },
    { cu: 'PRM-HARAPAN', ago: 27, lines: [{ productId: id('BB-GENTENG'), qty: 900 }, { productId: id('BB-PAKU'), qty: 25 }], pay: 10 },
    { cu: 'TB-MAJU', ago: 20, lines: [{ productId: id('BB-CAT-KAYU'), qty: 60 }, { productId: id('BB-SEMEN'), qty: 90 }], pay: -1 },
    { cu: 'KTR-BINTANG', ago: 11, lines: [{ productId: id('BB-KERAMIK'), qty: 40 }, { productId: id('BB-BESI'), qty: 90 }], pay: -1 },
    { cu: 'KTR-BINTANG', ago: 6, lines: [{ productId: id('BB-PIPA'), qty: 50 }, { productId: id('BB-CAT-TEMBOK'), qty: 8 }], pay: -1 },
    { cu: 'TB-SUMBER', ago: 3, lines: [{ productId: id('BB-SEMEN'), qty: 70 }], pay: -1 },
  ];
  let unpaidInv: string | undefined;
  for (const s of sales) {
    const inv = await c.step(`jual ${s.cu}`, () => sell(c, cu.get(s.cu)!, s.ago, s.lines));
    if (inv && s.pay > 0) await c.step('terima bayar', () => receive(c, inv, s.pay, 'TRANSFER'));
    else if (inv && s.pay === -1) unpaidInv = inv;
  }
  await c.step('beli semen', () => purchase(c, sup.get('SUP-SEMEN')!, 45, [{ productId: id('BB-SEMEN'), qty: 600, price: 59800 }, { productId: id('BB-MORTAR'), qty: 150, price: 78500 }], { pay: true, invoiceNo: 'ISP/09/4471' }));
  await c.step('beli cat', () => purchase(c, sup.get('SUP-CAT')!, 30, [{ productId: id('BB-CAT-TEMBOK'), qty: 40, price: 612000 }, { productId: id('BB-CAT-KAYU'), qty: 120, price: 49800 }], { pay: true, invoiceNo: 'WNC-2209' }));
  await c.step('beli besi (belum lunas)', () => purchase(c, sup.get('SUP-BESI')!, 9, [{ productId: id('BB-BESI'), qty: 300, price: 86500 }, { productId: id('BB-PAKU'), qty: 200, price: 17800 }], { invoiceNo: 'BUM/1010/032' }));
  await expense(c, 58, 'bank', '6-3000', 'Sewa gudang Cakung', 18_000_000, 'SEWA-GDG');
  await expense(c, 35, 'kas', '6-2000', 'BBM & tol truk pengiriman', 2_150_000, 'SPBU-0412');
  await expense(c, 18, 'bank', '6-4000', 'Listrik & air gudang', 3_400_000);
  await expense(c, 7, 'kas', '6-2000', 'BBM & tol truk pengiriman', 1_870_000, 'SPBU-0718');
  await payroll(c, [
    { code: 'D-001', name: 'Hendra Wijaya', title: 'Kepala Gudang', dept: 'Gudang', salary: 6_200_000, allowance: 800_000, ptkp: 'K/1' },
    { code: 'D-002', name: 'Maya Anggraini', title: 'Admin Penjualan', dept: 'Penjualan', salary: 5_100_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'D-003', name: 'Joko Susilo', title: 'Sopir', dept: 'Gudang', salary: 4_400_000, allowance: 300_000, ptkp: 'K/2' },
  ]);
  // penjualan tambahan sepanjang 3 bulan terakhir (sebagian besar sudah dibayar)
  const bulkPairs: [string, string[]][] = [
    ['TB-MAJU', ['BB-SEMEN', 'BB-PAKU', 'BB-CAT-KAYU']],
    ['TB-SUMBER', ['BB-PIPA', 'BB-MORTAR', 'BB-GENTENG']],
    ['PRM-HARAPAN', ['BB-GENTENG', 'BB-BESI', 'BB-PAKU']],
    ['KTR-BINTANG', ['BB-BESI', 'BB-SEMEN', 'BB-KERAMIK']],
  ];
  for (let i = 0; i < 12; i++) {
    const [custCode, skus] = bulkPairs[i % bulkPairs.length];
    const ago = 108 - i * 7 + c.int(0, 3);
    const inv = await c.step(`jual tambahan ${i + 1}`, () => sell(c, cu.get(custCode)!, ago, skus.slice(0, c.int(1, 3)).map((k) => ({ productId: id(k), qty: c.int(3, 12) }))));
    if (inv) await c.step('terima bayar tambahan', () => receive(c, inv, Math.max(ago - c.int(6, 14), 2), 'TRANSFER'));
  }
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa gudang Cakung', amount: 18_000_000, from: 'bank', day: 2 },
    { code: '6-2000', desc: 'BBM & tol truk pengiriman', amount: 2_000_000, from: 'kas', day: 9 },
    { code: '6-4000', desc: 'Listrik & air gudang', amount: 3_400_000, from: 'bank', day: 15 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-BESI', [
    { cat: 'Kendaraan', name: 'Truk engkel pengiriman', cost: 215_000_000, ago: 105, location: 'Gudang Cakung' },
    { cat: 'Inventaris', name: 'Komputer & printer faktur', cost: 12_500_000, ago: 80, location: 'Kantor' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 18_000_000 }, { code: '6-2000', monthly: 2_500_000 }, { code: '6-4000', monthly: 3_500_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('TB-MAJU')!, id('BB-SEMEN'), [
    { title: 'Proyek perumahan Cluster Aurora — pasok semen & besi', company: 'PT Graha Properti Mandiri', contact: 'Pak Hendro', value: 180_000_000, source: 'Referensi' },
    { title: 'Toko Bangunan Baru Makmur — kontrak bulanan', company: 'TB Baru Makmur', contact: 'Bu Lilis', value: 45_000_000, source: 'Kunjungan sales' },
    { title: 'Renovasi ruko Kelapa Gading', company: 'CV Karya Konstruksi', contact: 'Pak Anton', value: 70_000_000, source: 'Pameran' },
    { title: 'Pemda — pengadaan paving', company: 'Dinas PU', contact: 'Bu Ratna', value: 120_000_000, source: 'Tender' },
  ]);
  await X.deposit(c, cu.get('PROP-GRAHA')!, 33_300_000, 'Uang muka pengadaan keramik tahap 2');
  await X.stockOps(c, ids, DAGANG.map((p) => p.sku), { saleInvoiceId: unpaidInv, billId: c.last.bill, supplierId: sup.get('SUP-CAT') });
}

// ---------------------------------------------------------------- JASA
async function seedJasa(c: Demo) {
  await openingBalance(c, { kas: 6_000_000, bank: 210_000_000, stockValue: 0 });
  const sup = await addSuppliers(c, [{ code: 'SUP-CLOUD', name: 'PT Awan Digital Nusantara', term: 14 }]);
  void sup;
  const cu = await addCustomers(c, [
    { code: 'CL-BANK', name: 'PT Bank Mitra Sejahtera', address: 'Jl. Sudirman Kav. 52, Jakarta', term: 30 },
    { code: 'CL-RETAIL', name: 'PT Ritel Nusantara Prima', address: 'Jl. TB Simatupang, Jakarta', term: 30 },
    { code: 'CL-RS', name: 'Rumah Sakit Sehat Bersama', address: 'Jl. Fatmawati, Jakarta', term: 45 },
    { code: 'CL-START', name: 'Startup Logistik Kita', address: 'Bandung', term: 14 },
    { code: 'CL-EDU', name: 'Yayasan Pendidikan Cerdas', address: 'Depok', term: 30 },
  ]);
  const proj = async (code: string, name: string, cust: string, value: number, start: number) =>
    c.step(`proyek ${name}`, () => c.svc.billing.createProject(c.admin as never, { code, name, customerId: cu.get(cust)!, contractValue: String(value), startDate: c.ago(start), endDate: c.ago(-60) } as never)) as Promise<{ id: string } | undefined>;
  const p1 = await proj('PRJ-APP', 'Pengembangan Aplikasi Mobile Banking Nasabah', 'CL-BANK', 240_000_000, 58);
  const p2 = await proj('PRJ-ERP', 'Implementasi Sistem Gudang Terpadu', 'CL-RETAIL', 150_000_000, 42);
  const inv = async (cust: string, ago: number, desc: string, label: string, lines: { description: string; qty?: string; unit?: string; price: string }[], projectId?: string) =>
    c.step(`faktur ${desc}`, () => c.svc.billing.createInvoice(c.admin as never, { customerId: cu.get(cust)!, date: c.ago(ago), description: desc, termLabel: label, projectId, lines } as never)) as Promise<{ id: string } | undefined>;
  const i1 = await inv('CL-BANK', 50, 'Termin 1 — desain & prototipe', 'Termin 1 (30%)', [{ description: 'Desain UX & prototipe aplikasi', price: '72000000' }], p1?.id);
  const i2 = await inv('CL-RETAIL', 34, 'Termin 1 — analisis kebutuhan', 'Termin 1 (30%)', [{ description: 'Analisis proses gudang & konfigurasi awal', price: '45000000' }], p2?.id);
  const i3 = await inv('CL-RS', 40, 'Konsultasi keamanan informasi (audit ISO 27001)', 'Paket', [{ description: 'Audit kesiapan ISO 27001', qty: '1', unit: 'Paket', price: '38000000' }, { description: 'Pelatihan staf (2 hari)', qty: '2', unit: 'Hari', price: '6500000' }]);
  const i4 = await inv('CL-START', 21, 'Desain identitas visual & situs web', 'Paket', [{ description: 'Desain identitas visual', price: '14500000' }, { description: 'Pembuatan situs web perusahaan', price: '21000000' }]);
  const i5 = await inv('CL-EDU', 12, 'Dukungan bulanan sistem akademik', 'Bulanan', [{ description: 'Dukungan & pemeliharaan sistem akademik (bulan lalu)', qty: '1', unit: 'Bulan', price: '9500000' }]);
  if (i1) await c.step('bayar termin 1', () => receive(c, i1.id, 18));
  if (i3) await c.step('bayar audit', () => receive(c, i3.id, 4));
  if (i4) await c.step('bayar desain (sebagian)', () => receive(c, i4.id, 9, 'TRANSFER', 0.5));
  void i2;
  void i5;
  if (p1) await c.step('progres', () => c.svc.billing.recordProgress(c.admin as never, p1.id, { date: c.ago(5), percent: '55', notes: 'BA kemajuan 03 — modul transfer & mutasi selesai' } as never));
  if (p2) await c.step('progres', () => c.svc.billing.recordProgress(c.admin as never, p2.id, { date: c.ago(5), percent: '35', notes: 'BA kemajuan 01 — konfigurasi gudang pusat' } as never));
  await expense(c, 56, 'bank', '6-3000', 'Sewa kantor Lt. 5', 21_000_000, 'SEWA-KTR');
  await expense(c, 30, 'bank', '6-4000', 'Internet & listrik kantor', 4_800_000);
  await expense(c, 20, 'bank', '6-6000', 'Langganan perangkat lunak desain & cloud', 5_250_000, 'INV-CLOUD');
  await expense(c, 8, 'kas', '6-6000', 'Perlengkapan & konsumsi rapat klien', 780_000, 'NOTA-0805');
  await payroll(c, [
    { code: 'J-001', name: 'Arief Nugraha', title: 'Konsultan Senior', dept: 'Konsultasi', salary: 14_000_000, allowance: 1_500_000, ptkp: 'K/2' },
    { code: 'J-002', name: 'Sinta Dewanti', title: 'Desainer UX', dept: 'Desain', salary: 9_500_000, allowance: 800_000, ptkp: 'TK/0' },
    { code: 'J-003', name: 'Bagus Prakoso', title: 'Pengembang', dept: 'Teknologi', salary: 11_000_000, allowance: 1_000_000, ptkp: 'K/1' },
    { code: 'J-004', name: 'Lia Permata', title: 'Manajer Proyek', dept: 'Konsultasi', salary: 12_500_000, allowance: 1_200_000, ptkp: 'K/1' },
  ]);
  const jasaItems: [string, string, number][] = [
    ['CL-RETAIL', 'Dukungan & pemeliharaan sistem gudang', 8_500_000],
    ['CL-EDU', 'Dukungan bulanan sistem akademik', 9_500_000],
    ['CL-START', 'Konsultasi pengembangan produk digital', 12_000_000],
    ['CL-RS', 'Pelatihan keamanan informasi staf', 15_000_000],
    ['CL-BANK', 'Review kode & uji penetrasi aplikasi', 28_000_000],
    ['CL-EDU', 'Dukungan bulanan sistem akademik', 9_500_000],
    ['CL-RETAIL', 'Dukungan & pemeliharaan sistem gudang', 8_500_000],
    ['CL-START', 'Desain ulang antarmuka aplikasi', 18_000_000],
  ];
  for (const [i, [cust, desc, price]] of jasaItems.entries()) {
    const ago = 105 - i * 12 + c.int(0, 4);
    const inv2 = await inv(cust, ago, desc, 'Paket', [{ description: desc, price: String(price) }]);
    if (inv2 && i < jasaItems.length - 2) await c.step('terima bayar jasa', () => receive(c, inv2.id, Math.max(ago - c.int(10, 25), 2)));
  }
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kantor Lt. 5', amount: 21_000_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Internet & listrik kantor', amount: 4_800_000, from: 'bank', day: 10 },
    { code: '6-6000', desc: 'Langganan perangkat lunak desain & cloud', amount: 5_250_000, from: 'bank', day: 16 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-CLOUD', [
    { cat: 'Inventaris', name: 'Laptop kerja tim (4 unit)', cost: 56_000_000, ago: 100, location: 'Kantor' },
    { cat: 'Inventaris', name: 'Server & perangkat jaringan', cost: 32_000_000, ago: 85, location: 'Ruang server' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 21_000_000 }, { code: '6-4000', monthly: 5_000_000 }, { code: '6-1000', monthly: 40_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('CL-BANK')!, '', [
    { title: 'Aplikasi mobile — perluasan fitur investasi', company: 'PT Bank Mitra Sejahtera', contact: 'Ibu Dewi', value: 320_000_000, source: 'Klien lama' },
    { title: 'Audit keamanan sistem rumah sakit', company: 'RS Sehat Bersama', contact: 'Pak Budi', value: 95_000_000, source: 'Referensi' },
    { title: 'Portal e-learning sekolah', company: 'Yayasan Pendidikan Cerdas', contact: 'Bu Sari', value: 140_000_000, source: 'Webinar' },
    { title: 'Dashboard analitik penjualan', company: 'PT Ritel Nusantara Prima', contact: 'Pak Rian', value: 85_000_000, source: 'Kunjungan' },
  ]);
  const dep = await c.step('uang muka pelanggan', () => c.svc.billing.createDeposit(c.admin as never, { customerId: cu.get('CL-EDU')!, date: c.ago(15), amount: '27750000', method: 'TRANSFER', cashAccountId: c.bank, notes: 'Uang muka portal e-learning' } as never));
  void dep;
}

// ---------------------------------------------------------------- MANUFAKTUR (bantuan produksi)
type Bom = { sku: string; name: string; price: number; bomName: string; out: number; labor: number; overhead: number; use: [string, number][] };

async function manufacture(
  c: Demo,
  raw: Prod[],
  finished: { sku: string; name: string; price: number }[],
  boms: Bom[],
  runs: { bom: number; ago: number; batches: number; yieldPct: number }[],
) {
  const { ids, value } = await stockItems(c, raw);
  await openingBalance(c, { kas: 10_000_000, bank: 300_000_000, stockValue: value });
  for (const f of finished) {
    const r = await c.svc.products.create(c.tenantId, { sku: f.sku, name: f.name, baseUom: 'PCS', sellPrice: String(f.price), category: 'Barang jadi' } as never);
    ids.set(f.sku, r.id);
  }
  const bomIds: string[] = [];
  for (const b of boms) {
    const r = (await c.step(`resep ${b.name}`, () =>
      c.svc.production.createBom(c.admin as never, {
        name: b.bomName,
        productId: ids.get(b.sku)!,
        outputQty: String(b.out),
        laborCost: String(b.labor),
        overheadCost: String(b.overhead),
        lines: b.use.map(([sku, qty]) => ({ productId: ids.get(sku)!, qty: String(qty) })),
      } as never),
    )) as { id: string } | undefined;
    bomIds.push(r?.id ?? '');
  }
  for (const run of runs) {
    const bomId = bomIds[run.bom];
    if (!bomId) continue;
    const bom = boms[run.bom];
    const o = (await c.step('perintah produksi', () => c.svc.production.createOrder(c.admin as never, { bomId, warehouseId: c.wh, batches: String(run.batches), date: c.ago(run.ago) } as never))) as { id: string } | undefined;
    if (!o) continue;
    await c.step('mulai produksi', () => c.svc.production.start(c.admin as never, o.id, { date: c.ago(run.ago) } as never));
    const good = Math.floor(bom.out * run.batches * run.yieldPct);
    await c.step('selesai produksi', () => c.svc.production.complete(c.admin as never, o.id, { date: c.ago(run.ago - 2), outputQty: String(good) } as never));
  }
  return { ids };
}

// ---------------------------------------------------------------- FMCG
const FMCG: Prod[] = [
  { sku: 'FM-MIE', name: 'Mi Instan Goreng (dus 40)', cat: 'Makanan', price: 118000, cost: 98000, qty: 400, uom: 'DUS' },
  { sku: 'FM-BISK', name: 'Biskuit Kelapa 200g (dus 24)', cat: 'Makanan', price: 168000, cost: 138000, qty: 220, uom: 'DUS' },
  { sku: 'FM-AIR', name: 'Air Mineral 600ml (dus 24)', cat: 'Minuman', price: 52000, cost: 41000, qty: 500, uom: 'DUS' },
  { sku: 'FM-TEH', name: 'Teh Kotak 300ml (dus 24)', cat: 'Minuman', price: 96000, cost: 78000, qty: 260, uom: 'DUS' },
  { sku: 'FM-KOPI', name: 'Kopi Sachet (renceng 10)', cat: 'Minuman', price: 19000, cost: 15000, qty: 900, uom: 'RCG' },
  { sku: 'FM-SABUN', name: 'Sabun Mandi Batang (dus 72)', cat: 'Perawatan', price: 245000, cost: 205000, qty: 120, uom: 'DUS' },
  { sku: 'FM-SHAMP', name: 'Sampo Sachet (renceng 12)', cat: 'Perawatan', price: 16000, cost: 12500, qty: 700, uom: 'RCG' },
  { sku: 'FM-DETER', name: 'Deterjen 800g (dus 12)', cat: 'Rumah Tangga', price: 232000, cost: 192000, qty: 90, uom: 'DUS' },
];
async function seedFmcg(c: Demo) {
  const { ids, value } = await stockItems(c, FMCG);
  await openingBalance(c, { kas: 12_000_000, bank: 520_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'PRI-PANGAN', name: 'PT Pangan Nusantara Makmur', term: 30 },
    { code: 'PRI-MINUM', name: 'PT Minuman Segar Indonesia', term: 21 },
    { code: 'PRI-HOME', name: 'PT Perawatan Rumah Sejahtera', term: 30 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'OTL-ALFA', name: 'Minimarket Berkah Jaya (jaringan)', address: 'Jl. Raya Bekasi Km 20', term: 30, limit: '250000000' },
    { code: 'OTL-GROSIR', name: 'Grosir Sumber Rezeki', address: 'Pasar Induk Kramat Jati', term: 14, limit: '120000000' },
    { code: 'OTL-WARUNG1', name: 'Warung Bu Sari', address: 'Jl. Melati No. 3, Depok', term: 7, limit: '15000000' },
    { code: 'OTL-WARUNG2', name: 'Toko Kelontong Pak Haji', address: 'Jl. Kenanga No. 11, Bogor', term: 7, limit: '20000000' },
    { code: 'OTL-KOP', name: 'Koperasi Karyawan Pabrik Timur', address: 'Kawasan Industri Cikarang', term: 21 },
    { code: 'OTL-SUPER', name: 'Supermarket Maju Bersama', address: 'Jl. Margonda Raya, Depok', term: 45, limit: '300000000' },
  ]);
  const id = (k: string) => ids.get(k)!;
  // daftar harga per segmen + promo (potongan bertingkat, bonus barang); penjualan di bawah otomatis memakainya
  const mk = (name: string, description: string, pct: number, bulkPct: number, bulkQty: number) =>
    c.step(`daftar harga ${name}`, async () => {
      const list = await c.svc.pricing.createPriceList(c.admin as never, { name, description });
      await c.svc.pricing.replaceItems(
        c.admin as never,
        list.id,
        FMCG.flatMap((p) => [
          { productId: ids.get(p.sku)!, minQty: '1', price: String(Math.round(p.price * pct)) },
          { productId: ids.get(p.sku)!, minQty: String(bulkQty), price: String(Math.round(p.price * bulkPct)) },
        ]),
      );
      return list.id as string;
    });
  const grosir = await mk('Grosir', 'Pedagang grosir & pasar induk', 0.96, 0.93, 50);
  const minimarket = await mk('Minimarket', 'Minimarket & supermarket jaringan', 0.98, 0.96, 100);
  await c.step('pasang daftar harga', async () => {
    for (const [code, list] of [['OTL-GROSIR', grosir], ['OTL-ALFA', minimarket], ['OTL-SUPER', minimarket]] as const)
      if (list) await c.svc.customers.update(c.tenantId, cu.get(code)!, { priceListId: list } as never);
  });
  // syarat dagang peritel modern (diakru tiap akhir bulan lewat Modern trade)
  await c.step('syarat dagang', async () => {
    const rows = [
      { customerId: cu.get('OTL-ALFA')!, name: 'Rebate pencapaian 1,5%', kind: 'PCT_SALES' as const, value: '1.5' },
      { customerId: cu.get('OTL-ALFA')!, name: 'Listing fee bulanan', kind: 'FIXED_MONTHLY' as const, value: '1500000' },
      { customerId: cu.get('OTL-SUPER')!, name: 'Rebate pencapaian 2%', kind: 'PCT_SALES' as const, value: '2' },
    ];
    for (const r of rows) await c.db.insert(tradeTerms).values({ tenantId: c.tenantId, ...r });
  });
  await c.step('promo potongan', () => c.svc.pricing.createPromo(c.admin as never, { name: 'Diskon 3% mi instan min 60 dus', kind: 'DISCOUNT', productId: id('FM-MIE'), minQty: '60', discountPct: '3' }));
  await c.step('promo bonus', () => c.svc.pricing.createPromo(c.admin as never, { name: 'Beli 20 dus air mineral gratis 2 renceng kopi', kind: 'BONUS', productId: id('FM-AIR'), minQty: '20', bonusProductId: id('FM-KOPI'), bonusQty: '2' }));
  // pembelian ke prinsipal dengan nomor lot & tanggal kedaluwarsa (dasar penelusuran bila ada penarikan produk)
  await c.step('beli makanan', () =>
    purchaseWithLots(c, sup.get('PRI-PANGAN')!, 45, [
      { productId: id('FM-MIE'), qty: 300, price: 98500, lotNo: 'MIE-2409A', expiresInDays: 160 },
      { productId: id('FM-BISK'), qty: 150, price: 138500, lotNo: 'BSK-2409A', expiresInDays: 25 },
    ], { pay: true, invoiceNo: 'PNM/09/2208' }),
  );
  await c.step('beli minuman', () =>
    purchaseWithLots(c, sup.get('PRI-MINUM')!, 30, [
      { productId: id('FM-AIR'), qty: 400, price: 41200, lotNo: 'AIR-2410B', expiresInDays: 300 },
      { productId: id('FM-TEH'), qty: 180, price: 78300, lotNo: 'TEH-2410B', expiresInDays: 12 },
    ], { pay: true, invoiceNo: 'MSI-1771' }),
  );
  await c.step('beli perawatan (belum lunas)', () =>
    purchaseWithLots(c, sup.get('PRI-HOME')!, 9, [
      { productId: id('FM-SABUN'), qty: 100, price: 205500, lotNo: 'SBN-2411C', expiresInDays: 700 },
      { productId: id('FM-DETER'), qty: 70, price: 192500, lotNo: 'DTR-2411C', expiresInDays: 600 },
    ], { invoiceNo: 'PRS/11/0452' }),
  );
  const sales: { cu: string; ago: number; lines: { productId: string; qty: number }[]; pay: number }[] = [
    { cu: 'OTL-ALFA', ago: 58, lines: [{ productId: id('FM-MIE'), qty: 80 }, { productId: id('FM-AIR'), qty: 120 }, { productId: id('FM-KOPI'), qty: 200 }], pay: 24 },
    { cu: 'OTL-GROSIR', ago: 52, lines: [{ productId: id('FM-BISK'), qty: 50 }, { productId: id('FM-TEH'), qty: 70 }], pay: 30 },
    { cu: 'OTL-WARUNG1', ago: 47, lines: [{ productId: id('FM-MIE'), qty: 6 }, { productId: id('FM-SABUN'), qty: 2 }], pay: 40 },
    { cu: 'OTL-SUPER', ago: 40, lines: [{ productId: id('FM-DETER'), qty: 25 }, { productId: id('FM-SHAMP'), qty: 150 }, { productId: id('FM-SABUN'), qty: 20 }], pay: 0 }, // belum dibayar: jatuh tempo
    { cu: 'OTL-WARUNG2', ago: 33, lines: [{ productId: id('FM-AIR'), qty: 8 }, { productId: id('FM-KOPI'), qty: 20 }], pay: 25 },
    { cu: 'OTL-KOP', ago: 26, lines: [{ productId: id('FM-MIE'), qty: 30 }, { productId: id('FM-TEH'), qty: 18 }], pay: 5 },
    { cu: 'OTL-ALFA', ago: 19, lines: [{ productId: id('FM-BISK'), qty: 40 }, { productId: id('FM-DETER'), qty: 15 }], pay: -1 },
    { cu: 'OTL-GROSIR', ago: 10, lines: [{ productId: id('FM-MIE'), qty: 90 }, { productId: id('FM-SHAMP'), qty: 100 }], pay: -1 },
    { cu: 'OTL-WARUNG1', ago: 4, lines: [{ productId: id('FM-KOPI'), qty: 12 }, { productId: id('FM-TEH'), qty: 4 }], pay: -1 },
  ];
  let unpaidInv: string | undefined;
  for (const s of sales) {
    const inv = await c.step(`jual ${s.cu}`, () => sell(c, cu.get(s.cu)!, s.ago, s.lines));
    if (inv && s.pay > 0) await c.step('terima bayar', () => receive(c, inv, s.pay, 'TRANSFER'));
    else if (inv && s.pay === -1) unpaidInv = inv;
  }
  await expense(c, 58, 'bank', '6-3000', 'Sewa gudang distribusi', 16_000_000, 'SEWA-GDG');
  await expense(c, 35, 'kas', '6-2700', 'BBM & tol armada pengiriman ke outlet', 3_450_000, 'SPBU-0412');
  await expense(c, 24, 'bank', '6-2150', 'Trade promo & listing fee minimarket', 6_000_000, 'TP-0924');
  await expense(c, 18, 'bank', '6-4000', 'Listrik & air gudang', 3_100_000);
  await expense(c, 7, 'kas', '6-2700', 'BBM & tol armada pengiriman ke outlet', 2_980_000, 'SPBU-0718');
  await payroll(c, [
    { code: 'F-001', name: 'Hendra Wijaya', title: 'Kepala Gudang', dept: 'Gudang', salary: 6_200_000, allowance: 800_000, ptkp: 'K/1' },
    { code: 'F-002', name: 'Rina Marlina', title: 'Supervisor Sales', dept: 'Penjualan', salary: 6_800_000, allowance: 700_000, ptkp: 'K/1' },
    { code: 'F-003', name: 'Andi Pratama', title: 'Sales Lapangan (Kanvas)', dept: 'Penjualan', salary: 4_300_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'F-004', name: 'Joko Susilo', title: 'Sopir Pengiriman', dept: 'Gudang', salary: 4_400_000, allowance: 300_000, ptkp: 'K/2' },
  ]);
  const bulkPairs: [string, string[]][] = [
    ['OTL-ALFA', ['FM-MIE', 'FM-AIR', 'FM-KOPI']],
    ['OTL-GROSIR', ['FM-BISK', 'FM-TEH', 'FM-SHAMP']],
    ['OTL-WARUNG1', ['FM-KOPI', 'FM-SHAMP', 'FM-MIE']],
    ['OTL-SUPER', ['FM-DETER', 'FM-SABUN', 'FM-AIR']],
  ];
  for (let i = 0; i < 12; i++) {
    const [custCode, skus] = bulkPairs[i % bulkPairs.length];
    const ago = 108 - i * 7 + c.int(0, 3);
    const inv = await c.step(`jual tambahan ${i + 1}`, () => sell(c, cu.get(custCode)!, ago, skus.slice(0, c.int(1, 3)).map((k) => ({ productId: id(k), qty: c.int(3, 20) }))));
    if (inv) await c.step('terima bayar tambahan', () => receive(c, inv, Math.max(ago - c.int(5, 14), 2), 'TRANSFER'));
  }
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa gudang distribusi', amount: 16_000_000, from: 'bank', day: 2 },
    { code: '6-2700', desc: 'BBM & tol armada pengiriman ke outlet', amount: 3_200_000, from: 'kas', day: 9 },
    { code: '6-4000', desc: 'Listrik & air gudang', amount: 3_100_000, from: 'bank', day: 15 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'PRI-HOME', [
    { cat: 'Kendaraan', name: 'Mobil boks pengiriman (2 unit)', cost: 330_000_000, ago: 105, location: 'Gudang distribusi' },
    { cat: 'Inventaris', name: 'Rak gudang & palet', cost: 24_000_000, ago: 90, location: 'Gudang distribusi' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 16_000_000 }, { code: '6-2700', monthly: 3_500_000 }, { code: '6-2150', monthly: 6_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.deposit(c, cu.get('OTL-SUPER')!, 20_000_000, 'Uang muka pesanan musiman (lebaran)');
  await X.stockOps(c, ids, FMCG.map((p) => p.sku), { saleInvoiceId: unpaidInv, billId: c.last.bill, supplierId: sup.get('PRI-PANGAN') });
}

const FURNITUR_RAW: Prod[] = [
  { sku: 'FN-JATI', name: 'Kayu Jati Olahan (m3)', cat: 'Bahan baku', price: 0, cost: 8_900_000, qty: 24, uom: 'M3' },
  { sku: 'FN-PLY', name: 'Plywood 18mm', cat: 'Bahan baku', price: 0, cost: 395_000, qty: 150, uom: 'LBR' },
  { sku: 'FN-ENGSEL', name: 'Engsel Pintu', cat: 'Bahan penolong', price: 0, cost: 9_500, qty: 1500, uom: 'PCS' },
  { sku: 'FN-REL', name: 'Rel Laci', cat: 'Bahan penolong', price: 0, cost: 32_000, qty: 600, uom: 'SET' },
  { sku: 'FN-POLITUR', name: 'Politur & Vernis', cat: 'Bahan penolong', price: 0, cost: 78_000, qty: 200, uom: 'KLG' },
  { sku: 'FN-AMPLAS', name: 'Amplas & Perekat', cat: 'Bahan penolong', price: 0, cost: 45_000, qty: 120, uom: 'PKT' },
];
async function seedManufaktur(c: Demo) {
  const { ids } = await manufacture(
    c,
    FURNITUR_RAW,
    [
      { sku: 'FN-MEJA', name: 'Meja Makan Jati 6 Kursi', price: 9_800_000 },
      { sku: 'FN-LEMARI', name: 'Lemari Pakaian 3 Pintu', price: 6_400_000 },
      { sku: 'FN-KURSI', name: 'Kursi Kantor Kayu', price: 1_450_000 },
    ],
    [
      { sku: 'FN-MEJA', name: 'Meja', price: 9_800_000, bomName: 'Meja makan jati (batch 4)', out: 4, labor: 3_200_000, overhead: 1_400_000, use: [['FN-JATI', 1.6], ['FN-POLITUR', 8], ['FN-AMPLAS', 4]] },
      { sku: 'FN-LEMARI', name: 'Lemari', price: 6_400_000, bomName: 'Lemari 3 pintu (batch 5)', out: 5, labor: 3_000_000, overhead: 1_250_000, use: [['FN-PLY', 25], ['FN-JATI', 0.8], ['FN-ENGSEL', 30], ['FN-REL', 15], ['FN-POLITUR', 6]] },
      { sku: 'FN-KURSI', name: 'Kursi', price: 1_450_000, bomName: 'Kursi kantor kayu (batch 20)', out: 20, labor: 4_200_000, overhead: 1_600_000, use: [['FN-JATI', 1.2], ['FN-POLITUR', 6], ['FN-AMPLAS', 3]] },
    ],
    [
      { bom: 0, ago: 52, batches: 3, yieldPct: 1 },
      { bom: 1, ago: 44, batches: 2, yieldPct: 1 },
      { bom: 2, ago: 33, batches: 1, yieldPct: 0.95 },
      { bom: 0, ago: 22, batches: 2, yieldPct: 1 },
      { bom: 1, ago: 12, batches: 2, yieldPct: 0.9 },
    ],
  );
  const sup = await addSuppliers(c, [
    { code: 'SUP-KAYU', name: 'UD Kayu Jati Pratama', term: 14 },
    { code: 'SUP-HARDWARE', name: 'PT Hardware Furnitur Indonesia', term: 30 },
  ]);
  await c.step('beli kayu', () => purchase(c, sup.get('SUP-KAYU')!, 47, [{ productId: ids.get('FN-JATI')!, qty: 12, price: 9_050_000 }], { pay: true, invoiceNo: 'KJP/2209/088' }));
  await c.step('beli hardware (belum lunas)', () => purchase(c, sup.get('SUP-HARDWARE')!, 9, [{ productId: ids.get('FN-ENGSEL')!, qty: 600, price: 9_700 }, { productId: ids.get('FN-REL')!, qty: 200, price: 32_500 }], { invoiceNo: 'HFI-3321' }));
  const cu = await addCustomers(c, [
    { code: 'HTL-BINTANG', name: 'PT Hotel Bintang Samudra', address: 'Jl. Pantai Kuta, Bali', term: 45, limit: '400000000' },
    { code: 'KANTOR-MJU', name: 'PT Maju Bersama Kantor', address: 'Jakarta Selatan', term: 30 },
    { code: 'FNT-SHOWROOM', name: 'Galeri Furnitur Nusantara', address: 'Jl. Raya Solo', term: 30 },
    { code: 'APT-ASRI', name: 'PT Apartemen Asri Lestari', address: 'Tangerang Selatan', term: 60 },
  ]);
  const s1 = await c.step('jual 1', () => sell(c, cu.get('HTL-BINTANG')!, 27, [{ productId: ids.get('FN-MEJA')!, qty: 6 }, { productId: ids.get('FN-LEMARI')!, qty: 4 }]));
  const s2 = await c.step('jual 2', () => sell(c, cu.get('KANTOR-MJU')!, 16, [{ productId: ids.get('FN-KURSI')!, qty: 18 }]));
  const s3 = await c.step('jual 3', () => sell(c, cu.get('FNT-SHOWROOM')!, 7, [{ productId: ids.get('FN-MEJA')!, qty: 2 }, { productId: ids.get('FN-LEMARI')!, qty: 2 }]));
  if (s1) await c.step('bayar 1', () => receive(c, s1, 6, 'TRANSFER', 0.5));
  if (s2) await c.step('bayar 2', () => receive(c, s2, 2));
  await expense(c, 54, 'bank', '6-3000', 'Sewa lahan workshop', 12_000_000, 'SEWA-WKS');
  await expense(c, 30, 'bank', '5-4500', 'Listrik mesin & oven pengering', 6_800_000);
  await expense(c, 16, 'kas', '5-4400', 'Pemeliharaan mesin gergaji & ketam', 1_850_000, 'NOTA-0916');
  await expense(c, 9, 'bank', '6-2000', 'Pengiriman furnitur ke pelanggan', 3_600_000, 'EKSP-5521');
  await payroll(c, [
    { code: 'M-001', name: 'Slamet Riyadi', title: 'Tukang Kayu Senior', dept: 'Produksi', salary: 5_200_000, allowance: 400_000, ptkp: 'K/2', production: true },
    { code: 'M-002', name: 'Paiman Hadi', title: 'Tukang Finishing', dept: 'Produksi', salary: 4_600_000, allowance: 300_000, ptkp: 'K/1', production: true },
    { code: 'M-003', name: 'Sugeng Widodo', title: 'Operator Mesin', dept: 'Produksi', salary: 4_700_000, allowance: 300_000, ptkp: 'K/1', production: true },
    { code: 'M-004', name: 'Retno Wulandari', title: 'Admin Pabrik', dept: 'Kantor', salary: 5_000_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'M-005', name: 'Hari Santoso', title: 'Kepala Produksi', dept: 'Produksi', salary: 8_200_000, allowance: 900_000, ptkp: 'K/3', production: true },
  ]);
  for (let i = 0; i < 5; i++) {
    const ago = 98 - i * 15 + c.int(0, 4);
    const [custCode, sku] = [['KANTOR-MJU', 'FN-MEJA'], ['FNT-SHOWROOM', 'FN-MEJA'], ['HTL-BINTANG', 'FN-LEMARI'], ['KANTOR-MJU', 'FN-LEMARI'], ['FNT-SHOWROOM', 'FN-LEMARI']][i];
    const inv = await c.step(`jual tambahan ${i + 1}`, () => sell(c, cu.get(custCode)!, ago, [{ productId: ids.get(sku)!, qty: c.int(1, 3) }]));
    if (inv) await c.step('terima bayar tambahan', () => receive(c, inv, Math.max(ago - c.int(8, 20), 2)));
  }
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa lahan workshop', amount: 12_000_000, from: 'bank', day: 2 },
    { code: '5-4500', desc: 'Listrik mesin & oven pengering', amount: 6_800_000, from: 'bank', day: 12 },
    { code: '5-4400', desc: 'Pemeliharaan mesin gergaji & ketam', amount: 1_850_000, from: 'kas', day: 19 },
    { code: '6-2000', desc: 'Pengiriman furnitur ke pelanggan', amount: 3_600_000, from: 'bank', day: 24 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-HARDWARE', [
    { cat: 'Mesin', name: 'Mesin gergaji & ketam kayu', cost: 185_000_000, ago: 110, location: 'Workshop' },
    { cat: 'Kendaraan', name: 'Truk box pengiriman furnitur', cost: 240_000_000, ago: 95, location: 'Workshop' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 12_000_000 }, { code: '5-4500', monthly: 7_000_000 }, { code: '6-2000', monthly: 4_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('HTL-BINTANG')!, ids.get('FN-KURSI')!, [
    { title: 'Furnitur 120 kamar hotel baru', company: 'PT Hotel Bintang Samudra', contact: 'Pak Wayan', value: 480_000_000, source: 'Referensi' },
    { title: 'Pengadaan kursi kantor 200 unit', company: 'PT Maju Bersama Kantor', contact: 'Bu Tika', value: 290_000_000, source: 'Pameran' },
    { title: 'Showroom kedua — lemari & meja', company: 'Galeri Furnitur Nusantara', contact: 'Pak Joko', value: 150_000_000, source: 'Kunjungan' },
    { title: 'Apartemen tahap 3 — kitchen set', company: 'PT Apartemen Asri Lestari', contact: 'Bu Maya', value: 360_000_000, source: 'Tender' },
  ]);
  await X.deposit(c, cu.get('APT-ASRI')!, 90_000_000, 'Uang muka kitchen set tahap 3');
  await X.stockOps(c, ids, ['FN-JATI', 'FN-PLY', 'FN-ENGSEL', 'FN-REL', 'FN-POLITUR'], { saleInvoiceId: s3, billId: c.last.bill, supplierId: sup.get('SUP-KAYU') });
}

/** Pembelian bahan dengan lot dan tanggal kedaluwarsa: PO → penerimaan barang (bawa lot) → faktur dari penerimaan → (opsional) dibayar */
async function purchaseWithLots(
  c: Demo,
  supplierId: string,
  daysAgo: number,
  lines: { productId: string; qty: number; price: number; lotNo: string; expiresInDays: number }[],
  opts: { pay?: boolean; invoiceNo: string },
) {
  const po = await c.svc.po.create(c.admin as never, {
    supplierId,
    warehouseId: c.wh,
    date: c.ago(daysAgo),
    lines: lines.map((l) => ({ productId: l.productId, qty: String(l.qty), price: String(l.price) })),
  } as never);
  await c.svc.po.confirm(c.admin as never, po.id);
  // tanggal kedaluwarsa dihitung dari hari ini (bukan dari tanggal terima), supaya contoh "akan kedaluwarsa" selalu relevan
  await c.svc.grn.receive(c.admin as never, po.id, {
    date: c.ago(daysAgo),
    lines: po.lines.map((pl: { id: string }, i: number) => ({ orderLineId: pl.id, qty: String(lines[i].qty), lotNo: lines[i].lotNo, expiryDate: c.ago(-lines[i].expiresInDays) })),
  });
  const bill = await c.svc.pi.createFromOrder(c.admin as never, { purchaseOrderId: po.id, supplierInvoiceNo: opts.invoiceNo, date: c.ago(daysAgo - 1) } as never);
  if (opts.pay) await payBill(c, bill.id, Math.max(daysAgo - 8, 1));
  c.last.bill = bill.id;
  return bill;
}

// ---------------------------------------------------------------- F&B
const FNB_BAHAN: Prod[] = [
  { sku: 'BB-KOPI', name: 'Biji Kopi Arabika', cat: 'Bahan minuman', price: 0, cost: 140, qty: 60000, uom: 'GR' },
  { sku: 'BB-SUSU', name: 'Susu Cair Segar', cat: 'Bahan minuman', price: 0, cost: 18, qty: 250000, uom: 'ML' },
  { sku: 'BB-GULA', name: 'Gula Pasir', cat: 'Bahan umum', price: 0, cost: 16, qty: 80000, uom: 'GR' },
  { sku: 'BB-MINYAK', name: 'Minyak Goreng', cat: 'Bahan umum', price: 0, cost: 17, qty: 60000, uom: 'ML' },
  { sku: 'BB-BERAS', name: 'Beras Pulen', cat: 'Bahan makanan', price: 0, cost: 14, qty: 100000, uom: 'GR' },
  { sku: 'BB-MIE', name: 'Mi Telur Basah', cat: 'Bahan makanan', price: 0, cost: 20, qty: 40000, uom: 'GR' },
  { sku: 'BB-AYAM', name: 'Daging Ayam Fillet', cat: 'Bahan makanan', price: 0, cost: 38, qty: 60000, uom: 'GR' },
  { sku: 'BB-TELUR', name: 'Telur Ayam', cat: 'Bahan makanan', price: 0, cost: 2200, qty: 3000, uom: 'BTR' },
  { sku: 'BB-TEPUNG', name: 'Tepung Terigu Protein Sedang', cat: 'Bahan roti', price: 0, cost: 13, qty: 50000, uom: 'GR' },
  { sku: 'BB-MENTEGA', name: 'Mentega', cat: 'Bahan roti', price: 0, cost: 45, qty: 15000, uom: 'GR' },
  { sku: 'BB-COKLAT', name: 'Bubuk Cokelat', cat: 'Bahan minuman', price: 0, cost: 120, qty: 20000, uom: 'GR' },
  { sku: 'BB-TEH', name: 'Teh Celup', cat: 'Bahan minuman', price: 0, cost: 400, qty: 4000, uom: 'PCS' },
  { sku: 'KM-CUP', name: 'Cup & Tutup 16oz', cat: 'Kemasan', price: 0, cost: 650, qty: 6000, uom: 'PCS' },
  { sku: 'KM-KOTAK', name: 'Kotak Makan Kertas', cat: 'Kemasan', price: 0, cost: 900, qty: 3000, uom: 'PCS' },
  // barang jadi beli putus (dijual apa adanya)
  { sku: 'FB-AIR', name: 'Air Mineral 600ml', cat: 'Barang jadi', price: 6000, cost: 2900, qty: 1500, uom: 'BTL' },
  { sku: 'FB-KUE', name: 'Kue Kering Toples', cat: 'Barang jadi', price: 55000, cost: 36000, qty: 300, uom: 'TPL' },
];
/** Menu: dibuat saat dipesan, bahan terpotong otomatis di kasir sesuai resep */
const FNB_MENU: { sku: string; name: string; price: number; bom: string; use: [string, number][] }[] = [
  { sku: 'MN-KOPSU', name: 'Kopi Susu Gula Aren', price: 24000, bom: 'Resep Kopi Susu', use: [['BB-KOPI', 18], ['BB-SUSU', 150], ['BB-GULA', 15], ['KM-CUP', 1]] },
  { sku: 'MN-AMER', name: 'Americano', price: 20000, bom: 'Resep Americano', use: [['BB-KOPI', 18], ['KM-CUP', 1]] },
  { sku: 'MN-LATTE', name: 'Cafe Latte', price: 28000, bom: 'Resep Cafe Latte', use: [['BB-KOPI', 18], ['BB-SUSU', 200], ['KM-CUP', 1]] },
  { sku: 'MN-ESTEH', name: 'Es Teh Manis', price: 10000, bom: 'Resep Es Teh Manis', use: [['BB-TEH', 2], ['BB-GULA', 20], ['KM-CUP', 1]] },
  { sku: 'MN-COKLAT', name: 'Cokelat Dingin', price: 26000, bom: 'Resep Cokelat Dingin', use: [['BB-COKLAT', 30], ['BB-SUSU', 150], ['BB-GULA', 10], ['KM-CUP', 1]] },
  { sku: 'MN-NASAY', name: 'Nasi Ayam Goreng', price: 28000, bom: 'Resep Nasi Ayam Goreng', use: [['BB-BERAS', 150], ['BB-AYAM', 120], ['BB-MINYAK', 30], ['KM-KOTAK', 1]] },
  { sku: 'MN-MIGOR', name: 'Mi Goreng Spesial', price: 22000, bom: 'Resep Mi Goreng Spesial', use: [['BB-MIE', 120], ['BB-TELUR', 1], ['BB-AYAM', 30], ['BB-MINYAK', 25], ['KM-KOTAK', 1]] },
  { sku: 'MN-DONAT', name: 'Donat Gula Halus', price: 9000, bom: 'Resep Donat', use: [['SF-ADONAN', 1], ['BB-GULA', 10], ['BB-MINYAK', 40]] },
];
/** Meja + pesanan terbuka (sebagian sudah dibayar), pesanan online GoFood/GrabFood dan pencairannya */
async function fnbTablesAndOnline(c: Demo, ids: Map<string, string>) {
  const { withSimulatedDay } = await import('../../common/utils/dates');
  const u = c.admin as never;
  const tables: { id: string }[] = [];
  for (const [code, seats] of [['M01', 2], ['M02', 4], ['M03', 4], ['M04', 6]] as const) {
    tables.push((await c.svc.tabs.createTable(u, { warehouseId: c.wh, code, name: `Meja ${Number(code.slice(1))}`, seats } as never)) as { id: string });
  }
  const line = (sku: string, qty: number, notes?: string) => ({ productId: ids.get(sku)!, qty: String(qty), notes });
  const online: { ago: number; channel: string; ref: string; name: string; items: [string, number][] }[] = [
    { ago: 6, channel: 'GOFOOD', ref: 'GF-240101', name: 'Budi', items: [['MN-KOPSU', 2], ['MN-DONAT', 3]] },
    { ago: 6, channel: 'GRABFOOD', ref: 'GR-77120', name: 'Ayu', items: [['MN-NASAY', 1], ['MN-ESTEH', 1]] },
    { ago: 5, channel: 'GOFOOD', ref: 'GF-240188', name: 'Rina', items: [['MN-LATTE', 2]] },
    { ago: 3, channel: 'GOFOOD', ref: 'GF-240231', name: 'Dewi', items: [['MN-MIGOR', 2], ['MN-AMER', 1]] },
    { ago: 2, channel: 'SHOPEEFOOD', ref: 'SF-55120', name: 'Tono', items: [['MN-NASAY', 2]] },
  ];
  // H-8: pelanggan makan di tempat, tagihan dipisah dua
  await withSimulatedDay(c.ago(8), async () => {
    const s = await c.svc.pos.open(u, { warehouseId: c.wh, openingCash: '300000' } as never);
    const tab = (await c.svc.tabs.create(u, { warehouseId: c.wh, tableId: tables[1].id, orderType: 'DINE_IN', lines: [line('MN-NASAY', 2), line('MN-ESTEH', 2, 'es sedikit'), line('MN-DONAT', 2)] } as never)) as { id: string };
    await c.svc.tabs.send(u, tab.id);
    const d = (await c.svc.tabs.get(u, tab.id)) as unknown as { lines: { id: string; product: { name: string } }[] };
    for (const l of d.lines) for (const st of ['PREPARING', 'READY', 'SERVED'] as const) await c.svc.tabs.setLineStatus(u, l.id, st);
    const first = d.lines.filter((l) => /Nasi|Es Teh/.test(l.product.name)).map((l) => l.id);
    await c.svc.tabs.pay(u, tab.id, { sessionId: s.id, lineIds: first, payments: [{ method: 'CASH', amount: '200000' }] } as never);
    await c.svc.tabs.pay(u, tab.id, { sessionId: s.id, payments: [{ method: 'CASH', amount: '20000' }] } as never);
    const cur = (await c.svc.pos.current(u)) as { summary: { expectedCash: string } } | null;
    await c.svc.pos.close(u, s.id, { countedCash: String(Number(cur?.summary.expectedCash ?? 300000)) } as never);
  });
  const ordered: Record<number, string> = {};
  for (const o of online) {
    await withSimulatedDay(c.ago(o.ago), async () => {
      const s = await c.svc.pos.open(u, { warehouseId: c.wh, openingCash: '300000' } as never);
      const r = (await c.svc.tabs.receiveOnline(u, c.wh, { channel: o.channel as never, externalRef: o.ref, customerName: o.name, items: o.items.map(([sku, q]) => ({ sku, qty: String(q) })) })) as unknown as { tab: { id: string } };
      const id = r.tab.id;
      const d = (await c.svc.tabs.get(u, id)) as unknown as { lines: { id: string }[] };
      for (const l of d.lines) for (const st of ['PREPARING', 'READY', 'SERVED'] as const) await c.svc.tabs.setLineStatus(u, l.id, st);
      await c.svc.tabs.pay(u, id, { sessionId: s.id } as never);
      const cur = (await c.svc.pos.current(u)) as { summary: { expectedCash: string } } | null;
      await c.svc.pos.close(u, s.id, { countedCash: String(Number(cur?.summary.expectedCash ?? 300000)) } as never);
      ordered[o.ago] = id;
    });
  }
  // pencairan GoFood untuk pesanan H-6 dan H-5 (dana masuk pas dengan seharusnya); sisanya belum cair
  const un = (await c.svc.settle.unsettled(c.tenantId, 'GOFOOD' as never)) as { items: { id: string; externalRef: string | null; net: string }[] };
  const mine = un.items.filter((i) => ['GF-240101', 'GF-240188'].includes(i.externalRef ?? ''));
  if (mine.length) {
    await c.svc.settle.create(u, { channel: 'GOFOOD', date: c.ago(2), orderIds: mine.map((i) => i.id), received: mine.reduce((a, i) => a + Number(i.net), 0).toFixed(2) } as never);
  }
  // satu pesanan makan di tempat masih terbuka & sudah dikirim ke dapur (tampil di layar dapur)
  const open = (await c.svc.tabs.create(u, { warehouseId: c.wh, tableId: tables[0].id, orderType: 'DINE_IN', lines: [line('MN-LATTE', 1), line('MN-MIGOR', 1, 'pedas')] } as never)) as { id: string };
  await c.svc.tabs.send(u, open.id);
}
async function seedFnb(c: Demo) {
  const { ids, value } = await stockItems(c, FNB_BAHAN);
  await openingBalance(c, { kas: 6_000_000, bank: 140_000_000, stockValue: value });
  // adonan donat = barang setengah jadi, dibuat lewat perintah produksi lalu dipakai resep donat
  const semi = await c.svc.products.create(c.tenantId, { sku: 'SF-ADONAN', name: 'Adonan Donat', baseUom: 'PCS', sellPrice: '0', category: 'Setengah jadi', inventoryKind: 'SEMI' } as never);
  ids.set('SF-ADONAN', semi.id);
  for (const m of FNB_MENU) {
    const r = await c.svc.products.create(c.tenantId, { sku: m.sku, name: m.name, baseUom: 'PCS', sellPrice: String(m.price), category: m.sku.startsWith('MN-NAS') || m.sku === 'MN-MIGOR' ? 'Makanan' : m.sku === 'MN-DONAT' ? 'Roti & kue' : 'Minuman', madeToOrder: true } as never);
    ids.set(m.sku, r.id);
  }
  const adonanBom = (await c.step('resep adonan', () =>
    c.svc.production.createBom(c.admin as never, {
      name: 'Adonan donat (batch 50)',
      productId: semi.id,
      outputQty: '50',
      laborCost: '150000',
      overheadCost: '50000',
      lines: [['BB-TEPUNG', 4000], ['BB-TELUR', 8], ['BB-MENTEGA', 400], ['BB-GULA', 500]].map(([k, q]) => ({ productId: ids.get(k as string)!, qty: String(q) })),
    } as never),
  )) as { id: string } | undefined;
  for (const m of FNB_MENU) {
    await c.step(`resep ${m.name}`, () =>
      c.svc.production.createBom(c.admin as never, {
        name: m.bom,
        productId: ids.get(m.sku)!,
        outputQty: '1',
        laborCost: '0',
        overheadCost: '0',
        lines: m.use.map(([k, q]) => ({ productId: ids.get(k)!, qty: String(q) })),
      } as never),
    );
  }
  if (adonanBom) {
    for (const run of [{ ago: 40, batches: 4 }, { ago: 20, batches: 4 }, { ago: 7, batches: 3 }]) {
      const o = (await c.step('perintah produksi adonan', () => c.svc.production.createOrder(c.admin as never, { bomId: adonanBom.id, warehouseId: c.wh, batches: String(run.batches), date: c.ago(run.ago) } as never))) as { id: string } | undefined;
      if (!o) continue;
      await c.step('mulai adonan', () => c.svc.production.start(c.admin as never, o.id, { date: c.ago(run.ago) } as never));
      await c.step('selesai adonan', () => c.svc.production.complete(c.admin as never, o.id, { date: c.ago(run.ago - 1), outputQty: String(Math.floor(50 * run.batches * 0.98)) } as never));
    }
  }
  const sup = await addSuppliers(c, [
    { code: 'SUP-KOPI', name: 'CV Kopi Nusantara Roastery', term: 14 },
    { code: 'SUP-PASAR', name: 'UD Segar Pasar Induk', term: 3 },
    { code: 'SUP-KEMAS', name: 'PT Kemasan Praktis Indonesia', term: 30 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'UMUM', name: 'Pelanggan Umum (kasir)', address: 'Bandung', term: 0 },
    { code: 'KTR-AMANAH', name: 'Kantor Notaris Amanah (pesanan kantor)', address: 'Jl. Asia Afrika, Bandung', term: 14 },
    { code: 'EVT-CEMERLANG', name: 'Event Organizer Cemerlang', address: 'Jl. Dago, Bandung', term: 7 },
  ]);
  // kasir tiap hari: menu dijual, bahan terpotong otomatis sesuai resep
  const menuItems = FNB_MENU.map((m) => ({ id: ids.get(m.sku)!, price: m.price }));
  const extraItems = [{ id: ids.get('FB-AIR')!, price: 6000 }, { id: ids.get('FB-KUE')!, price: 55000 }];
  for (let d = 21; d >= 1; d -= 1) await c.step(`kasir H-${d}`, () => posDay(c, d, [...menuItems, ...menuItems, ...extraItems], c.int(9, 15)));
  await c.step('meja, dapur, dan pesanan online', () => fnbTablesAndOnline(c, ids));
  await c.step('beli biji kopi', () => purchaseWithLots(c, sup.get('SUP-KOPI')!, 30, [{ productId: ids.get('BB-KOPI')!, qty: 20000, price: 142, lotNo: 'KOPI-SEP', expiresInDays: 150 }], { pay: true, invoiceNo: 'KNR/0925/031' }));
  // bahan segar: lot dengan kedaluwarsa dekat (susu, ayam, telur), satu lot sudah lewat tanggal (mentega), satu masih lama (tepung)
  await c.step('beli bahan segar', () =>
    purchaseWithLots(
      c,
      sup.get('SUP-PASAR')!,
      9,
      [
        { productId: ids.get('BB-MENTEGA')!, qty: 4000, price: 46, lotNo: 'MTG-0912', expiresInDays: -1 },
        { productId: ids.get('BB-TEPUNG')!, qty: 25000, price: 13, lotNo: 'TPG-1008', expiresInDays: 45 },
      ],
      { pay: true, invoiceNo: 'SPI-7741' },
    ),
  );
  await c.step('beli bahan segar (kedaluwarsa dekat)', () =>
    purchaseWithLots(
      c,
      sup.get('SUP-PASAR')!,
      2,
      [
        { productId: ids.get('BB-SUSU')!, qty: 60000, price: 18, lotNo: 'SSU-1012', expiresInDays: 5 },
        { productId: ids.get('BB-AYAM')!, qty: 25000, price: 38, lotNo: 'AYM-1012', expiresInDays: 2 },
        { productId: ids.get('BB-TELUR')!, qty: 600, price: 2250, lotNo: 'TLR-1012', expiresInDays: 12 },
      ],
      { invoiceNo: 'SPI-7790' },
    ),
  );
  await c.step('beli kemasan (belum lunas)', () => purchase(c, sup.get('SUP-KEMAS')!, 5, [{ productId: ids.get('KM-CUP')!, qty: 3000, price: 640 }, { productId: ids.get('KM-KOTAK')!, qty: 2000, price: 880 }], { invoiceNo: 'KPI/1025/112' }));
  // pesanan kantor / acara: barang jadi beli putus lewat faktur (menu dijual lewat kasir)
  let fnbUnpaid: string | undefined;
  const orders: [string, number, [string, number][], boolean][] = [
    ['KTR-AMANAH', 40, [['FB-AIR', 120], ['FB-KUE', 10]], true],
    ['EVT-CEMERLANG', 22, [['FB-AIR', 240], ['FB-KUE', 20]], true],
    ['KTR-AMANAH', 8, [['FB-AIR', 96], ['FB-KUE', 12]], false],
  ];
  for (const [code, ago, items, paid] of orders) {
    const inv = await c.step(`jual pesanan ${code}`, () => sell(c, cu.get(code)!, ago, items.map(([k, q]) => ({ productId: ids.get(k)!, qty: q }))));
    if (inv && paid) await c.step('terima bayar pesanan', () => receive(c, inv, Math.max(ago - 6, 2)));
    else if (inv) fnbUnpaid = inv;
  }
  await expense(c, 55, 'bank', '6-3000', 'Sewa kios kafe bulan ini', 7_500_000, 'SEWA-KAFE');
  await expense(c, 25, 'bank', '6-4000', 'Listrik, air, dan gas dapur', 2_650_000);
  await expense(c, 14, 'kas', '5-1350', 'Sedotan, tisu, dan kantong bawa pulang', 540_000, 'NOTA-0214');
  await expense(c, 6, 'kas', '5-1450', 'Bahan terbuang (basi dan tumpah) minggu ini', 310_000, 'BT-0606');
  await payroll(c, [
    { code: 'F-001', name: 'Rizky Pratama', title: 'Barista', dept: 'Dapur', salary: 3_900_000, allowance: 300_000, ptkp: 'TK/0' },
    { code: 'F-002', name: 'Sari Wulandari', title: 'Koki', dept: 'Dapur', salary: 4_400_000, allowance: 300_000, ptkp: 'K/1' },
    { code: 'F-003', name: 'Dina Anggraini', title: 'Kasir', dept: 'Outlet', salary: 3_600_000, allowance: 250_000, ptkp: 'TK/0' },
    { code: 'F-004', name: 'Fajar Nugroho', title: 'Pelayan', dept: 'Outlet', salary: 3_500_000, allowance: 250_000, ptkp: 'TK/0' },
  ]);
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kios kafe bulanan', amount: 7_500_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik, air, dan gas dapur', amount: 2_650_000, from: 'bank', day: 12 },
    { code: '5-1350', desc: 'Sedotan, tisu, dan kantong bawa pulang', amount: 540_000, from: 'kas', day: 18 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-KEMAS', [
    { cat: 'Peralatan', name: 'Mesin espresso dan grinder', cost: 42_000_000, ago: 105, location: 'Dapur' },
    { cat: 'Inventaris', name: 'Kulkas display dan freezer', cost: 16_500_000, ago: 90, location: 'Dapur' },
  ]);
  await X.journals(c);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.stockOps(c, ids, ['BB-SUSU', 'BB-GULA', 'BB-MINYAK', 'BB-BERAS', 'BB-MIE'], { saleInvoiceId: fnbUnpaid, billId: c.last.bill, supplierId: sup.get('SUP-PASAR') });
}

// ---------------------------------------------------------------- UTILITAS
const UTILITAS: Prod[] = [
  { sku: 'UT-SAMBUNG-AIR', name: 'Biaya Sambung Baru Air (paket pemasangan)', cat: 'Biaya sambung baru', price: 1_250_000, cost: 0, qty: 0, uom: 'PAKET' },
  { sku: 'UT-PIPA-PVC', name: 'Pipa PVC 1/2 inci (4 m)', cat: 'Pipa & fitting', price: 38000, cost: 29000, qty: 400, uom: 'BATANG' },
  { sku: 'UT-METER-AIR', name: 'Meter Air 1/2 inci', cat: 'Meter & perangkat', price: 285000, cost: 215000, qty: 120 },
  { sku: 'UT-KABEL-FO', name: 'Kabel Fiber Optik Drop (roll 500 m)', cat: 'Kabel & konektor', price: 1_150_000, cost: 880000, qty: 12, uom: 'ROLL' },
  { sku: 'UT-ONT', name: 'Perangkat ONT / Router Pelanggan', cat: 'Meter & perangkat', price: 420000, cost: 330000, qty: 60 },
];
async function seedUtilitas(c: Demo) {
  const stock = UTILITAS.filter((p) => p.qty > 0);
  const { ids, value } = await stockItems(c, stock);
  await c.svc.products.create(c.tenantId, { sku: UTILITAS[0].sku, name: UTILITAS[0].name, category: UTILITAS[0].cat, baseUom: 'PAKET', sellPrice: String(UTILITAS[0].price) } as never).then((r) => ids.set(UTILITAS[0].sku, r.id)).catch(() => undefined);
  await openingBalance(c, { kas: 9_000_000, bank: 240_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-PIPA', name: 'PT Pipa Nusantara Abadi', term: 30 },
    { code: 'SUP-FO', name: 'CV Fiber Teknik Mandiri', term: 14 },
  ]);
  const homes: [string, string, string][] = [
    ['PLG-001', 'Budi Santoso', 'Griya Asri Blok A-01'], ['PLG-002', 'Siti Aminah', 'Griya Asri Blok A-02'], ['PLG-003', 'Agus Wijaya', 'Griya Asri Blok A-03'],
    ['PLG-004', 'Rina Marlina', 'Griya Asri Blok B-01'], ['PLG-005', 'Dedi Kurniawan', 'Griya Asri Blok B-02'], ['PLG-006', 'Warung Makan Bu Tini', 'Griya Asri Blok B-05'],
    ['PLG-007', 'Hendra Gunawan', 'Griya Asri Blok C-01'], ['PLG-008', 'Maya Sari', 'Griya Asri Blok C-02'],
  ];
  const cu = await addCustomers(c, homes.map(([code, name, address]) => ({ code, name, address: `${address}, Sleman`, term: 20 })));
  const T = c.admin as never;
  const air = (await c.step('tarif air', () => c.svc.utility.createTariff(T, { name: 'Air rumah tangga', serviceType: 'AIR', fixedFee: 12000, adminFee: 2500, minUsage: 5, blocks: [{ upTo: 10, price: 3000 }, { upTo: 20, price: 4500 }, { upTo: null, price: 7000 }] } as never))) as { id: string } | undefined;
  const bisnis = (await c.step('tarif air usaha', () => c.svc.utility.createTariff(T, { name: 'Air usaha kecil', serviceType: 'AIR', fixedFee: 35000, adminFee: 2500, minUsage: 10, blocks: [{ upTo: 30, price: 6500 }, { upTo: null, price: 9500 }] } as never))) as { id: string } | undefined;
  const net = (await c.step('tarif internet', () => c.svc.utility.createTariff(T, { name: 'Internet 20 Mbps', serviceType: 'INTERNET', fixedFee: 185000, adminFee: 0, blocks: [] } as never))) as { id: string } | undefined;
  if (!air || !bisnis || !net) return;
  const conns = new Map<string, { id: string }>();
  for (const [i, [code, , address]] of homes.entries()) {
    const tariff = code === 'PLG-006' ? bisnis.id : i % 4 === 3 ? net.id : air.id;
    const metered = tariff !== net.id;
    const r = (await c.step(`sambungan ${code}`, () => c.svc.utility.createConnection(T, { customerId: cu.get(code)!, tariffId: tariff, meterNo: metered ? `MA-2024-${String(i + 1).padStart(4, '0')}` : undefined, address: `${address}, Sleman`, installedAt: c.ago(100), initialReading: '0' } as never))) as { id: string } | undefined;
    if (r) conns.set(code, r);
  }
  const month = (back: number) => {
    const [y, m] = c.today.slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  // dua bulan sebelumnya: dicatat, diverifikasi, ditagih; bulan ini: sebagian masih menunggu verifikasi
  let meter = new Map<string, number>();
  for (const [back, billIt] of [[2, true], [1, true], [0, false]] as [number, boolean][]) {
    const period = month(back);
    for (const [code, conn] of conns) {
      if (code === 'PLG-004' || code === 'PLG-008') continue; // tarif tetap (internet) tidak memakai meter
      const base = meter.get(code) ?? 0;
      const usage = code === 'PLG-006' ? c.int(28, 40) : c.int(7, 24);
      const cur = base + usage;
      const r = (await c.step(`catat meter ${code}`, () => c.svc.utility.enterReading(T, { connectionId: conn.id, period, current: String(cur) } as never))) as { id: string } | undefined;
      meter.set(code, cur);
      if (r && (billIt || code !== 'PLG-003')) await c.step(`verifikasi ${code}`, () => c.svc.utility.verify(T, r.id, { note: 'Cocok dengan foto meter' } as never));
    }
    if (billIt) await c.step(`tagih ${period}`, () => c.svc.utility.run(T, { period } as never));
  }
  await c.step('tagih bulan ini (yang sudah terverifikasi)', () => c.svc.utility.run(T, { period: month(0) } as never));
  await c.step('beli pipa dan meter', () => purchase(c, sup.get('SUP-PIPA')!, 20, [{ productId: ids.get('UT-PIPA-PVC')!, qty: 200, price: 29000 }, { productId: ids.get('UT-METER-AIR')!, qty: 40, price: 215000 }], { pay: true, invoiceNo: 'PNA/1025/044' }));
  await c.step('beli kabel fiber', () => purchase(c, sup.get('SUP-FO')!, 9, [{ productId: ids.get('UT-KABEL-FO')!, qty: 4, price: 880000 }], { invoiceNo: 'FTM-1190' }));
  await expense(c, 54, 'bank', '6-3000', 'Sewa kantor dan gudang bahan', 3_500_000, 'SEWA-UTL');
  await expense(c, 24, 'bank', '5-1560', 'Listrik pompa air dan perangkat jaringan', 4_200_000, 'PLN-UTL');
  await expense(c, 15, 'bank', '5-1550', 'Bahan pengolahan air (kaporit, tawas)', 1_850_000, 'NOTA-KAPORIT');
  await expense(c, 6, 'kas', '5-1570', 'Perbaikan pipa bocor', 640_000, 'NOTA-0606');
  await payroll(c, [
    { code: 'U-001', name: 'Hadi Prasetyo', title: 'Petugas Lapangan', dept: 'Operasi', salary: 3_800_000, allowance: 300_000, ptkp: 'K/1' },
    { code: 'U-002', name: 'Wulan Pertiwi', title: 'Admin Penagihan', dept: 'Keuangan', salary: 4_200_000, allowance: 300_000, ptkp: 'TK/0' },
    { code: 'U-003', name: 'Joko Susilo', title: 'Teknisi Jaringan', dept: 'Operasi', salary: 4_600_000, allowance: 350_000, ptkp: 'K/2' },
  ]);
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kantor dan gudang bahan', amount: 3_500_000, from: 'bank', day: 2 },
    { code: '5-1560', desc: 'Listrik pompa air dan perangkat jaringan', amount: 4_200_000, from: 'bank', day: 12 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-PIPA', [
    { cat: 'Peralatan', name: 'Pompa air dan tangki penampung', cost: 38_000_000, ago: 100, location: 'Instalasi air' },
    { cat: 'Inventaris', name: 'Alat uji dan perkakas lapangan', cost: 9_500_000, ago: 85, location: 'Gudang' },
  ]);
  await X.journals(c);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('PLG-001')!, '', [
    { title: 'Perumahan Griya Asri blok D — 24 sambungan baru', company: 'PT Griya Asri Properti', contact: 'Pak Heru', value: 30_000_000, source: 'Pengembang / pengelola perumahan' },
    { title: 'Ruko Pasar Baru — internet 6 unit', company: 'Pengelola Ruko Pasar Baru', contact: 'Bu Lina', value: 12_000_000, source: 'Datang ke kantor' },
  ]);
}

export const SEEDS: Record<BusinessModel, (c: Demo) => Promise<void>> = {
  RITEL: seedRitel,
  DAGANG: seedDagang,
  JASA: seedJasa,
  FMCG: seedFmcg,
  MANUFAKTUR: seedManufaktur,
  FNB: seedFnb,
  UTILITAS: seedUtilitas,
};
export { payBill };
