import { type ServiceProfile } from '@sansu/shared';
import { and, eq } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { employees } from '../../db/schema';
import * as X from './demo.extra';
import * as F from './demo.fill';
import { addCustomers, addSuppliers, Demo, expense, openingBalance, payBill, payroll, type Prod, purchase, receive, sell, stockItems } from './demo.kit';

// ---------------------------------------------------------------- JASA
const JASA_BAHAN: Prod[] = [
  { sku: 'JB-LISENSI', name: 'Lisensi Perangkat Lunak Desain (tahunan)', cat: 'Lisensi', price: 2_400_000, cost: 1_900_000, qty: 12, uom: 'LSN' },
  { sku: 'JB-CLOUD', name: 'Paket Kredit Cloud (100 jam)', cat: 'Lisensi', price: 3_500_000, cost: 2_800_000, qty: 20, uom: 'PKT' },
  { sku: 'JB-PERANGKAT', name: 'Perangkat Uji Mobile', cat: 'Perangkat', price: 3_200_000, cost: 2_600_000, qty: 8, uom: 'UNIT' },
  { sku: 'JB-CETAK', name: 'Paket Cetak Dokumen Proyek', cat: 'Cetak', price: 450_000, cost: 300_000, qty: 60, uom: 'PKT' },
];
async function seedKonsultan(c: Demo) {
  const { ids, value } = await stockItems(c, JASA_BAHAN);
  await openingBalance(c, { kas: 6_000_000, bank: 210_000_000, stockValue: value });
  const sup = await addSuppliers(c, [{ code: 'SUP-CLOUD', name: 'PT Awan Digital Nusantara', term: 14 }]);
  const cu = await addCustomers(c, [
    { code: 'CL-BANK', name: 'PT Bank Mitra Sejahtera', address: 'Jl. Sudirman Kav. 52, Jakarta', term: 30 },
    { code: 'CL-RETAIL', name: 'PT Ritel Nusantara Prima', address: 'Jl. TB Simatupang, Jakarta', term: 30 },
    { code: 'CL-RS', name: 'Rumah Sakit Sehat Bersama', address: 'Jl. Fatmawati, Jakarta', term: 45 },
    { code: 'CL-START', name: 'Startup Logistik Kita', address: 'Bandung', term: 14 },
    { code: 'CL-EDU', name: 'Yayasan Pendidikan Cerdas', address: 'Depok', term: 30 },
  ]);
  const proj = async (code: string, name: string, cust: string, value: number, start: number) =>
    c.step(`proyek ${name}`, () => c.svc.projects.createProject(c.admin, { code, name, customerId: cu.get(cust)!, contractValue: String(value), startDate: c.ago(start), endDate: c.ago(-60) })) as Promise<{ id: string } | undefined>;
  const p1 = await proj('PRJ-APP', 'Pengembangan Aplikasi Mobile Banking Nasabah', 'CL-BANK', 240_000_000, 58);
  const p2 = await proj('PRJ-ERP', 'Implementasi Sistem Gudang Terpadu', 'CL-RETAIL', 150_000_000, 42);
  const inv = async (cust: string, ago: number, desc: string, label: string, lines: { description: string; qty?: string; unit?: string; price: string }[], projectId?: string) =>
    c.step(`faktur ${desc}`, () => c.svc.billing.createInvoice(c.admin, { customerId: cu.get(cust)!, date: c.ago(ago), description: desc, termLabel: label, projectId, lines })) as Promise<{ id: string } | undefined>;
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
  // bahan kerja dijual/diteruskan ke klien (pesanan kerja), dibeli dari pemasok
  const jsold = await c.step('jual bahan ke klien', () => sell(c, cu.get('CL-RS')!, 30, [{ productId: ids.get('JB-CETAK')!, qty: 20 }, { productId: ids.get('JB-CLOUD')!, qty: 2 }]));
  const jsold2 = await c.step('jual bahan klien 2', () => sell(c, cu.get('CL-EDU')!, 16, [{ productId: ids.get('JB-LISENSI')!, qty: 3 }]));
  if (jsold) await c.step('bayar bahan', () => receive(c, jsold, 18));
  await c.step('beli lisensi', () => purchase(c, sup.get('SUP-CLOUD')!, 38, [{ productId: ids.get('JB-LISENSI')!, qty: 6, price: 1_880_000 }, { productId: ids.get('JB-CLOUD')!, qty: 10, price: 2_750_000 }], { pay: true, invoiceNo: 'AWAN-8841' }));
  await c.step('beli perangkat (belum lunas)', () => purchase(c, sup.get('SUP-CLOUD')!, 8, [{ productId: ids.get('JB-PERANGKAT')!, qty: 4, price: 2_600_000 }], { invoiceNo: 'AWAN-9020' }));
  // faktur jasa yang dipotong PPh 23 oleh klien
  for (const [i, [cust, ago, price]] of ([['CL-BANK', 26, 36_000_000], ['CL-RS', 19, 24_000_000]] as [string, number, number][]).entries()) {
    const w = (await c.step('faktur jasa dipotong PPh 23', () =>
      c.svc.billing.createInvoice(c.admin, { customerId: cu.get(cust)!, date: c.ago(ago), description: 'Jasa konsultasi teknologi informasi', termLabel: 'Paket', withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: 'Konsultasi & implementasi (jasa)', price: String(price) }] }),
    )) as { id: string } | undefined;
    if (w && i === 0) await c.step('bayar faktur dipotong', () => receive(c, w.id, 8, 'TRANSFER', 0.98));
  }
  if (p1) await c.step('progres', () => c.svc.projects.recordProgress(c.admin, p1.id, { date: c.ago(5), percent: '55', notes: 'BA kemajuan 03 — modul transfer & mutasi selesai' }));
  if (p2) await c.step('progres', () => c.svc.projects.recordProgress(c.admin, p2.id, { date: c.ago(5), percent: '35', notes: 'BA kemajuan 01 — konfigurasi gudang pusat' }));
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
  await F.hubungkanPemilik(c, 'J-001');
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('CL-BANK')!, ids.get('JB-CETAK')!, [
    { title: 'Aplikasi mobile — perluasan fitur investasi', company: 'PT Bank Mitra Sejahtera', contact: 'Ibu Dewi', value: 320_000_000, source: 'Klien lama' },
    { title: 'Audit keamanan sistem rumah sakit', company: 'RS Sehat Bersama', contact: 'Pak Budi', value: 95_000_000, source: 'Referensi' },
    { title: 'Portal e-learning sekolah', company: 'Yayasan Pendidikan Cerdas', contact: 'Bu Sari', value: 140_000_000, source: 'Webinar' },
    { title: 'Dashboard analitik penjualan', company: 'PT Ritel Nusantara Prima', contact: 'Pak Rian', value: 85_000_000, source: 'Kunjungan' },
  ]);
  const dep = await c.step('uang muka pelanggan', () => c.svc.deposits.createDeposit(c.admin, { customerId: cu.get('CL-EDU')!, date: c.ago(15), amount: '27750000', method: 'TRANSFER', cashAccountId: c.bank, description: 'Uang muka portal e-learning' }));
  void dep;
  await X.stockOps(c, ids, JASA_BAHAN.map((p) => p.sku), { saleInvoiceId: jsold2, billId: c.last.bill, supplierId: sup.get('SUP-CLOUD') });
  await F.jasaOperations(c, [cu.get('CL-BANK')!, cu.get('CL-RETAIL')!, cu.get('CL-RS')!], p1?.id);
  await F.projectBudgets(c);
  await F.serviceWork(c, [{ name: 'Konsultan senior — per jam', unit: 'HOUR', rate: '250000', qty: '6.5' }, { name: 'Sesi pelatihan klien', unit: 'SESSION', rate: '1500000', qty: '1' }]);
  await F.minimums(c, [...ids.values()]);
  await F.priceAgreements(c, [{ supplierId: sup.get('SUP-CLOUD')!, productId: ids.get('JB-LISENSI')!, price: 1_850_000 }]);
  await F.supplierAdvance(c, sup.get('SUP-CLOUD')!, ids.get('JB-CLOUD')!, 2_700_000);
  await F.employmentChange(c);
  await F.closePeriod(c);
}


/** Profil layanan Jasa → data contoh sendiri (transaksi, pelanggan, biaya, laporan berbeda untuk tiap profil); bawaan Kontraktor */
export async function seedJasa(c: Demo, profile: ServiceProfile = 'KONTRAKTOR') {
  const seeds: Record<ServiceProfile, (c: Demo) => Promise<void>> = {
    KONTRAKTOR: seedKontraktor,
    KONSULTAN: seedKonsultan,
    PENDIDIKAN: seedPendidikan,
    ALIH_DAYA: seedAlihDaya,
    BENGKEL: seedBengkel,
  };
  await seeds[profile](c);
}

const staffIds = async (c: Demo) => (await c.db.select({ id: employees.id }).from(employees).where(eq(employees.tenantId, c.tenantId)).orderBy(employees.code)).map((e) => e.id);

/** Akun biaya langsung (HPP jasa) menurut kode bagan akun, untuk tagihan biaya bertanda proyek */
const costBill = (c: Demo, supplierId: string, ago: number, no: string, projectId: string | undefined, lines: { desc: string; code: string; price: number }[], pay?: number) =>
  c.step(`tagihan ${no}`, async () => {
    const b = (await c.svc.bills.createBill(c.admin, {
      supplierId,
      supplierInvoiceNo: no,
      date: c.ago(ago),
      withVat: false,
      description: lines[0].desc,
      projectId,
      lines: lines.map((l) => ({ type: 'EXPENSE' as const, description: l.desc, accountId: c.acc(l.code), price: String(l.price) })),
    })) as { id: string };
    c.last.bill = b.id;
    if (pay !== undefined) await payBill(c, b.id, pay);
    return b;
  });

// ---------------------------------------------------------------- KONTRAKTOR
const KONTRAKTOR_BAHAN: Prod[] = [
  { sku: 'KB-SEMEN', name: 'Semen Portland 50kg', cat: 'Material', price: 72_000, cost: 61_000, qty: 600, uom: 'ZAK' },
  { sku: 'KB-BESI', name: 'Besi Beton Ulir D16 (batang 12m)', cat: 'Material', price: 168_000, cost: 142_000, qty: 400, uom: 'BTG' },
  { sku: 'KB-PASIR', name: 'Pasir Cor (per m3)', cat: 'Material', price: 285_000, cost: 240_000, qty: 120, uom: 'M3' },
  { sku: 'KB-KERAMIK', name: 'Keramik Lantai 60x60 (dus)', cat: 'Finishing', price: 210_000, cost: 172_000, qty: 150, uom: 'DUS' },
];

async function seedKontraktor(c: Demo) {
  const { ids, value } = await stockItems(c, KONTRAKTOR_BAHAN);
  await openingBalance(c, { kas: 8_000_000, bank: 420_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-SEMEN', name: 'PT Semen Bangun Jaya', term: 30 },
    { code: 'SUP-BESI', name: 'CV Baja Utama', term: 30 },
    { code: 'SUP-SUBKON', name: 'CV Mitra Pondasi (subkontraktor)', term: 14 },
    { code: 'SUP-ALAT', name: 'PT Sewa Alat Berat Nusa', term: 14 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'PM-GRIYA', name: 'PT Griya Properti Mandiri', address: 'Jl. Raya Kalimalang, Bekasi', term: 30 },
    { code: 'PM-DINAS', name: 'Dinas Pekerjaan Umum Kota Bekasi', address: 'Jl. Ahmad Yani, Bekasi', term: 45 },
    { code: 'PM-SINAR', name: 'PT Sinar Logam Industri', address: 'Kawasan Industri MM2100, Cikarang', term: 30 },
    { code: 'PM-RSUD', name: 'RSUD Harapan Sehat', address: 'Jl. Veteran, Bekasi', term: 45 },
  ]);
  const proj = (code: string, name: string, cust: string, value: number, start: number, retention: string) =>
    c.step(`proyek ${name}`, () =>
      c.svc.projects.createProject(c.admin, { code, name, customerId: cu.get(cust)!, contractValue: String(value), retentionPct: retention, retentionDays: 180, startDate: c.ago(start), endDate: c.ago(-90) }),
    ) as Promise<{ id: string } | undefined>;
  const p1 = await proj('KTR-RUKO', 'Pembangunan Ruko 3 Lantai (12 unit)', 'PM-GRIYA', 1_450_000_000, 95, '5');
  const p2 = await proj('KTR-JALAN', 'Rehabilitasi Jalan Lingkungan Paket A', 'PM-DINAS', 780_000_000, 70, '5');
  const p3 = await proj('KTR-GUDANG', 'Perluasan Gudang Pabrik', 'PM-SINAR', 640_000_000, 50, '0');
  const p4 = await proj('KTR-IGD', 'Renovasi Ruang IGD', 'PM-RSUD', 360_000_000, 30, '5');
  if (p1) {
    await c.step('BoQ ruko', () =>
      c.svc.contracting.saveBoq(c.admin, p1.id, {
        syncContract: true,
        items: [
          { code: 'A', description: 'Pekerjaan pondasi & tanah', unit: 'ls', qty: '1', unitPrice: '180000000' },
          { code: 'B', description: 'Struktur beton bertulang', unit: 'm3', qty: '320', unitPrice: '1650000' },
          { code: 'C', description: 'Pasangan dinding bata ringan', unit: 'm2', qty: '900', unitPrice: '185000' },
          { code: 'D', description: 'Lantai keramik & finishing', unit: 'm2', qty: '1100', unitPrice: '310000' },
          { code: 'E', description: 'Atap, plafon & MEP', unit: 'ls', qty: '1', unitPrice: '234500000' },
        ],
      }),
    );
    const boq = (await c.svc.contracting.boq(c.tenantId, p1.id)) as { items: { id: string; qty: string }[] };
    const done = [1, 0.7, 0.4, 0, 0];
    await c.step('opname volume ruko', () => c.svc.contracting.boqProgress(c.admin, p1.id, { date: c.ago(6), notes: 'Opname lapangan bersama pengawas', items: boq.items.map((i, k) => ({ itemId: i.id, completedQty: (Number(i.qty) * done[k]).toFixed(4) })) }));
  }
  // termin beretensi: faktur jalan + faktur retensi (dipecah otomatis); PPh final 4(2) 2% dipotong pemilik proyek
  const termin = (projectId: string | undefined, cust: string, ago: number, label: string, price: number) =>
    projectId
      ? (c.step(`termin ${label}`, () =>
          c.svc.contracting.createInvoice(c.admin, { customerId: cu.get(cust)!, projectId, date: c.ago(ago), termLabel: label, description: label, withholdingType: 'PPH4_2', withholdingRate: '2', lines: [{ description: label, price: String(price) }] }),
        ) as Promise<{ id: string; retentionInvoice?: { id: string } } | undefined>)
      : Promise.resolve(undefined);
  const t1 = await termin(p1?.id, 'PM-GRIYA', 88, 'Termin 1 — uang muka 20%', 290_000_000);
  const t2 = await termin(p1?.id, 'PM-GRIYA', 40, 'Termin 2 — progres 30%', 435_000_000);
  const t3 = await termin(p2?.id, 'PM-DINAS', 45, 'Termin 1 — progres 30%', 234_000_000);
  const t4 = await termin(p3?.id, 'PM-SINAR', 22, 'Termin 1 — uang muka 30%', 192_000_000);
  const t5 = await termin(p4?.id, 'PM-RSUD', 18, 'Termin 1 — uang muka 25%', 90_000_000);
  if (t1) await c.step('bayar termin ruko 1', () => receive(c, t1.id, 70));
  if (t2) await c.step('bayar termin ruko 2 (sebagian)', () => receive(c, t2.id, 15, 'TRANSFER', 0.6));
  if (t3) await c.step('bayar termin jalan', () => receive(c, t3.id, 12));
  if (t5) await c.step('bayar uang muka IGD', () => receive(c, t5.id, 6));
  void t4;
  if (p2) await c.step('progres jalan', () => c.svc.projects.recordProgress(c.admin, p2.id, { date: c.ago(5), percent: '45', notes: 'Laporan mingguan — pengaspalan segmen 1–3' }));
  if (p3) await c.step('progres gudang', () => c.svc.projects.recordProgress(c.admin, p3.id, { date: c.ago(5), percent: '30', notes: 'Pondasi dan sloof selesai' }));
  if (p4) await c.step('progres IGD', () => c.svc.projects.recordProgress(c.admin, p4.id, { date: c.ago(5), percent: '20', notes: 'Bongkaran dan instalasi awal' }));
  // biaya langsung per proyek: material, subkontraktor, sewa alat (akun HPP jasa)
  await costBill(c, sup.get('SUP-SEMEN')!, 80, 'SBJ-2201', p1?.id, [{ desc: 'Semen & pasir pondasi ruko', code: '5-1600', price: 96_000_000 }], 55);
  await costBill(c, sup.get('SUP-BESI')!, 62, 'BU-7712', p1?.id, [{ desc: 'Besi beton struktur lantai 1–2', code: '5-1600', price: 148_000_000 }], 30);
  await costBill(c, sup.get('SUP-SUBKON')!, 70, 'MP-0310', p1?.id, [{ desc: 'Subkontrak pondasi tiang pancang', code: '5-1500', price: 118_000_000 }], 44);
  await costBill(c, sup.get('SUP-ALAT')!, 50, 'SAB-4401', p2?.id, [{ desc: 'Sewa excavator & asphalt finisher (jalan)', code: '5-1900', price: 64_000_000 }], 20);
  await costBill(c, sup.get('SUP-SEMEN')!, 35, 'SBJ-2250', p2?.id, [{ desc: 'Material lapis pondasi agregat', code: '5-1600', price: 72_000_000 }]);
  await costBill(c, sup.get('SUP-BESI')!, 26, 'BU-7790', p3?.id, [{ desc: 'Besi & baja ringan gudang', code: '5-1600', price: 88_000_000 }]);
  await costBill(c, sup.get('SUP-SUBKON')!, 14, 'MP-0344', p4?.id, [{ desc: 'Subkontrak instalasi medis gas & listrik', code: '5-1500', price: 41_000_000 }]);
  await purchase(c, sup.get('SUP-SEMEN')!, 28, [{ productId: ids.get('KB-SEMEN')!, qty: 200, price: 62_000 }, { productId: ids.get('KB-PASIR')!, qty: 40, price: 245_000 }], { pay: true, invoiceNo: 'SBJ-2234' });
  await purchase(c, sup.get('SUP-BESI')!, 9, [{ productId: ids.get('KB-BESI')!, qty: 120, price: 143_000 }], { invoiceNo: 'BU-7803' });
  await expense(c, 33, 'bank', '6-3000', 'Sewa kantor proyek & bedeng pekerja', 12_000_000, 'SEWA-KP');
  await expense(c, 18, 'bank', '6-4000', 'Listrik & air kantor serta gudang material', 3_600_000);
  await expense(c, 11, 'kas', '6-2030', 'Transport survei & koordinasi lapangan', 1_450_000, 'NOTA-0711');
  await payroll(c, [
    { code: 'K-001', name: 'Hendra Wijaya', title: 'Manajer Proyek', dept: 'Proyek', salary: 16_000_000, allowance: 1_800_000, ptkp: 'K/2' },
    { code: 'K-002', name: 'Rina Kusuma', title: 'Insinyur Sipil', dept: 'Teknik', salary: 12_000_000, allowance: 1_000_000, ptkp: 'K/1' },
    { code: 'K-003', name: 'Joko Santoso', title: 'Pelaksana Lapangan', dept: 'Proyek', salary: 8_500_000, allowance: 800_000, ptkp: 'K/3' },
    { code: 'K-004', name: 'Dewi Rahma', title: 'Administrasi & Keuangan Proyek', dept: 'Administrasi', salary: 7_500_000, allowance: 600_000, ptkp: 'TK/0' },
  ]);
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kantor proyek & bedeng pekerja', amount: 12_000_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik & air kantor serta gudang material', amount: 3_600_000, from: 'bank', day: 10 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-ALAT', [
    { cat: 'Inventaris', name: 'Mesin molen beton (3 unit)', cost: 45_000_000, ago: 100, location: 'Gudang material' },
    { cat: 'Inventaris', name: 'Scaffolding & bekisting set', cost: 62_000_000, ago: 90, location: 'Gudang material' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 12_000_000 }, { code: '6-4000', monthly: 4_000_000 }, { code: '6-1000', monthly: 50_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await F.projectBudgets(c);
  await F.hubungkanPemilik(c, 'K-001');
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('PM-GRIYA')!, ids.get('KB-SEMEN')!, [
    { title: 'Tender pembangunan kantor cabang bank', company: 'PT Bank Mitra Sejahtera', contact: 'Ibu Dewi', value: 2_800_000_000, source: 'Tender terbuka' },
    { title: 'Perumahan klaster 40 unit tahap 2', company: 'PT Griya Properti Mandiri', contact: 'Pak Anton', value: 5_400_000_000, source: 'Klien lama' },
    { title: 'Pelebaran jalan akses kawasan industri', company: 'PT Sinar Logam Industri', contact: 'Pak Rudi', value: 920_000_000, source: 'Referensi' },
  ]);
  await X.stockOps(c, ids, KONTRAKTOR_BAHAN.map((p) => p.sku), { billId: c.last.bill, supplierId: sup.get('SUP-SEMEN') });
  await F.minimums(c, [...ids.values()]);
  await F.employmentChange(c);
  await F.closePeriod(c);
}

// ---------------------------------------------------------------- PENDIDIKAN / KURSUS
const PENDIDIKAN_BAHAN: Prod[] = [
  { sku: 'PB-MOD-MTK', name: 'Modul Matematika SMP', cat: 'Modul', price: 65_000, cost: 38_000, qty: 150, uom: 'EKS' },
  { sku: 'PB-MOD-ING', name: 'Modul Bahasa Inggris', cat: 'Modul', price: 55_000, cost: 32_000, qty: 120, uom: 'EKS' },
  { sku: 'PB-SERAGAM', name: 'Kaos Seragam Bimbel', cat: 'Seragam', price: 85_000, cost: 52_000, qty: 80, uom: 'PCS' },
];

async function seedPendidikan(c: Demo) {
  const { ids, value } = await stockItems(c, PENDIDIKAN_BAHAN);
  await openingBalance(c, { kas: 6_000_000, bank: 160_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-CETAK', name: 'CV Percetakan Edukasi', term: 14 },
    { code: 'SUP-PERLENGKAPAN', name: 'PT Perlengkapan Sekolah Nusantara', term: 30 },
  ]);
  const walis: [string, string][] = [
    ['W-001', 'Ibu Ratna Dewi'], ['W-002', 'Bapak Hendra Saputra'], ['W-003', 'Ibu Siti Aminah'], ['W-004', 'Bapak Bambang Wijaya'], ['W-005', 'Ibu Lestari Putri'], ['W-006', 'Bapak Agus Salim'],
  ];
  const cu = await addCustomers(c, [
    ...walis.map(([code, name]) => ({ code, name, address: 'Perumahan Taman Cerdas, Depok', term: 7 })),
    { code: 'S-001', name: 'SMP Negeri 5 Depok', address: 'Jl. Margonda Raya, Depok', term: 30 },
  ]);
  const cls = async (code: string, name: string, fee: string, capacity: number) =>
    (await c.step(`kelas ${code}`, () => c.svc.education.createClass(c.admin, { code, name, monthlyFee: fee, capacity, startDate: c.ago(125) }))) as { id: string } | undefined;
  const mat = await cls('MAT-7', 'Matematika SMP kelas 7', '350000', 12);
  const ing = await cls('ING-1', 'Bahasa Inggris dasar', '275000', 10);
  const utbk = await cls('UTBK', 'Persiapan UTBK intensif', '600000', 8);
  const sd = await cls('SD-CAL', 'Calistung & matematika SD', '225000', 14);
  const students: [string, { id: string } | undefined, number, number, string?][] = [
    ['Andi Pratama', mat, 0, 120], ['Budi Pratama', mat, 0, 120, '10'], ['Citra Lestari', mat, 1, 118], ['Dimas Hendra', ing, 1, 115], ['Eka Siti', ing, 2, 112],
    ['Fajar Wijaya', utbk, 3, 110], ['Gita Wijaya', utbk, 3, 110, '10'], ['Hana Putri', sd, 4, 108], ['Ilham Salim', sd, 5, 105], ['Joko Salim', sd, 5, 105, '10'], ['Kiki Aminah', ing, 2, 100], ['Lina Dewi', mat, 0, 95],
  ];
  const enrolled: string[] = [];
  for (const [name, klass, wi, ago, disc] of students) {
    if (!klass) continue;
    const e = (await c.step(`peserta ${name}`, () => c.svc.education.enroll(c.admin, { classId: klass.id, customerId: cu.get(walis[wi][0])!, studentName: name, enrolledOn: c.ago(ago), discountPct: disc }))) as { id: string } | undefined;
    if (e) enrolled.push(e.id);
    // uang pendaftaran siswa baru (tagihan jasa tersendiri, bukan SPP)
    const reg = (await c.step(`pendaftaran ${name}`, () => c.svc.billing.createInvoice(c.admin, { customerId: cu.get(walis[wi][0])!, date: c.ago(ago), description: `Uang pendaftaran — ${name}`, termLabel: 'Pendaftaran', lines: [{ description: `Uang pendaftaran siswa baru ${name}`, price: '250000' }] }))) as { id: string } | undefined;
    if (reg) await c.step('bayar pendaftaran', () => receive(c, reg.id, Math.max(ago - 2, 1), 'CASH'));
  }
  if (enrolled[10]) await c.step('peserta keluar', () => c.svc.education.leave(c.admin, enrolled[10], { leftOn: c.ago(45), reason: 'Pindah domisili' }));
  // penjualan modul/seragam ke wali sebelum ada tagihan SPP yang jatuh tempo
  const m1 = await c.step('jual modul', () => sell(c, cu.get('W-001')!, 88, [{ productId: ids.get('PB-MOD-MTK')!, qty: 2 }, { productId: ids.get('PB-SERAGAM')!, qty: 2 }]));
  const m2 = await c.step('jual modul 2', () => sell(c, cu.get('W-004')!, 84, [{ productId: ids.get('PB-MOD-ING')!, qty: 3 }]));
  if (m1) await c.step('bayar modul', () => receive(c, m1, 80, 'CASH'));
  void m2;
  // SPP bulanan 4 periode terakhir; sebagian wali menunggak (periode terbaru belum dibayar)
  for (const [k, off] of [95, 65, 35, 5].entries()) {
    const r = (await c.step(`SPP ${off} hari lalu`, () => c.svc.education.bill(c.admin, { period: c.ago(off).slice(0, 7), date: c.ago(off) }))) as { invoices: { invoiceId: string }[] } | undefined;
    for (const [i, inv] of (r?.invoices ?? []).entries()) {
      const unpaid = k === 3 || (k === 2 && i % 3 === 0);
      if (!unpaid) await c.step('bayar SPP', () => receive(c, inv.invoiceId, Math.max(off - c.int(2, 9), 1), i % 2 ? 'CASH' : 'TRANSFER'));
    }
  }
  // pelatihan guru untuk sekolah (dipotong PPh 23 oleh sekolah negeri) dan penjualan modul ke wali
  const trn = (await c.step('pelatihan guru', () =>
    c.svc.billing.createInvoice(c.admin, { customerId: cu.get('S-001')!, date: c.ago(30), description: 'Pelatihan metode belajar untuk guru (2 hari)', termLabel: 'Paket', withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: 'Pelatihan metode belajar untuk guru (2 hari)', price: '12500000' }] }),
  )) as { id: string } | undefined;
  if (trn) await c.step('bayar pelatihan', () => receive(c, trn.id, 8, 'TRANSFER', 0.98));
  await purchase(c, sup.get('SUP-CETAK')!, 50, [{ productId: ids.get('PB-MOD-MTK')!, qty: 100, price: 38_500 }, { productId: ids.get('PB-MOD-ING')!, qty: 80, price: 32_500 }], { pay: true, invoiceNo: 'CPE-1180' });
  await purchase(c, sup.get('SUP-PERLENGKAPAN')!, 10, [{ productId: ids.get('PB-SERAGAM')!, qty: 40, price: 53_000 }], { invoiceNo: 'PSN-6620' });
  await expense(c, 58, 'bank', '6-3000', 'Sewa gedung belajar', 18_000_000, 'SEWA-GB');
  await expense(c, 30, 'bank', '6-4000', 'Listrik, air & internet gedung belajar', 4_200_000);
  await expense(c, 24, 'bank', '6-2100', 'Spanduk & iklan penerimaan siswa baru', 6_500_000, 'IKL-0924');
  await expense(c, 9, 'kas', '6-6000', 'ATK & fotokopi soal latihan', 1_240_000, 'NOTA-0911');
  await payroll(c, [
    { code: 'P-001', name: 'Maya Kusumawati', title: 'Kepala Bimbel', dept: 'Manajemen', salary: 11_000_000, allowance: 1_200_000, ptkp: 'K/1' },
    { code: 'P-002', name: 'Rizky Maulana', title: 'Admin Akademik', dept: 'Akademik', salary: 6_500_000, allowance: 500_000, ptkp: 'TK/0' },
    { code: 'P-003', name: 'Dian Anggraini', title: 'Pengajar Tetap Matematika', dept: 'Pengajar', salary: 7_500_000, allowance: 600_000, ptkp: 'TK/0' },
    { code: 'P-004', name: 'Fauzan Hakim', title: 'Pengajar Tetap Bahasa Inggris', dept: 'Pengajar', salary: 7_500_000, allowance: 600_000, ptkp: 'K/0' },
  ]);
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa gedung belajar', amount: 18_000_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik, air & internet gedung belajar', amount: 4_200_000, from: 'bank', day: 10 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-PERLENGKAPAN', [
    { cat: 'Inventaris', name: 'Proyektor & layar kelas (4 set)', cost: 32_000_000, ago: 100, location: 'Ruang kelas' },
    { cat: 'Inventaris', name: 'AC ruang kelas (4 unit)', cost: 28_000_000, ago: 95, location: 'Ruang kelas' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 18_000_000 }, { code: '6-2100', monthly: 3_000_000 }, { code: '6-1000', monthly: 35_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await F.hubungkanPemilik(c, 'P-001');
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('S-001')!, ids.get('PB-MOD-MTK')!, [
    { title: 'Kerja sama kelas tambahan SMA Negeri 3', company: 'SMA Negeri 3 Depok', contact: 'Ibu Kepala Sekolah', value: 96_000_000, source: 'Kunjungan' },
    { title: 'Program persiapan ujian untuk yayasan', company: 'Yayasan Pendidikan Harapan', contact: 'Pak Rahmat', value: 140_000_000, source: 'Referensi' },
    { title: 'Kelas bahasa Inggris karyawan perusahaan', company: 'PT Mitra Logistik', contact: 'Bu Dina HRD', value: 68_000_000, source: 'Webinar' },
  ]);
  await X.stockOps(c, ids, PENDIDIKAN_BAHAN.map((p) => p.sku), { saleInvoiceId: m2, billId: c.last.bill, supplierId: sup.get('SUP-CETAK') });
  await F.serviceWork(c, [{ name: 'Mengajar kelas reguler — per sesi', unit: 'SESSION', rate: '120000', qty: '16' }, { name: 'Mengajar kelas intensif UTBK — per sesi', unit: 'SESSION', rate: '180000', qty: '10' }]);
  await F.minimums(c, [...ids.values()]);
  await F.employmentChange(c);
  await F.closePeriod(c);
}

// ---------------------------------------------------------------- ALIH DAYA (kebersihan & keamanan)
const ALIH_BAHAN: Prod[] = [
  { sku: 'AD-PEMBERSIH', name: 'Cairan Pembersih Lantai 5L', cat: 'Bahan kebersihan', price: 68_000, cost: 48_000, qty: 120, uom: 'JRG' },
  { sku: 'AD-KANTONG', name: 'Kantong Sampah Besar (dus 50)', cat: 'Bahan kebersihan', price: 95_000, cost: 68_000, qty: 90, uom: 'DUS' },
  { sku: 'AD-SERAGAM', name: 'Seragam Petugas (set)', cat: 'Seragam', price: 240_000, cost: 175_000, qty: 40, uom: 'SET' },
];

async function seedAlihDaya(c: Demo) {
  const { ids, value } = await stockItems(c, ALIH_BAHAN);
  await openingBalance(c, { kas: 7_000_000, bank: 190_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-KIMIA', name: 'PT Kimia Bersih Nusantara', term: 30 },
    { code: 'SUP-SERAGAM', name: 'CV Seragam Karya', term: 14 },
    { code: 'SUP-ALAT', name: 'Toko Peralatan Kebersihan Jaya', term: 14 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'GD-SENTRAL', name: 'PT Graha Perkantoran Sentral', address: 'Jl. Jenderal Sudirman, Jakarta', term: 30 },
    { code: 'GD-METRO', name: 'Mal Metro Plaza', address: 'Jl. Margonda Raya, Depok', term: 30 },
    { code: 'GD-TEKSTIL', name: 'PT Pabrik Tekstil Maju', address: 'Kawasan Industri Jababeka, Cikarang', term: 45 },
    { code: 'GD-RS', name: 'RS Pelita Medika', address: 'Jl. Raya Bogor, Jakarta Timur', term: 45 },
  ]);
  // karyawan lapangan lebih dulu (dipakai jadwal jaga): 1 koordinator, 5 satpam, 5 petugas kebersihan
  await payroll(c, [
    { code: 'P-001', name: 'Andri Setiawan', title: 'Koordinator Lapangan', dept: 'Operasional', salary: 9_500_000, allowance: 900_000, ptkp: 'K/2' },
    { code: 'P-002', name: 'Bayu Nugroho', title: 'Satpam', dept: 'Keamanan', salary: 4_600_000, allowance: 400_000, ptkp: 'K/1' },
    { code: 'P-003', name: 'Cahyo Prasetyo', title: 'Satpam', dept: 'Keamanan', salary: 4_600_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'P-004', name: 'Dedi Kurniawan', title: 'Satpam', dept: 'Keamanan', salary: 4_600_000, allowance: 400_000, ptkp: 'K/2' },
    { code: 'P-005', name: 'Eko Wahyudi', title: 'Satpam', dept: 'Keamanan', salary: 4_600_000, allowance: 400_000, ptkp: 'K/0' },
    { code: 'P-006', name: 'Fikri Ramadhan', title: 'Satpam', dept: 'Keamanan', salary: 4_600_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'P-007', name: 'Gita Lestari', title: 'Petugas Kebersihan', dept: 'Kebersihan', salary: 4_100_000, allowance: 300_000, ptkp: 'TK/0' },
    { code: 'P-008', name: 'Hesti Rahayu', title: 'Petugas Kebersihan', dept: 'Kebersihan', salary: 4_100_000, allowance: 300_000, ptkp: 'K/1' },
    { code: 'P-009', name: 'Indah Permata', title: 'Petugas Kebersihan', dept: 'Kebersihan', salary: 4_100_000, allowance: 300_000, ptkp: 'TK/0' },
    { code: 'P-010', name: 'Juwita Sari', title: 'Petugas Kebersihan', dept: 'Kebersihan', salary: 4_100_000, allowance: 300_000, ptkp: 'K/2' },
    { code: 'P-011', name: 'Kartika Dewi', title: 'Petugas Kebersihan', dept: 'Kebersihan', salary: 4_100_000, allowance: 300_000, ptkp: 'TK/0' },
  ]);
  const st = await staffIds(c);
  const site = async (customer: string, name: string, title: string, posts: { name: string; headcount: number; monthlyRate: string }[]) => {
    const r = (await c.step(`kontrak ${name}`, () => c.svc.sites.create(c.admin, { customerId: cu.get(customer)!, siteName: name, title, startDate: c.ago(100), posts }))) as { id: string } | undefined;
    if (!r) return undefined;
    const list = (await c.svc.sites.list(c.tenantId)) as { id: string; posts: { id: string; name: string }[] }[];
    return { id: r.id, posts: list.find((s) => s.id === r.id)?.posts ?? [] };
  };
  const s1 = await site('GD-SENTRAL', 'Menara Sentral', 'Jasa keamanan & kebersihan gedung', [
    { name: 'Satpam shift pagi', headcount: 2, monthlyRate: '4900000' }, { name: 'Satpam shift malam', headcount: 2, monthlyRate: '5200000' }, { name: 'Petugas kebersihan', headcount: 3, monthlyRate: '4300000' },
  ]);
  const s2 = await site('GD-METRO', 'Metro Plaza', 'Jasa kebersihan mal', [{ name: 'Petugas kebersihan area publik', headcount: 2, monthlyRate: '4300000' }]);
  const s3 = await site('GD-RS', 'RS Pelita Medika', 'Jasa keamanan rumah sakit', [{ name: 'Satpam shift malam', headcount: 1, monthlyRate: '5200000' }]);
  const pid = (s: typeof s1, name: string) => s?.posts.find((p) => p.name.includes(name))?.id;
  // jadwal jaga dua jendela (masing-masing ≤ 62 hari); sebagian petugas hanya jendela pertama → ada kekurangan petugas yang tampil di tagihan
  const roster = async (s: typeof s1, post: string, who: number, windows: [number, number][]) => {
    const p = pid(s, post);
    if (!s || !p || !st[who]) return;
    for (const [from, to] of windows) await c.step('jadwal jaga', () => c.svc.sites.assign(c.admin, s.id, { postId: p, employeeId: st[who], from: c.ago(from), to: c.ago(to) }));
  };
  const both: [number, number][] = [[95, 36], [35, 4]];
  const first: [number, number][] = [[95, 36]];
  await roster(s1, 'pagi', 1, both);
  await roster(s1, 'pagi', 2, first);
  await roster(s1, 'malam', 3, both);
  await roster(s1, 'malam', 4, both);
  await roster(s1, 'kebersihan', 6, both);
  await roster(s1, 'kebersihan', 7, both);
  await roster(s1, 'kebersihan', 8, first);
  await roster(s2, 'kebersihan', 9, both);
  await roster(s2, 'kebersihan', 10, first);
  await roster(s3, 'malam', 5, both);
  const bill = async (s: typeof s1, off: number, deduct: boolean, payAfter?: number) => {
    if (!s) return;
    const inv = (await c.step('tagih kontrak lokasi', () => c.svc.sites.bill(c.admin, s.id, { period: c.ago(off).slice(0, 7), date: c.ago(off - 6), deductShortfall: deduct }))) as { id: string } | undefined;
    if (inv && payAfter !== undefined) await c.step('bayar tagihan kontrak', () => receive(c, inv.id, payAfter));
  };
  await bill(s1, 62, true, 40);
  await bill(s2, 62, false, 38);
  await bill(s3, 62, false, 36);
  await bill(s1, 32, true, 8);
  await bill(s2, 32, true);
  await bill(s3, 32, false);
  // jasa tambahan sekali pakai: general cleaning, dipotong PPh 23 oleh pelanggan
  const gc = (await c.step('general cleaning', () =>
    c.svc.billing.createInvoice(c.admin, { customerId: cu.get('GD-TEKSTIL')!, date: c.ago(27), description: 'General cleaning area produksi & kantor', termLabel: 'Paket', withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: 'General cleaning area produksi (3 hari, 12 petugas)', price: '18600000' }] }),
  )) as { id: string } | undefined;
  if (gc) await c.step('bayar general cleaning', () => receive(c, gc.id, 6, 'TRANSFER', 0.98));
  await purchase(c, sup.get('SUP-KIMIA')!, 44, [{ productId: ids.get('AD-PEMBERSIH')!, qty: 60, price: 49_000 }, { productId: ids.get('AD-KANTONG')!, qty: 40, price: 69_000 }], { pay: true, invoiceNo: 'KBN-5521' });
  await purchase(c, sup.get('SUP-SERAGAM')!, 20, [{ productId: ids.get('AD-SERAGAM')!, qty: 12, price: 176_000 }], { invoiceNo: 'SK-0932' });
  await expense(c, 57, 'bank', '6-3000', 'Sewa kantor dan basecamp', 9_500_000, 'SEWA-BC');
  await expense(c, 29, 'bank', '6-4000', 'Listrik, air & internet kantor', 2_900_000);
  await expense(c, 21, 'kas', '6-2000', 'BBM patroli & antar bahan ke lokasi', 3_150_000, 'NOTA-0921');
  await expense(c, 12, 'bank', '6-6000', 'Pelatihan dasar satpam & K3 petugas', 4_800_000, 'PLT-1012');
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa kantor dan basecamp', amount: 9_500_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik, air & internet kantor', amount: 2_900_000, from: 'bank', day: 10 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-ALAT', [
    { cat: 'Inventaris', name: 'Mesin poles lantai & vacuum industri (4 unit)', cost: 38_000_000, ago: 100, location: 'Gudang peralatan' },
    { cat: 'Inventaris', name: 'Handy talky & perangkat patroli (12 set)', cost: 21_600_000, ago: 90, location: 'Pos komando' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 9_500_000 }, { code: '6-2000', monthly: 3_500_000 }, { code: '6-1000', monthly: 55_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await F.hubungkanPemilik(c, 'P-001');
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('GD-SENTRAL')!, ids.get('AD-PEMBERSIH')!, [
    { title: 'Kontrak keamanan & kebersihan kampus baru', company: 'Universitas Nusa Bangsa', contact: 'Pak Wahyu', value: 480_000_000, source: 'Tender' },
    { title: 'Kebersihan kawasan pergudangan', company: 'PT Logistik Prima', contact: 'Ibu Sari', value: 260_000_000, source: 'Referensi' },
    { title: 'Satpam apartemen 24 jam', company: 'PT Apartemen Cakra', contact: 'Pak Dodi', value: 390_000_000, source: 'Kunjungan' },
  ]);
  await X.stockOps(c, ids, ALIH_BAHAN.map((p) => p.sku), { billId: c.last.bill, supplierId: sup.get('SUP-KIMIA') });
  await F.minimums(c, [...ids.values()]);
  await F.employmentChange(c);
  await F.closePeriod(c);
}

// ---------------------------------------------------------------- BENGKEL / SALON (layanan di kasir)
const BENGKEL_SUKU: Prod[] = [
  { sku: 'BP-OLI', name: 'Oli Mesin 1L', cat: 'Suku cadang', price: 78_000, cost: 58_000, qty: 120, uom: 'BTL' },
  { sku: 'BP-FILTER', name: 'Filter Oli', cat: 'Suku cadang', price: 45_000, cost: 30_000, qty: 80, uom: 'PCS' },
  { sku: 'BP-KAMPAS', name: 'Kampas Rem (set)', cat: 'Suku cadang', price: 165_000, cost: 120_000, qty: 40, uom: 'SET' },
  { sku: 'BP-BUSI', name: 'Busi', cat: 'Suku cadang', price: 35_000, cost: 22_000, qty: 200, uom: 'PCS' },
  { sku: 'BP-AKI', name: 'Aki 12V 35Ah', cat: 'Suku cadang', price: 850_000, cost: 700_000, qty: 15, uom: 'UNIT' },
];
const BENGKEL_LAYANAN: [string, string, number][] = [
  ['BL-SERVIS', 'Servis berkala', 85_000], ['BL-OLI', 'Jasa ganti oli', 25_000], ['BL-TUNE', 'Tune up mesin', 150_000], ['BL-REM', 'Servis rem', 120_000], ['BL-BAL', 'Spooring & balancing', 180_000],
];

async function seedBengkel(c: Demo) {
  const { ids, value } = await stockItems(c, BENGKEL_SUKU);
  await openingBalance(c, { kas: 9_000_000, bank: 120_000_000, stockValue: value });
  const sup = await addSuppliers(c, [
    { code: 'SUP-PELUMAS', name: 'PT Pelumas Nusantara', term: 30 },
    { code: 'SUP-SPAREPART', name: 'Toko Suku Cadang Maju', term: 14 },
  ]);
  const cu = await addCustomers(c, [
    { code: 'FL-ARMADA', name: 'PT Armada Logistik Prima', address: 'Jl. Raya Bekasi, Jakarta Timur', term: 30 },
    { code: 'FL-ANTAR', name: 'CV Antar Cepat Ekspres', address: 'Jl. Kalimalang, Bekasi', term: 14 },
  ]);
  await payroll(c, [
    { code: 'B-001', name: 'Slamet Riyadi', title: 'Kepala Bengkel', dept: 'Bengkel', salary: 9_000_000, allowance: 800_000, ptkp: 'K/2' },
    { code: 'B-002', name: 'Tono Wibowo', title: 'Mekanik', dept: 'Bengkel', salary: 5_800_000, allowance: 400_000, ptkp: 'K/1' },
    { code: 'B-003', name: 'Usman Hidayat', title: 'Mekanik', dept: 'Bengkel', salary: 5_800_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'B-004', name: 'Vino Pratama', title: 'Mekanik', dept: 'Bengkel', salary: 5_500_000, allowance: 400_000, ptkp: 'TK/0' },
    { code: 'B-005', name: 'Winda Sari', title: 'Kasir & Administrasi', dept: 'Administrasi', salary: 5_200_000, allowance: 300_000, ptkp: 'TK/0' },
  ]);
  const mech = (await staffIds(c)).slice(1, 4);
  const svc: { id: string; price: number }[] = [];
  for (const [sku, name, price] of BENGKEL_LAYANAN) {
    const p = (await c.step(`layanan ${sku}`, () => c.svc.products.create(c.tenantId, { sku, name, baseUom: 'KALI', sellPrice: String(price), category: 'Layanan servis', isService: true }))) as { id: string } | undefined;
    if (p) svc.push({ id: p.id, price });
  }
  const parts = BENGKEL_SUKU.map((p) => ({ id: ids.get(p.sku)!, price: p.price }));
  const { withSimulatedDay } = await import('../../common/utils/dates');
  // transaksi kasir beberapa hari: layanan + suku cadang, petugas (mekanik) tercatat per baris
  for (const day of [9, 7, 5, 4, 2, 1]) {
    await withSimulatedDay(c.ago(day), async () => {
      const s = await c.svc.pos.open(c.admin, { warehouseId: c.wh, openingCash: '300000' });
      for (let i = 0; i < 4; i++) {
        const l1 = svc[(i + day) % svc.length];
        const l2 = svc[(i + day + 2) % svc.length];
        const part = parts[(i + day) % parts.length];
        const lines = [
          { productId: l1.id, qty: '1', price: String(l1.price), staffId: mech[(i + day) % mech.length] },
          ...(i % 2 ? [{ productId: l2.id, qty: '1', price: String(l2.price), staffId: mech[(i + day + 1) % mech.length] }] : []),
          { productId: part.id, qty: i % 3 === 0 ? '2' : '1', price: String(part.price) },
        ];
        const total = lines.reduce((a, l) => a + Number(l.price) * Number(l.qty), 0);
        await c.step('transaksi bengkel', () => c.svc.pos.createOrder(c.admin, { sessionId: s.id, lines, payments: [{ method: 'CASH', amount: String(Math.ceil((total * 1.11) / 10_000) * 10_000) }] }));
      }
      const cur = (await c.svc.pos.current(c.admin)) as { summary: { expectedCash: string } } | null;
      await c.svc.pos.close(c.admin, s.id, { countedCash: String(Number(cur?.summary.expectedCash ?? 300000)) });
    });
  }
  // servis armada pelanggan korporat ditagih lewat faktur jasa
  const fleet = (await c.step('servis armada', () =>
    c.svc.billing.createInvoice(c.admin, { customerId: cu.get('FL-ARMADA')!, date: c.ago(30), description: 'Servis berkala armada (18 unit)', termLabel: 'Bulanan', withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: 'Servis berkala & ganti oli armada (18 unit)', qty: '18', unit: 'Unit', price: '350000' }] }),
  )) as { id: string } | undefined;
  if (fleet) await c.step('bayar servis armada', () => receive(c, fleet.id, 9, 'TRANSFER', 0.98));
  await c.step('servis armada 2', () =>
    c.svc.billing.createInvoice(c.admin, { customerId: cu.get('FL-ANTAR')!, date: c.ago(14), description: 'Servis rem & tune up (6 unit)', termLabel: 'Paket', lines: [{ description: 'Servis rem & tune up (6 unit)', qty: '6', unit: 'Unit', price: '420000' }] }),
  );
  await purchase(c, sup.get('SUP-PELUMAS')!, 40, [{ productId: ids.get('BP-OLI')!, qty: 60, price: 59_000 }, { productId: ids.get('BP-FILTER')!, qty: 40, price: 31_000 }], { pay: true, invoiceNo: 'PLN-3301' });
  await purchase(c, sup.get('SUP-SPAREPART')!, 12, [{ productId: ids.get('BP-KAMPAS')!, qty: 20, price: 121_000 }, { productId: ids.get('BP-AKI')!, qty: 6, price: 705_000 }], { invoiceNo: 'TSM-8810' });
  await expense(c, 55, 'bank', '6-3000', 'Sewa tempat bengkel', 10_000_000, 'SEWA-BKL');
  await expense(c, 28, 'bank', '6-4000', 'Listrik, air & internet bengkel', 3_300_000);
  await expense(c, 15, 'kas', '6-6000', 'Perlengkapan bengkel & limbah oli', 1_150_000, 'NOTA-1015');
  await X.monthlyOps(c, [
    { code: '6-3000', desc: 'Sewa tempat bengkel', amount: 10_000_000, from: 'bank', day: 2 },
    { code: '6-4000', desc: 'Listrik, air & internet bengkel', amount: 3_300_000, from: 'bank', day: 10 },
  ]);
  await X.cashMovements(c);
  await X.fixedAssets(c, 'SUP-SPAREPART', [
    { cat: 'Inventaris', name: 'Lift hidrolik kendaraan (2 unit)', cost: 48_000_000, ago: 100, location: 'Area servis' },
    { cat: 'Inventaris', name: 'Kompresor & alat scan OBD', cost: 26_500_000, ago: 88, location: 'Area servis' },
  ]);
  await X.journals(c);
  await X.budget(c, [{ code: '6-3000', monthly: 10_000_000 }, { code: '6-4000', monthly: 3_500_000 }, { code: '6-1000', monthly: 33_000_000 }]);
  await X.taxes(c);
  await X.bankStatement(c);
  await X.pettyCash(c);
  await F.hubungkanPemilik(c, 'B-001');
  await X.cashCount(c);
  await X.attendance(c);
  await X.crm(c, cu.get('FL-ARMADA')!, ids.get('BP-OLI')!, [
    { title: 'Kontrak servis armada tahunan', company: 'PT Armada Logistik Prima', contact: 'Pak Teguh', value: 220_000_000, source: 'Klien lama' },
    { title: 'Paket servis karyawan perusahaan', company: 'PT Mitra Industri', contact: 'Ibu Nia HRD', value: 84_000_000, source: 'Kunjungan' },
  ]);
  await X.stockOps(c, ids, BENGKEL_SUKU.map((p) => p.sku), { billId: c.last.bill, supplierId: sup.get('SUP-SPAREPART') });
  await F.priceAgreements(c, [{ supplierId: sup.get('SUP-PELUMAS')!, productId: ids.get('BP-OLI')!, price: 58_500 }]);
  await F.minimums(c, [...ids.values()]);
  await F.employmentChange(c);
  await F.closePeriod(c);
}
