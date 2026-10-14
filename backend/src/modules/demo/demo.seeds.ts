import { type BusinessModel } from '@sansu/shared';
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
  await c.svc.inventory.adjust(c.admin as never, { warehouseId: c.wh, reason: 'OPENING', date: c.ago(60), notes: 'Saldo awal stok', lines } as never);
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
  const { ids, value } = await stockItems(c, RITEL);
  await openingBalance(c, { kas: 8_000_000, bank: 120_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-GROSIR', name: 'PT Grosir Makmur Sentosa', term: 14 },
    { code: 'SUP-FMCG', name: 'CV Distributor Harian Jaya', term: 7 },
  ]);
  await addCustomers(c, [{ code: 'MBR-01', name: 'Member Setia (umum)', address: 'Jakarta', term: 0 }]);
  const items = RITEL.map((p) => ({ id: ids.get(p.sku)!, price: p.price }));
  for (let d = 28; d >= 1; d -= 2) await c.step(`kasir H-${d}`, () => posDay(c, d, items, c.int(5, 9)));
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
  for (const s of sales) {
    const inv = await c.step(`jual ${s.cu}`, () => sell(c, cu.get(s.cu)!, s.ago, s.lines));
    if (inv && s.pay > 0) await c.step('terima bayar', () => receive(c, inv, s.pay, 'TRANSFER'));
    else if (inv && s.pay === 0) continue;
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
}

// ---------------------------------------------------------------- PRODUKSI & MANUFAKTUR
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

const KONVEKSI_RAW: Prod[] = [
  { sku: 'KV-KAIN-COTTON', name: 'Kain Katun Combed 30s', cat: 'Bahan baku', price: 0, cost: 52000, qty: 900, uom: 'M' },
  { sku: 'KV-KAIN-OXFORD', name: 'Kain Oxford', cat: 'Bahan baku', price: 0, cost: 61000, qty: 500, uom: 'M' },
  { sku: 'KV-BENANG', name: 'Benang Jahit', cat: 'Bahan baku', price: 0, cost: 8500, qty: 400, uom: 'ROL' },
  { sku: 'KV-KANCING', name: 'Kancing Kemeja', cat: 'Bahan baku', price: 0, cost: 350, qty: 12000, uom: 'PCS' },
  { sku: 'KV-LABEL', name: 'Label & Hangtag', cat: 'Bahan baku', price: 0, cost: 450, qty: 6000, uom: 'PCS' },
  { sku: 'KV-PLASTIK', name: 'Plastik Kemasan', cat: 'Bahan baku', price: 0, cost: 300, qty: 6000, uom: 'PCS' },
];
async function seedProduksi(c: Demo) {
  const { ids } = await manufacture(
    c,
    KONVEKSI_RAW,
    [
      { sku: 'KV-KAOS', name: 'Kaus Polos Combed (L)', price: 68000 },
      { sku: 'KV-KEMEJA', name: 'Kemeja Oxford Lengan Panjang', price: 135000 },
    ],
    [
      { sku: 'KV-KAOS', name: 'Kaus', price: 68000, bomName: 'Kaus combed per lusin x5', out: 60, labor: 540_000, overhead: 180_000, use: [['KV-KAIN-COTTON', 42], ['KV-BENANG', 3], ['KV-LABEL', 60], ['KV-PLASTIK', 60]] },
      { sku: 'KV-KEMEJA', name: 'Kemeja', price: 135000, bomName: 'Kemeja oxford 40 pcs', out: 40, labor: 640_000, overhead: 220_000, use: [['KV-KAIN-OXFORD', 70], ['KV-BENANG', 4], ['KV-KANCING', 320], ['KV-LABEL', 40], ['KV-PLASTIK', 40]] },
    ],
    [
      { bom: 0, ago: 50, batches: 5, yieldPct: 0.97 },
      { bom: 1, ago: 42, batches: 4, yieldPct: 0.95 },
      { bom: 0, ago: 28, batches: 6, yieldPct: 0.98 },
      { bom: 1, ago: 15, batches: 3, yieldPct: 0.96 },
    ],
  );
  const sup = await addSuppliers(c, [
    { code: 'SUP-TEKSTIL', name: 'PT Tekstil Majalaya Abadi', term: 30 },
    { code: 'SUP-AKSES', name: 'CV Aksesoris Garmen Bandung', term: 14 },
  ]);
  await c.step('beli kain', () => purchase(c, sup.get('SUP-TEKSTIL')!, 38, [{ productId: ids.get('KV-KAIN-COTTON')!, qty: 600, price: 52500 }, { productId: ids.get('KV-KAIN-OXFORD')!, qty: 300, price: 61500 }], { pay: true, invoiceNo: 'TMA/2209/771' }));
  await c.step('beli aksesoris (belum lunas)', () => purchase(c, sup.get('SUP-AKSES')!, 10, [{ productId: ids.get('KV-KANCING')!, qty: 8000, price: 340 }, { productId: ids.get('KV-LABEL')!, qty: 4000, price: 440 }], { invoiceNo: 'AGB-0099' }));
  const cu = await addCustomers(c, [
    { code: 'RS-FASHION', name: 'Butik Fashion Kita', address: 'Jl. Braga No. 40, Bandung', term: 14 },
    { code: 'RS-DISTRO', name: 'Distro Anak Muda', address: 'Jl. Cihampelas, Bandung', term: 14 },
    { code: 'RS-SEKOLAH', name: 'Koperasi SMA Negeri 5', address: 'Bandung', term: 30 },
    { code: 'RS-ONLINE', name: 'Reseller Online Nusantara', address: 'Cimahi', term: 7 },
  ]);
  const s1 = await c.step('jual 1', () => sell(c, cu.get('RS-FASHION')!, 24, [{ productId: ids.get('KV-KAOS')!, qty: 150 }, { productId: ids.get('KV-KEMEJA')!, qty: 60 }]));
  const s2 = await c.step('jual 2', () => sell(c, cu.get('RS-DISTRO')!, 18, [{ productId: ids.get('KV-KAOS')!, qty: 120 }]));
  const s3 = await c.step('jual 3', () => sell(c, cu.get('RS-SEKOLAH')!, 12, [{ productId: ids.get('KV-KEMEJA')!, qty: 90 }]));
  await c.step('jual 4', () => sell(c, cu.get('RS-ONLINE')!, 5, [{ productId: ids.get('KV-KAOS')!, qty: 80 }]));
  if (s1) await c.step('bayar 1', () => receive(c, s1, 8));
  if (s2) await c.step('bayar 2', () => receive(c, s2, 3, 'TRANSFER', 0.6));
  void s3;
  await expense(c, 55, 'bank', '6-3000', 'Sewa bengkel jahit', 7_500_000, 'SEWA-BKL');
  await expense(c, 28, 'bank', '5-4500', 'Listrik mesin jahit', 3_200_000);
  await expense(c, 14, 'kas', '5-4400', 'Servis & suku cadang mesin jahit', 950_000, 'NOTA-0314');
  await payroll(c, [
    { code: 'P-001', name: 'Ani Suryani', title: 'Penjahit', dept: 'Produksi', salary: 3_900_000, allowance: 300_000, ptkp: 'TK/0', production: true },
    { code: 'P-002', name: 'Ujang Hermawan', title: 'Tukang Potong', dept: 'Produksi', salary: 4_000_000, allowance: 300_000, ptkp: 'K/1', production: true },
    { code: 'P-003', name: 'Yati Rohayati', title: 'Penjahit', dept: 'Produksi', salary: 3_900_000, allowance: 300_000, ptkp: 'K/2', production: true },
    { code: 'P-004', name: 'Deni Setiawan', title: 'Admin & Pengiriman', dept: 'Kantor', salary: 4_300_000, allowance: 250_000, ptkp: 'TK/0' },
  ]);
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
  await c.step('jual 3', () => sell(c, cu.get('FNT-SHOWROOM')!, 7, [{ productId: ids.get('FN-MEJA')!, qty: 2 }, { productId: ids.get('FN-LEMARI')!, qty: 2 }]));
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
}

export const SEEDS: Record<BusinessModel, (c: Demo) => Promise<void>> = {
  RITEL: seedRitel,
  DAGANG: seedDagang,
  JASA: seedJasa,
  PRODUKSI: seedProduksi,
  MANUFAKTUR: seedManufaktur,
};
export { payBill };
