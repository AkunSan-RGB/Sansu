/**
 * Simulasi operasional perusahaan demo dari 1 Januari sampai hari ini, lewat service aplikasi
 * (bukan insert mentah) sehingga semua dokumen, kartu stok, dan jurnalnya konsisten:
 * pembelian & pembayaran supplier, penjualan B2B & pelunasan, kasir toko, marketplace + pencairan,
 * biaya operasional, sewa dibayar dimuka + amortisasi berulang, aset tetap & penyusutan,
 * absensi, cuti & penggajian (THR Lebaran), setoran pajak & BPJS, impor mutasi bank + rekonsiliasi,
 * retur, dan kunci periode.
 */
import { INestApplicationContext } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, DocDate, withSimulatedDay } from '../../common/utils/dates';
import { AccountingService } from '../../modules/accounting/accounting.service';
import { AssetsService } from '../../modules/assets/assets.service';
import { BankService } from '../../modules/bank/bank.service';
import { CashService } from '../../modules/cash/cash.service';
import { HrService } from '../../modules/hr/hr.service';
import { IntegrationsService } from '../../modules/integrations/integrations.service';
import { InventoryService } from '../../modules/inventory/inventory.service';
import { CustomersService } from '../../modules/master-data/customers/customers.service';
import { ProductsService } from '../../modules/master-data/products/products.service';
import { PayrollService } from '../../modules/payroll/payroll.service';
import { PosService } from '../../modules/pos/pos.service';
import { documentTotals } from '../../modules/sales/pricing';
import { PurchaseInvoicesService } from '../../modules/purchasing/purchase-invoices.service';
import { PurchaseOrdersService } from '../../modules/purchasing/purchase-orders.service';
import { ReturnsService } from '../../modules/returns/returns.service';
import { InvoicesService } from '../../modules/sales/invoices/invoices.service';
import { SalesOrdersService } from '../../modules/sales/orders/sales-orders.service';
import { PaymentsService } from '../../modules/sales/payments/payments.service';
import { TaxService } from '../../modules/tax/tax.service';
import { Db } from '../db';
import { accounts, assetCategories, employees, fixedAssets, journalEntries, journalLines, suppliers, tenants, users, warehouses } from '../schema';
import { asDto } from '../../common/utils/dto';

type User = AuthUser;
type App = INestApplicationContext;

// ---------- Data induk ----------
const PRODUCTS = [
  { sku: 'MIE-GRG-85', name: 'Mi Goreng 85g', category: 'Makanan', price: 3700, cost: 2900, dus: 40, sup: 'SUP-PANGAN', q: [6, 30] },
  { sku: 'MIE-SOTO-75', name: 'Mi Kuah Soto 75g', category: 'Makanan', price: 3500, cost: 2750, dus: 40, sup: 'SUP-PANGAN', q: [4, 20] },
  { sku: 'MIE-AYAM-70', name: 'Mi Kuah Ayam Bawang 70g', category: 'Makanan', price: 3500, cost: 2750, dus: 40, sup: 'SUP-PANGAN', q: [4, 18] },
  { sku: 'KOPI-SAC-20', name: 'Kopi Sachet 20g', category: 'Minuman', price: 1600, cost: 1150, dus: 120, sup: 'SUP-MINUM', q: [3, 15] },
  { sku: 'KOPI-SUSU-30', name: 'Kopi Susu 3in1 30g', category: 'Minuman', price: 1900, cost: 1400, dus: 120, sup: 'SUP-MINUM', q: [3, 12] },
  { sku: 'TEH-BTL-350', name: 'Teh Botol 350ml', category: 'Minuman', price: 4800, cost: 3600, dus: 24, sup: 'SUP-MINUM', q: [5, 25] },
  { sku: 'AIR-600', name: 'Air Mineral 600ml', category: 'Minuman', price: 3700, cost: 2600, dus: 24, sup: 'SUP-MINUM', q: [10, 40] },
  { sku: 'SUSU-KTL-370', name: 'Susu Kental Manis 370g', category: 'Minuman', price: 14400, cost: 11200, dus: 48, sup: 'SUP-MINUM', q: [1, 6] },
  { sku: 'SBN-CAIR-800', name: 'Sabun Cair Refill 800ml', category: 'Rumah Tangga', price: 22500, cost: 17500, dus: 12, sup: 'SUP-RUMAH', q: [2, 12] },
  { sku: 'DTG-BUBUK-800', name: 'Deterjen Bubuk 800g', category: 'Rumah Tangga', price: 20900, cost: 16000, dus: 12, sup: 'SUP-RUMAH', q: [2, 12] },
  { sku: 'PSTA-GIGI-190', name: 'Pasta Gigi 190g', category: 'Rumah Tangga', price: 13400, cost: 10200, dus: 24, sup: 'SUP-RUMAH', q: [1, 8] },
  { sku: 'MNYK-2L', name: 'Minyak Goreng 2L', category: 'Sembako', price: 38500, cost: 32000, dus: 6, sup: 'SUP-PANGAN', q: [5, 30] },
  { sku: 'GULA-1KG', name: 'Gula Pasir 1kg', category: 'Sembako', price: 19800, cost: 16800, dus: 20, sup: 'SUP-PANGAN', q: [2, 15] },
  { sku: 'BRS-5KG', name: 'Beras Premium 5kg', category: 'Sembako', price: 83500, cost: 71000, dus: 4, sup: 'SUP-PANGAN', q: [3, 20] },
] as const;

const GOODS_SUPPLIERS = [
  { code: 'SUP-PANGAN', name: 'PT Sumber Pangan Prima', term: 30, npwp: '02.111.222.3-404.000' },
  { code: 'SUP-MINUM', name: 'PT Segar Minuman Nusantara', term: 30, npwp: '02.222.333.4-405.000' },
  { code: 'SUP-RUMAH', name: 'CV Rumah Tangga Jaya', term: 14, npwp: '02.333.444.5-406.000' },
];
const SERVICE_SUPPLIERS = [
  { code: 'SUP-PROPERTI', name: 'PT Graha Properti Bekasi', term: 14 },
  { code: 'SUP-AUTO', name: 'PT Auto Niaga Motor', term: 30 },
  { code: 'SUP-TEKNIK', name: 'CV Jasa Teknik Mandiri', term: 14 },
  { code: 'SUP-KOMPUTER', name: 'Toko Komputer Jaya', term: 7 },
];

const CUSTOMERS = [
  { code: 'TK-SUMBER', name: 'Toko Sumber Rejeki', address: 'Jl. Pasar Baru 12, Bekasi', term: 30, limit: '0', npwp: '03.456.789.0-123.000', cash: false, w: 3, late: 0 },
  { code: 'MM-SEJAHTERA', name: 'Minimarket Sejahtera', address: 'Ruko Harapan Indah B3, Bekasi', term: 30, limit: '0', npwp: '03.567.890.1-124.000', cash: false, w: 3, late: 0 },
  { code: 'GRS-ABADI', name: 'Grosir Abadi', address: 'Jl. Raya Narogong km 7, Bekasi', term: 30, limit: '0', npwp: '03.678.901.2-125.000', cash: false, w: 3, late: 3 },
  { code: 'KOP-SINAR', name: 'Koperasi Karyawan PT Sinar', address: 'Kawasan Industri MM2100, Cikarang', term: 30, limit: '0', npwp: '03.789.012.3-126.000', cash: false, w: 2, late: 0 },
  { code: 'MM-BERKAH', name: 'Minimarket Berkah Mart', address: 'Jl. Ahmad Yani 45, Bekasi', term: 30, limit: '0', npwp: null, cash: false, w: 2, late: 0 },
  { code: 'TK-MAKMUR', name: 'Toko Makmur Jaya', address: 'Jl. Raya Bogor km 25', term: 14, limit: '40000000', npwp: null, cash: false, w: 2, late: 0 },
  { code: 'TK-BAROKAH', name: 'Toko Barokah', address: 'Pasar Kranji Blok C/12', term: 14, limit: '25000000', npwp: null, cash: true, w: 2, late: 9 },
  { code: 'WRG-BUDE', name: 'Warung Bu De', address: 'Gg. Melati 3, Bekasi Timur', term: 7, limit: '6000000', npwp: null, cash: true, w: 1, late: 0 },
];

const EMPLOYEES = [
  { code: 'EMP-001', name: 'Andi Pratama', ptkp: 'K/1', jobTitle: 'Kepala Gudang', department: 'Gudang', joinDate: '2023-03-01', baseSalary: '6500000', fixedAllowance: '750000', dailyAllowance: '35000', bankName: 'BCA', bankAccount: '1234567890' },
  { code: 'EMP-002', name: 'Siti Rahmawati', ptkp: 'TK/0', jobTitle: 'Admin Keuangan', department: 'Keuangan', joinDate: '2024-06-17', baseSalary: '5500000', fixedAllowance: '500000', dailyAllowance: '30000', bankName: 'Mandiri', bankAccount: '1300012345678' },
  { code: 'EMP-003', name: 'Budi Santoso', ptkp: 'K/2', jobTitle: 'Sales Lapangan', department: 'Penjualan', joinDate: '2022-01-10', baseSalary: '5000000', fixedAllowance: '1000000', dailyAllowance: '40000', bankName: 'BRI', bankAccount: '002301000123456' },
  { code: 'EMP-004', name: 'Dewi Lestari', ptkp: 'TK/0', jobTitle: 'Kasir Toko', department: 'Toko', joinDate: '2025-02-03', baseSalary: '4200000', fixedAllowance: '0', dailyAllowance: '25000', bankName: 'BCA', bankAccount: '9876543210' },
  { code: 'EMP-005', name: 'Rudi Hartono', ptkp: 'K/1', jobTitle: 'Sopir Pengiriman', department: 'Gudang', joinDate: '2024-01-08', baseSalary: '4600000', fixedAllowance: '300000', dailyAllowance: '45000', bankName: 'BRI', bankAccount: '002301000654321' },
  { code: 'EMP-006', name: 'Fajar Nugroho', ptkp: 'TK/0', jobTitle: 'Helper Gudang', department: 'Gudang', joinDate: '2025-07-01', baseSalary: '4300000', fixedAllowance: '0', dailyAllowance: '30000', bankName: 'BNI', bankAccount: '0412345678' },
] as const;

/** Ramadan 2026 ± 18 Feb – 19 Mar, Idulfitri 20–21 Mar */
const demandFactor = (d: DocDate) => {
  if (d >= '2026-02-10' && d <= '2026-03-17') return 1.55;
  if (d >= '2026-03-18' && d <= '2026-03-24') return 0.25;
  if (d >= '2026-03-25' && d <= '2026-04-05') return 0.75;
  if (d.slice(5, 7) === '12') return 1.25;
  return 1;
};
const HOLIDAYS = new Set(['2026-01-01', '2026-02-17', '2026-03-19', '2026-03-20', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-14', '2026-05-27', '2026-06-01', '2026-08-17']);

// ---------- Utilitas ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dow = (d: DocDate) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Minggu
const lastDay = (d: DocDate) => {
  const [y, m] = d.split('-').map(Number);
  return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const prevPeriod = (d: DocDate) => addDays(`${d.slice(0, 7)}-01`, -1).slice(0, 7);
const r100 = (n: number) => Math.round(n / 100) * 100;
const r1000 = (n: number) => Math.round(n / 1000) * 1000;

export async function simulateDemoYear(app: App, db: Db, admin: AuthUser, log: (m: string) => void) {
  const R = rng(20260101);
  const rint = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(R() * arr.length)];
  const chance = (p: number) => R() < p;
  const tenantId = admin.tenantId;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const start = '2026-01-02';
  if (today < start) return;

  const svc = {
    products: app.get(ProductsService),
    customers: app.get(CustomersService),
    inventory: app.get(InventoryService),
    accounting: app.get(AccountingService),
    assets: app.get(AssetsService),
    po: app.get(PurchaseOrdersService),
    pi: app.get(PurchaseInvoicesService),
    so: app.get(SalesOrdersService),
    inv: app.get(InvoicesService),
    pay: app.get(PaymentsService),
    pos: app.get(PosService),
    cash: app.get(CashService),
    hr: app.get(HrService),
    payroll: app.get(PayrollService),
    tax: app.get(TaxService),
    bank: app.get(BankService),
    mp: app.get(IntegrationsService),
    returns: app.get(ReturnsService),
    settings: app.get(SettingsService),
  };
  const asUser = async (email: string): Promise<User> => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return u ? { sub: u.id, tenantId: u.tenantId, role: u.role, email: u.email } : admin;
  };
  const cashier = await asUser('kasir@demo.id');
  const quiet = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      if (process.env.DEMO_DEBUG) log(`  · lewati ${label}: ${(e as Error).message}`);
      return undefined;
    }
  };

  // ---------- Perusahaan ----------
  await db
    .update(tenants)
    .set({ npwp: '01.234.567.8-901.000', address: 'Jl. Industri Raya No. 8, Kawasan Pergudangan Bekasi, Jawa Barat 17112', ppnRate: '11' })
    .where(eq(tenants.id, tenantId));
  await svc.settings.saveReporting(db, tenantId, {
    framework: 'SAK_EP',
    legalForm: 'CV',
    businessActivity: 'distribusi dan perdagangan besar barang kebutuhan sehari-hari (makanan, minuman, sembako, dan perlengkapan rumah tangga)',
    establishedYear: 2020,
    city: 'Bekasi',
    directorName: 'Admin Demo',
    directorTitle: 'Direktur',
    taxScheme: 'GENERAL',
  });

  const acc = new Map((await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))).map((a) => [a.code, a.id]));
  const A = (code: string) => acc.get(code)!;
  const kas = A('1-1100');
  const bank = A('1-1200');
  const [wh] = await db.select().from(warehouses).where(eq(warehouses.tenantId, tenantId));

  // ---------- Master data ----------
  const prodId = new Map<string, string>();
  for (const [i, p] of PRODUCTS.entries()) {
    const created = await svc.products.create(tenantId, asDto({
      sku: p.sku,
      name: p.name,
      category: p.category,
      baseUom: 'PCS',
      sellPrice: String(p.price),
      barcode: `899100${String(i + 1).padStart(7, '0')}`,
      uoms: [{ uom: 'DUS', factor: String(p.dus) }],
    }));
    prodId.set(p.sku, created.id);
  }
  const supId = new Map<string, string>();
  for (const s of [...GOODS_SUPPLIERS, ...SERVICE_SUPPLIERS]) {
    const [row] = await db
      .insert(suppliers)
      .values({ tenantId, code: s.code, name: s.name, paymentTermDays: s.term, npwp: 'npwp' in s ? (s.npwp as string) : null, phone: '021-555-0' + String(supId.size + 101) })
      .returning();
    supId.set(s.code, row.id);
  }
  const custId = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const created = await svc.customers.create(tenantId, asDto({
      code: c.code,
      name: c.name,
      address: c.address,
      phone: `0812-${rint(1000, 9999)}-${rint(1000, 9999)}`,
      creditLimit: c.limit,
      paymentTermDays: c.term,
      npwp: c.npwp ?? undefined,
    }));
    custId.set(c.code, created.id);
  }
  const emp = await db
    .insert(employees)
    .values(EMPLOYEES.map((e) => ({ ...e, tenantId })))
    .returning();

  // ---------- Saldo awal 31 Desember 2025 ----------
  const stock = new Map<string, number>(); // pcs
  const SO_PER_DAY = 2.2;
  const avgDaily = (p: (typeof PRODUCTS)[number]) => ((p.q[0] + p.q[1]) / 2) * p.dus * 0.3 * (SO_PER_DAY / 1.25) + 6;
  let invValue = 0;
  const openingLines = PRODUCTS.map((p) => {
    const qty = Math.round((avgDaily(p) * 40) / p.dus) * p.dus;
    stock.set(p.sku, qty);
    invValue += qty * p.cost;
    return { productId: prodId.get(p.sku)!, qty: String(qty), unitCost: String(p.cost) };
  });
  await svc.inventory.adjust(admin, { warehouseId: wh.id, reason: 'OPENING', date: '2025-12-31', notes: 'Saldo awal stok mulai memakai SANSU', lines: openingLines });
  const pickupCost = 165_000_000;
  const pickupAccum = 37_812_500;
  const modal = 900_000_000;
  const kasOpen = 15_000_000;
  const bankOpen = 780_000_000;
  const retained = kasOpen + bankOpen + pickupCost - pickupAccum + invValue - modal;
  await svc.accounting.openingBalance(admin, asDto({
    date: '2025-12-31',
    lines: [
      { accountId: kas, debit: String(kasOpen), credit: '0' },
      { accountId: bank, debit: String(bankOpen), credit: '0' },
      { accountId: A('1-2100'), debit: String(pickupCost), credit: '0' },
      { accountId: A('1-2900'), debit: '0', credit: String(pickupAccum) },
      { accountId: A('3-9000'), debit: String(invValue), credit: '0' },
      { accountId: A('3-1000'), debit: '0', credit: String(modal) },
      { accountId: A('3-2000'), debit: '0', credit: String(retained) },
    ],
  }));
  const cats = new Map((await db.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId))).map((c) => [c.name, c.id]));
  const pickup = await svc.assets.create(admin, asDto({
    name: 'Mobil pickup Grand Max B 9512 KX',
    categoryId: cats.get('Kendaraan')!,
    acquisitionDate: '2024-03-01',
    depreciationStart: '2026-01-01',
    cost: String(pickupCost),
    funding: 'EXISTING',
    openingAccumulated: String(pickupAccum),
    location: 'Gudang utama',
  }));
  await db.update(fixedAssets).set({ openingFiscalAccumulated: String(pickupAccum) }).where(eq(fixedAssets.id, pickup.id));

  // Jurnal berulang: amortisasi sewa gudang dibayar dimuka
  await svc.accounting.createRecurring(admin, asDto({
    name: 'Amortisasi sewa gudang',
    description: 'Amortisasi sewa gudang dibayar dimuka (1/12)',
    frequency: 'MONTHLY',
    nextDate: '2026-01-31',
    remaining: 12,
    isAdjustment: true,
    lines: [
      { accountId: A('6-3000'), debit: '12000000', credit: '0' },
      { accountId: A('1-1700'), debit: '0', credit: '12000000' },
    ],
  }));

  // ---------- Antrean kejadian ----------
  type Ev = { date: DocDate; run: () => Promise<unknown>; label: string };
  const queue: Ev[] = [];
  const later = (date: DocDate, label: string, run: () => Promise<unknown>) => queue.push({ date, label, run });
  const onOrder = new Map<string, number>(); // pcs dalam perjalanan
  const sold30: { date: DocDate; sku: string; qty: number }[] = [];
  const bankBalance = async () => Number((await svc.cash.accounts(tenantId)).find((a: { id: string }) => a.id === bank)?.balance ?? 0);
  const kasBalance = async () => Number((await svc.cash.accounts(tenantId)).find((a: { id: string }) => a.id === kas)?.balance ?? 0);

  const paySupplier = (invId: string, due: DocDate, attempt = 0): void => {
    later(due, 'bayar supplier', async () => {
      const inv = await svc.pi.get(tenantId, invId);
      const out = Number(inv.total) - Number(inv.paidAmount) - Number(inv.returnedAmount);
      if (out <= 0) return;
      if ((await bankBalance()) < out + 25_000_000 && attempt < 6) return paySupplier(invId, addDays(due, 4), attempt + 1);
      await svc.pi.pay(admin, { purchaseInvoiceId: invId, amount: out.toFixed(2), cashAccountId: bank, date: due });
    });
  };

  const bill = async (date: DocDate, supplier: string, no: string, dto: object) => {
    const r = await svc.pi.createBill(admin, asDto({ supplierId: supId.get(supplier)!, supplierInvoiceNo: no, date, ...dto }));
    const term = [...GOODS_SUPPLIERS, ...SERVICE_SUPPLIERS].find((s) => s.code === supplier)!.term;
    paySupplier(r.id, addDays(date, term - rint(0, 2)));
    return r;
  };

  let invSeq = 0;
  const restock = async (d: DocDate) => {
    for (const s of GOODS_SUPPLIERS) {
      const lines = PRODUCTS.filter((p) => p.sup === s.code)
        .map((p) => {
          const recent = sold30.filter((x) => x.sku === p.sku && x.date > addDays(d, -30)).reduce((a, x) => a + x.qty, 0);
          const daily = Math.max(recent / 30, avgDaily(p) * 0.6);
          const have = (stock.get(p.sku) ?? 0) + (onOrder.get(p.sku) ?? 0);
          if (have >= daily * 18) return null;
          const dus = Math.ceil((daily * 40 - have) / p.dus);
          return dus > 0 ? { p, dus } : null;
        })
        .filter(Boolean) as { p: (typeof PRODUCTS)[number]; dus: number }[];
      if (!lines.length) continue;
      const po = await svc.po.create(admin, asDto({
        supplierId: supId.get(s.code)!,
        warehouseId: wh.id,
        date: d,
        lines: lines.map((l) => ({ productId: prodId.get(l.p.sku)!, uom: 'DUS', qty: String(l.dus), price: String(r100(l.p.cost * l.p.dus * (1 + (R() - 0.5) * 0.03))) })),
      }));
      await svc.po.confirm(admin, po.id);
      for (const l of lines) onOrder.set(l.p.sku, (onOrder.get(l.p.sku) ?? 0) + l.dus * l.p.dus);
      const arrive = addDays(d, rint(1, 3));
      later(arrive, 'terima barang', async () => {
        invSeq++;
        const inv = await svc.pi.createFromOrder(admin, { purchaseOrderId: po.id, supplierInvoiceNo: `${s.code.slice(4, 7)}/${arrive.slice(2, 4)}${arrive.slice(5, 7)}/${String(invSeq).padStart(4, '0')}`, date: arrive });
        for (const l of lines) {
          stock.set(l.p.sku, (stock.get(l.p.sku) ?? 0) + l.dus * l.p.dus);
          onOrder.set(l.p.sku, (onOrder.get(l.p.sku) ?? 0) - l.dus * l.p.dus);
        }
        paySupplier(inv.id, addDays(arrive, s.term - rint(0, 3)));
      });
    }
  };

  const salesOrder = async (d: DocDate) => {
    const c = pick(CUSTOMERS.flatMap((x) => Array(x.w).fill(x)) as (typeof CUSTOMERS)[number][]);
    const f = demandFactor(d);
    const lines = [...PRODUCTS]
      .sort(() => R() - 0.5)
      .slice(0, rint(2, 6))
      .map((p) => {
        const want = Math.max(1, Math.round(rint(p.q[0], p.q[1]) * f * (c.w === 1 ? 0.25 : c.w === 2 ? 0.7 : 1)));
        const can = Math.floor((stock.get(p.sku) ?? 0) / p.dus);
        return { p, dus: Math.min(want, can) };
      })
      .filter((l) => l.dus > 0);
    if (!lines.length) return;
    const so = await quiet('SO', () =>
      svc.so.create(admin, asDto({ customerId: custId.get(c.code)!, warehouseId: wh.id, date: d, lines: lines.map((l) => ({ productId: prodId.get(l.p.sku)!, uom: 'DUS', qty: String(l.dus) })) })),
    );
    if (!so) return;
    const ok = await quiet(`konfirmasi ${c.name}`, () => svc.so.confirm(admin, so.id));
    if (!ok) {
      await quiet('batal SO', () => svc.so.cancel(admin, so.id));
      return;
    }
    // stok langsung dicadangkan agar order berikutnya di hari yang sama tidak melebihi stok
    for (const l of lines) stock.set(l.p.sku, (stock.get(l.p.sku) ?? 0) - l.dus * l.p.dus);
    const invoiceDate = chance(0.8) ? d : addDays(d, 1);
    const makeInvoice = async () => {
      let inv;
      try {
        inv = await svc.inv.createFromOrder(admin, { salesOrderId: so.id, date: invoiceDate });
      } catch (e) {
        for (const l of lines) stock.set(l.p.sku, (stock.get(l.p.sku) ?? 0) + l.dus * l.p.dus);
        await quiet('batal SO', () => svc.so.cancel(admin, so.id));
        throw e;
      }
      for (const l of lines) sold30.push({ date: invoiceDate, sku: l.p.sku, qty: l.dus * l.p.dus });
      // Pelunasan: sebagian besar sebelum jatuh tempo; Toko Barokah & Grosir Abadi kadang telat
      const payDay = addDays(invoiceDate, c.term - rint(0, Math.min(10, c.term - 1)) + (c.late && chance(0.5) ? rint(1, c.late) : 0));
      const invId = inv.id;
      later(payDay, 'pelunasan', async () => {
        const cur = await svc.inv.get(tenantId, invId);
        const out = Number(cur.total) - Number(cur.paidAmount) - Number(cur.returnedAmount);
        if (out <= 0) return;
        await svc.pay.create(admin, {
          invoiceId: invId,
          amount: out.toFixed(2),
          date: payDay,
          method: c.cash ? 'CASH' : 'TRANSFER',
          cashAccountId: c.cash ? kas : bank,
        });
      });
    };
    if (invoiceDate === d) await quiet('faktur', makeInvoice);
    else later(invoiceDate, 'faktur', makeInvoice);
  };

  const posDay = async (d: DocDate) => {
    await withSimulatedDay(d, async () => {
      const s = await svc.pos.open(cashier as never, { warehouseId: wh.id, openingCash: '500000' });
      const n = rint(4, 9);
      for (let i = 0; i < n; i++) {
        const lines = [...PRODUCTS]
          .sort(() => R() - 0.5)
          .slice(0, rint(1, 4))
          .map((p) => ({ p, qty: Math.min(rint(1, p.dus >= 24 ? 12 : 4), Math.max(0, (stock.get(p.sku) ?? 0) - p.dus)) }))
          .filter((l) => l.qty > 0);
        if (!lines.length) continue;
        const total = Number(documentTotals(lines.map((l) => ({ qty: l.qty, price: l.p.price })), 11).total);
        const qris = chance(0.4);
        const o = await quiet('POS', () =>
          svc.pos.createOrder(cashier as never, asDto({
            sessionId: s.id,
            lines: lines.map((l) => ({ productId: prodId.get(l.p.sku)!, qty: String(l.qty) })),
            payments: [{ method: qris ? 'QRIS' : 'CASH', amount: String(qris ? total.toFixed(2) : Math.ceil(total / 5000) * 5000) }],
          })),
        );
        if (o) for (const l of lines) stock.set(l.p.sku, (stock.get(l.p.sku) ?? 0) - l.qty);
      }
      const cur = (await svc.pos.current(cashier as never)) as { summary: { expectedCash: string } } | null;
      const expected = Number(cur?.summary.expectedCash ?? 500000);
      await svc.pos.close(cashier as never, s.id, { countedCash: String(chance(0.12) ? expected - pick([2000, 5000, 10000]) : expected) });
    });
  };

  const marketplaceWeek = async (d: DocDate) => {
    const orders = Array.from({ length: rint(5, 12) }, (_, i) => {
      const od = [addDays(d, -rint(1, 7)), start].sort()[1];
      return {
        orderNo: `26${od.slice(5, 7)}${od.slice(8, 10)}${String.fromCharCode(65 + rint(0, 25))}${String.fromCharCode(65 + rint(0, 25))}${rint(1000, 9999)}${i}`,
        date: od,
        lines: [...PRODUCTS]
          .filter((p) => p.price < 40000)
          .sort(() => R() - 0.5)
          .slice(0, rint(1, 2))
          .map((p) => ({ sku: p.sku, qty: String(rint(2, 12)), price: String((r100(p.price * 1.06) / 100) * 111) })),
      };
    });
    const r = await svc.mp.importMarketplace(admin, { channel: 'Shopee', warehouseId: wh.id, pricesIncludeVat: true, orders });
    for (const o of orders.filter((x) => r.imported.some((i) => i.orderNo === x.orderNo)))
      for (const l of o.lines) {
        stock.set(l.sku, (stock.get(l.sku) ?? 0) - Number(l.qty));
        sold30.push({ date: o.date, sku: l.sku, qty: Number(l.qty) });
      }
  };

  const marketplacePayout = async (d: DocDate) => {
    const rows = await svc.mp.marketplaceOrders(tenantId, 'Shopee');
    const open = rows.filter((o) => o.status !== 'PAID' && o.date <= addDays(d, -3));
    if (!open.length) return;
    const gross = open.reduce((a, o) => a + Number(o.total) - Number(o.paidAmount ?? 0), 0);
    await svc.mp.settle(admin, { channel: 'Shopee', date: d, cashAccountId: bank, amount: String(Math.round(gross * (1 - 0.045 - R() * 0.01))), orderNos: open.map((o) => o.orderNo) });
  };

  const attendance = async (d: DocDate, onLeave: Map<string, Set<string>>) => {
    const rows = emp
      .filter((e) => !onLeave.get(d)?.has(e.id))
      .map((e) => {
        const x = R();
        const status = x < 0.015 ? 'SAKIT' : x < 0.025 ? 'IZIN' : 'HADIR';
        return {
          employeeId: e.id,
          status,
          checkIn: status === 'HADIR' ? `0${rint(7, 8)}:${String(rint(0, 59)).padStart(2, '0')}` : undefined,
          checkOut: status === 'HADIR' ? `1${rint(7, 8)}:${String(rint(0, 59)).padStart(2, '0')}` : undefined,
          overtimeHours: status === 'HADIR' && (dow(d) === 6 || demandFactor(d) > 1.2) && chance(0.35) ? String(rint(1, 3)) : '0',
        };
      });
    if (rows.length) await svc.hr.saveAttendance(admin, asDto({ date: d, rows }));
  };

  const payroll = async (period: string, payDate: DocDate) => {
    const run = (await svc.payroll.createRun(admin, { period, payDate })) as { id: string; payslips: { id: string; employeeId: string }[] };
    if (period === '2026-03') {
      // THR Idulfitri 1 bulan gaji
      for (const p of run.payslips) {
        const e = emp.find((x) => x.id === p.employeeId)!;
        const months = Math.min(12, Math.max(1, Math.round((Date.parse('2026-03-13') - Date.parse(e.joinDate)) / (30.4 * 86400000))));
        const thr = Math.round(((Number(e.baseSalary) + Number(e.fixedAllowance)) * months) / 12);
        await svc.payroll.updatePayslip(admin, p.id, { otherIncome: String(thr), notes: 'THR Idulfitri 1447 H' });
      }
    }
    await svc.payroll.post(admin, run.id);
    await svc.payroll.pay(admin, run.id, { cashAccountId: bank, date: payDate });
  };

  const taxes = async (d: DocDate, types: string[]) => {
    const period = prevPeriod(d);
    const obs = await svc.tax.obligations(tenantId, period);
    for (const o of obs.filter((x) => types.includes(x.type))) {
      const vatComp = o.type === 'PPN' && Number(o.detail?.ppnKeluaran ?? 0) > 0;
      if (Number(o.outstanding) <= 0 && !vatComp) continue;
      const billing = `${rint(1, 9)}${String(rint(0, 99999999)).padStart(8, '0')}${String(rint(0, 999999)).padStart(6, '0')}`;
      await quiet(`pajak ${o.type}`, () =>
        svc.tax.create(admin, asDto({
          type: o.type,
          period: o.period,
          date: d,
          cashAccountId: bank,
          billingCode: billing,
          ntpn: Number(o.outstanding) > 0 ? `${billing.slice(0, 4)}${Math.floor(R() * 1e12).toString(36).toUpperCase()}`.slice(0, 16).padEnd(16, '0') : undefined,
        })),
      );
    }
  };

  // Mutasi bank: dari transaksi bank di buku (sebagian dicatat bank sehari kemudian) + biaya admin & bunga
  const fed = new Set<string>();
  const carry: { date: DocDate; description: string; amount: number; lineId: string }[] = [];
  let bankRunning = bankOpen;
  const bankStatement = async (d: DocDate) => {
    const period = prevPeriod(d);
    const from = `${period}-01`;
    const to = lastDay(from);
    const rows = await db
      .select({ id: journalLines.id, debit: journalLines.debit, credit: journalLines.credit, date: journalEntries.date, source: journalEntries.sourceType, description: journalEntries.description, reference: journalEntries.reference })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalId))
      .where(and(eq(journalLines.accountId, bank), eq(journalEntries.tenantId, tenantId), sql`${journalEntries.date} <= ${to}`, sql`${journalEntries.sourceType} NOT IN ('OPENING', 'BANK', 'CLOSING')`));
    for (const r of rows) {
      if (fed.has(r.id)) continue;
      fed.add(r.id);
      const amount = Number(r.debit) - Number(r.credit);
      const party = r.description.split(' - ')[1]?.split(' (')[0]?.toUpperCase() ?? '';
      const desc =
        r.source === 'PAYMENT' && r.description.startsWith('Pencairan')
          ? `SHOPEE PAYOUT ${r.date.replace(/-/g, '')}`
          : r.source === 'PAYMENT'
            ? `TRSF E-BANKING CR ${party}`
            : r.source === 'SUPPLIER_PAYMENT'
              ? `TRSF E-BANKING DB ${party}`
              : r.source === 'TRANSFER'
                ? 'SETORAN TUNAI'
                : r.source === 'PAYROLL_PAYMENT'
                  ? 'PAYROLL GAJI KARYAWAN'
                  : r.source === 'TAX_PAYMENT'
                    ? `MPN PEMBAYARAN PAJAK ${r.reference ?? ''}`.trim()
                    : r.source === 'POS'
                      ? 'QRIS MERCHANT SETTLEMENT'
                      : `DB ${r.description.toUpperCase().slice(0, 40)}`;
      const late = (r.source === 'SUPPLIER_PAYMENT' || r.source === 'PAYMENT') && r.date >= addDays(to, -1);
      carry.push({ date: late ? addDays(r.date, 1) : r.date, description: desc, amount, lineId: r.id });
    }
    const lines = carry.filter((c) => c.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    for (const l of lines) carry.splice(carry.indexOf(l), 1);
    const interest = r100(Math.max(0, bankRunning) * (0.0025 / 12) * 0.8);
    const all = [
      ...lines.map((l) => ({ date: l.date, description: l.description, amount: l.amount })),
      { date: to, description: 'BIAYA ADM BULANAN', amount: -15000 },
      ...(interest > 0 ? [{ date: to, description: 'BUNGA JASA GIRO NETTO', amount: interest }] : []),
    ];
    const out = all.map((l) => {
      bankRunning += l.amount;
      return { date: l.date, description: l.description, amount: l.amount.toFixed(2), balance: bankRunning.toFixed(2) };
    });
    const st = await svc.bank.import(admin, { cashAccountId: bank, fileName: `mutasi-bca-${period}.csv`, lines: out });
    for (const l of st.lines.filter((x) => x.status === 'UNMATCHED')) {
      const target = l.description.startsWith('BIAYA ADM') ? A('8-1100') : l.description.startsWith('BUNGA') ? A('4-9100') : undefined;
      if (target) await svc.bank.createFromLine(admin, l.id, { accountId: target, description: l.description.startsWith('BUNGA') ? `Bunga jasa giro ${period}` : `Biaya administrasi bank ${period}` });
    }
  };

  // Cuti tahunan
  const onLeave = new Map<string, Set<string>>();
  const leaves = [
    { e: 1, from: '2026-04-13', to: '2026-04-15' },
    { e: 0, from: '2026-06-22', to: '2026-06-24' },
    { e: 2, from: '2026-07-27', to: '2026-07-29' },
    { e: 3, from: '2026-09-07', to: '2026-09-08' },
  ];
  for (const l of leaves.filter((x) => x.to < today)) {
    for (let d = l.from; d <= l.to; d = addDays(d, 1)) {
      if (!onLeave.has(d)) onLeave.set(d, new Set());
      onLeave.get(d)!.add(emp[l.e].id);
    }
    later(addDays(l.from, -10), 'cuti', async () => {
      const lv = (await svc.hr.createLeave(admin, asDto({ employeeId: emp[l.e].id, type: 'ANNUAL', startDate: l.from, endDate: l.to, reason: 'Cuti tahunan' }))) as { id: string };
      await svc.hr.decideLeave(admin, lv.id, { decision: 'APPROVED' });
    });
  }

  // Tagihan biaya & aset yang terjadwal
  later('2026-01-02', 'sewa gudang', () =>
    bill('2026-01-02', 'SUP-PROPERTI', 'GPB/INV/2026/001', {
      description: 'Sewa gudang Narogong Januari–Desember 2026',
      withholdingType: 'PPH4_2',
      withholdingRate: '10',
      lines: [{ type: 'EXPENSE', description: 'Sewa gudang 12 bulan (dibayar dimuka)', accountId: A('1-1700'), price: '144000000', withholding: true }],
    }),
  );
  later('2026-02-09', 'mobil box', () =>
    bill('2026-02-09', 'SUP-AUTO', 'ANM/2602/0117', {
      description: 'Pembelian mobil box pengiriman',
      lines: [{ type: 'ASSET', description: 'Mobil box Mitsubishi L300 B 9876 KZ', assetCategoryId: cats.get('Kendaraan'), price: '235000000', location: 'Gudang utama' }],
    }),
  );
  later('2026-05-06', 'laptop', () =>
    bill('2026-05-06', 'SUP-KOMPUTER', 'TKJ-0506-22', {
      description: 'Laptop admin & printer',
      lines: [
        { type: 'ASSET', description: 'Laptop 14" Core i5', assetCategoryId: cats.get('Inventaris Kantor'), qty: '2', price: '11500000', location: 'Kantor' },
        { type: 'ASSET', description: 'Printer dot-matrix faktur', assetCategoryId: cats.get('Inventaris Kantor'), price: '3200000', location: 'Kantor' },
      ],
    }),
  );
  later('2026-07-08', 'forklift', () =>
    bill('2026-07-08', 'SUP-TEKNIK', 'JTM/VII/2026/031', {
      description: 'Forklift listrik + pemasangan',
      withholdingType: 'PPH23',
      withholdingRate: '2',
      lines: [
        { type: 'ASSET', description: 'Forklift listrik 1,5 ton', assetCategoryId: cats.get('Peralatan Gudang & Mesin'), price: '98000000', location: 'Gudang utama', withholding: false },
        { type: 'EXPENSE', description: 'Jasa pemasangan & pelatihan operator', accountId: A('6-7000'), price: '3500000', withholding: true },
      ],
    }),
  );
  for (const [d, amt] of [
    ['2026-03-11', 2850000],
    ['2026-05-20', 3400000],
    ['2026-07-22', 2600000],
    ['2026-09-16', 4100000],
  ] as const)
    later(d, 'servis', () =>
      bill(d, 'SUP-TEKNIK', `JTM/${d.slice(5, 7)}/${rint(100, 999)}`, {
        description: 'Servis kendaraan & AC gudang',
        withholdingType: 'PPH23',
        withholdingRate: '2',
        lines: [
          { type: 'EXPENSE', description: 'Servis berkala kendaraan pengiriman', accountId: A('6-7000'), price: String(r1000(amt * 0.7)) },
          { type: 'EXPENSE', description: 'Servis & isi freon AC gudang', accountId: A('6-7000'), price: String(r1000(amt * 0.3)) },
        ],
      }),
    );
  // Retur penjualan
  for (const d of ['2026-04-08', '2026-08-14']) {
    later(d, 'retur', async () => {
      const [row] = (
        await db.execute<{ id: string; line_id: string; qty: string }>(sql`
          SELECT i.id, l.id AS line_id, l.qty FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
          WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.date BETWEEN ${addDays(d, -12)} AND ${d} AND l.qty >= 4 ORDER BY i.date LIMIT 1`)
      ).rows;
      if (row) await svc.returns.createSales(admin, { invoiceId: row.id, date: d, reason: 'Kemasan penyok saat pengiriman', lines: [{ invoiceLineId: row.line_id, qty: '2' }] });
    });
  }

  // ---------- Putar hari demi hari ----------
  let currentMonth = '';
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const month = d.slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      log(`  ${new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}…`);
    }
    const workday = dow(d) !== 0 && !HOLIDAYS.has(d);
    await withSimulatedDay(d, async () => {
      // kejadian terjadwal untuk hari ini
      for (;;) {
        const due = queue.filter((e) => e.date <= d);
        if (!due.length) break;
        for (const e of due) queue.splice(queue.indexOf(e), 1);
        for (const e of due.sort((a, b) => a.date.localeCompare(b.date))) await quiet(e.label, () => withSimulatedDay(d, e.run));
      }
      if (d.slice(8) === '03' && prevPeriod(d) >= start.slice(0, 7)) await quiet('mutasi bank', () => bankStatement(d));
      if (workday) {
        if (dow(d) === 1 || dow(d) === 4) await quiet('restock', () => restock(d));
        const n = Math.max(0, Math.round(SO_PER_DAY * demandFactor(d) + (R() - 0.5) * 2.5));
        for (let i = 0; i < n; i++) await salesOrder(d);
        if ([2, 4, 6].includes(dow(d))) await quiet('kasir', () => posDay(d));
        if (dow(d) === 1) {
          await quiet('marketplace', () => marketplaceWeek(d));
          await quiet('BBM', () =>
            svc.cash.create(admin, asDto({ type: 'OUT', cashAccountId: kas, date: d, description: 'BBM kendaraan pengiriman', reference: `SPBU-${rint(1000, 9999)}`, lines: [{ accountId: A('6-2000'), amount: String(r1000(rint(400, 750) * 1000)) }] })),
          );
        }
        if (dow(d) === 6) {
          const k = await kasBalance();
          if (k > 8_000_000) await quiet('setor tunai', () => svc.cash.create(admin, asDto({ type: 'TRANSFER', cashAccountId: kas, toCashAccountId: bank, amount: String(r100(k - 5_000_000)), date: d, description: 'Setor tunai hasil penjualan ke bank' })));
        }
        await attendance(d, onLeave);
      }
      const day = Number(d.slice(8));
      if (day === 5 || (day === 6 && dow(addDays(d, -1)) === 0)) {
        await quiet('listrik', () =>
          svc.cash.create(admin, asDto({
            type: 'OUT',
            cashAccountId: bank,
            date: d,
            description: `Tagihan listrik, air & internet ${prevPeriod(d)}`,
            reference: `PLN-${rint(100000, 999999)}`,
            lines: [
              { accountId: A('6-4000'), amount: String(r1000(rint(3100, 4300) * 1000)), memo: 'PLN & PDAM gudang' },
              { accountId: A('6-4000'), amount: '650000', memo: 'Internet kantor' },
            ],
          })),
        );
      }
      if (day === 12 && workday)
        await quiet('ATK', () =>
          svc.cash.create(admin, asDto({ type: 'OUT', cashAccountId: kas, date: d, description: 'Perlengkapan kantor & ATK', reference: `NOTA-${rint(100, 999)}`, lines: [{ accountId: A('6-6000'), amount: String(r1000(rint(250, 650) * 1000)) }] })),
        );
      if (day === 20 && ['02', '03', '06', '09', '11'].includes(d.slice(5, 7)))
        await quiet('promosi', () =>
          svc.cash.create(admin, asDto({ type: 'OUT', cashAccountId: bank, date: d, description: 'Materi promosi & spanduk toko', lines: [{ accountId: A('6-2100'), amount: String(r1000(rint(1200, 2800) * 1000)) }] })),
        );
      if (day === 10) await quiet('setoran pajak', () => taxes(d, ['PPH21', 'BPJS', 'PPH23', 'PPH4_2']));
      if (day === 25) await quiet('PPN', () => taxes(d, ['PPN']));
      if (day === 1 || day === 16) await quiet('pencairan', () => marketplacePayout(d));
      if (day === 26 && d.slice(5, 7) !== '01') {
        const until = lastDay(`${prevPeriod(`${prevPeriod(d)}-15`)}-01`);
        await quiet('kunci', () => svc.accounting.lockPeriod(admin, until));
      }
      // akhir bulan: penyusutan, jurnal berulang, gaji
      await quiet('berulang', () => svc.accounting.runDue(tenantId, admin.sub));
      if (d === lastDay(d) && d < today) {
        await quiet('penyusutan', () => svc.assets.run(admin, d.slice(0, 7)));
        await quiet('gaji', () => payroll(d.slice(0, 7), d));
      }
    });
  }
  await db
    .update(tenants)
    .set({ settings: sql`jsonb_set(settings, '{demo}', ${JSON.stringify({ version: DEMO_VERSION, generatedUntil: today })}::jsonb, true)` })
    .where(eq(tenants.id, tenantId));
}

export const DEMO_VERSION = 2;
