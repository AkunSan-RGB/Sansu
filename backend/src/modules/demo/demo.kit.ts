import { PlatformSettlementsService } from '../pos/pos-online.module';
import { PosTabsService } from '../pos/pos-tabs.module';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { type BusinessModel } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, DocDate, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { accounts, suppliers, tenants, warehouses } from '../../db/schema';
import { AccountingService } from '../accounting/accounting.service';
import { CashService } from '../cash/cash.module';
import { CashCountService } from '../cash/cash-count';
import { PettyCashService } from '../cash/petty-cash';
import { AssetsService } from '../assets/assets.module';
import { BankService } from '../bank/bank.module';
import { BudgetService } from '../accounting/budget';
import { CrmService } from '../crm/crm.module';
import { WritedownService } from '../inventory/writedown';
import { WarehouseOpsService } from '../inventory/warehouse-ops';
import { GoodsReceiptsService } from '../purchasing/goods-receipts.service';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import { ReturnsService } from '../returns/returns.service';
import { TaxService } from '../tax/tax.module';
import { HrService } from '../hr/hr.module';
import { InventoryService } from '../inventory/inventory.service';
import { CustomersService } from '../master-data/customers/customers.service';
import { ProductsService } from '../master-data/products/products.service';
import { PayrollService } from '../payroll/payroll.module';
import { PosService } from '../pos/pos.module';
import { ProductionService } from '../production/production.module';
import { PurchaseInvoicesService } from '../purchasing/purchase-invoices.service';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service';
import { InvoicesService } from '../sales/invoices/invoices.service';
import { SalesOrdersService } from '../sales/orders/sales-orders.service';
import { PaymentsService } from '../sales/payments/payments.service';
import { documentTotals } from '../sales/pricing';
import { ServiceBillingService } from '../sales/services/service-billing';
import { PricingService } from '../sales/pricing/price-lists';
import { UtilityService } from '../utility/utility.module';

/** Alat bantu bersama untuk semua data contoh: semua transaksi lewat service aplikasi (bukan insert mentah) agar jurnal & laporan konsisten */
export interface Demo {
  db: Db;
  admin: AuthUser;
  tenantId: string;
  model: BusinessModel;
  today: DocDate;
  /** tanggal n hari lalu */
  ago: (n: number) => DocDate;
  rnd: () => number;
  int: (a: number, b: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  svc: {
    products: ProductsService;
    customers: CustomersService;
    inventory: InventoryService;
    accounting: AccountingService;
    po: PurchaseOrdersService;
    pi: PurchaseInvoicesService;
    so: SalesOrdersService;
    inv: InvoicesService;
    pay: PaymentsService;
    pos: PosService;
    tabs: PosTabsService;
    settle: PlatformSettlementsService;
    cash: CashService;
    hr: HrService;
    payroll: PayrollService;
    production: ProductionService;
    billing: ServiceBillingService;
    pricing: PricingService;
    assets: AssetsService;
    bank: BankService;
    budget: BudgetService;
    crm: CrmService;
    ops: WarehouseOpsService;
    grn: GoodsReceiptsService;
    prq: PurchaseRequestsService;
    returns: ReturnsService;
    tax: TaxService;
    petty: PettyCashService;
    writedown: WritedownService;
    cashCount: CashCountService;
    utility: UtilityService;
  };
  acc: (code: string) => string;
  kas: string;
  bank: string;
  wh: string;
  /** Dokumen terakhir yang dibuat (dipakai untuk contoh retur) */
  last: { bill?: string; inv?: string };
  /** Jalankan langkah; galat dilewati (data contoh tetap jadi) kecuali DEMO_STRICT=true (dipakai tes) */
  step: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

const logger = new Logger('DemoData');

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

const PROFILE: Record<BusinessModel, { activity: string; address: string; city: string }> = {
  RITEL: { activity: 'ritel (toko serba ada: makanan, minuman, kebutuhan rumah tangga)', address: 'Jl. Pasar Minggu Raya No. 21, Jakarta Selatan', city: 'Jakarta' },
  DAGANG: { activity: 'perdagangan besar bahan bangunan dan perlengkapan konstruksi', address: 'Kawasan Pergudangan Cakung Blok C-7, Jakarta Timur', city: 'Jakarta' },
  JASA: { activity: 'jasa konsultasi teknologi informasi dan desain digital', address: 'Gedung Graha Mitra Lt. 5, Jl. Gatot Subroto Kav. 21, Jakarta', city: 'Jakarta' },
  FMCG: { activity: 'distribusi barang konsumen cepat laku (makanan, minuman, perawatan, rumah tangga) ke toko dan minimarket', address: 'Kawasan Pergudangan Cibitung Blok D-12, Bekasi', city: 'Bekasi' },
  MANUFAKTUR: { activity: 'manufaktur furnitur kayu (meja, kursi, lemari)', address: 'Kawasan Industri Jepara Blok F-3, Jawa Tengah', city: 'Jepara' },
  UTILITAS: { activity: 'penyediaan air bersih dan internet berlangganan untuk kawasan perumahan', address: 'Jl. Tirta Kencana No. 5, Sleman', city: 'Sleman' },
  FNB: { activity: 'kafe dan kedai makan (kopi, minuman, nasi, mi, dan roti)', address: 'Jl. Braga No. 88, Bandung', city: 'Bandung' },
};

const APPS_BY_MODEL: Record<BusinessModel, ('pos' | 'crm' | 'payroll')[]> = {
  RITEL: ['pos', 'payroll'],
  DAGANG: ['payroll', 'crm'],
  JASA: ['payroll', 'crm'],
  FMCG: ['payroll', 'crm'],
  MANUFAKTUR: ['payroll', 'crm'],
  FNB: ['pos', 'payroll'],
  UTILITAS: ['payroll', 'crm'],
};

export async function buildDemo(ref: ModuleRef, db: Db, admin: AuthUser, model: BusinessModel): Promise<Demo> {
  const get = <T>(c: new (...a: never[]) => T) => ref.get(c, { strict: false });
  const today = todayJakarta();
  const R = rng(Date.now() % 1_000_000);
  const tenantId = admin.tenantId;
  const profile = PROFILE[model];

  await db.update(tenants).set({ npwp: '01.234.567.8-901.000', address: profile.address, ppnRate: '11' }).where(eq(tenants.id, tenantId));
  await get(SettingsService).saveReporting(db, tenantId, {
    framework: 'SAK_EP',
    legalForm: 'PT',
    businessActivity: profile.activity,
    establishedYear: 2021,
    city: profile.city,
    directorName: 'Direktur Demo',
    directorTitle: 'Direktur',
    taxScheme: 'GENERAL',
  });
  for (const k of APPS_BY_MODEL[model]) await get(AppsService).install(tenantId, k);

  const acc = new Map((await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))).map((a) => [a.code, a.id]));
  const [wh] = await db.select().from(warehouses).where(eq(warehouses.tenantId, tenantId));
  const strict = process.env.DEMO_STRICT === 'true';

  return {
    db,
    admin,
    tenantId,
    model,
    today,
    ago: (n) => addDays(today, -n),
    rnd: R,
    int: (a, b) => a + Math.floor(R() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(R() * arr.length)],
    svc: {
      products: get(ProductsService),
      customers: get(CustomersService),
      inventory: get(InventoryService),
      accounting: get(AccountingService),
      po: get(PurchaseOrdersService),
      pi: get(PurchaseInvoicesService),
      so: get(SalesOrdersService),
      inv: get(InvoicesService),
      pay: get(PaymentsService),
      pos: get(PosService),
      tabs: get(PosTabsService),
      settle: get(PlatformSettlementsService),
      cash: get(CashService),
      hr: get(HrService),
      payroll: get(PayrollService),
      production: get(ProductionService),
      billing: get(ServiceBillingService),
      pricing: get(PricingService),
      assets: get(AssetsService),
      bank: get(BankService),
      budget: get(BudgetService),
      crm: get(CrmService),
      ops: get(WarehouseOpsService),
      grn: get(GoodsReceiptsService),
      prq: get(PurchaseRequestsService),
      returns: get(ReturnsService),
      tax: get(TaxService),
      petty: get(PettyCashService),
      writedown: get(WritedownService),
      cashCount: get(CashCountService),
      utility: get(UtilityService),
    },
    acc: (code) => acc.get(code)!,
    kas: acc.get('1-1100')!,
    bank: acc.get('1-1200')!,
    wh: wh.id,
    last: {},
    step: async (label, fn) => {
      try {
        return await fn();
      } catch (e) {
        if (strict) throw new Error(`Data demo ${model}, langkah "${label}": ${(e as Error).message}`);
        logger.warn(`Lewati "${label}" (${model}): ${(e as Error).message}`);
        return undefined;
      }
    },
  };
}

/** Saldo awal 60 hari lalu: kas, bank, persediaan, dan modal (seimbang) */
export async function openingBalance(c: Demo, o: { kas: number; bank: number; stockValue: number }) {
  const date = c.ago(120);
  // persediaan awal sudah menyeimbangkan dirinya ke Ekuitas Saldo Awal lewat penyesuaian stok OPENING
  const modal = o.kas + o.bank;
  await c.svc.accounting.openingBalance(c.admin as never, {
    date,
    lines: [
      { accountId: c.kas, debit: String(o.kas), credit: '0' },
      { accountId: c.bank, debit: String(o.bank), credit: '0' },
      { accountId: c.acc('3-1000'), debit: '0', credit: String(modal) },
    ],
  } as never);
}

export async function addSuppliers(c: Demo, list: { code: string; name: string; term: number }[]) {
  const ids = new Map<string, string>();
  for (const s of list) {
    const [row] = await c.db
      .insert(suppliers)
      .values({ tenantId: c.tenantId, code: s.code, name: s.name, paymentTermDays: s.term, phone: `021-555-${c.int(1000, 9999)}` })
      .returning();
    ids.set(s.code, row.id);
  }
  return ids;
}

export async function addCustomers(c: Demo, list: { code: string; name: string; address: string; term: number; limit?: string }[]) {
  const ids = new Map<string, string>();
  for (const x of list) {
    const r = await c.svc.customers.create(c.tenantId, {
      code: x.code,
      name: x.name,
      address: x.address,
      phone: `0812-${c.int(1000, 9999)}-${c.int(1000, 9999)}`,
      creditLimit: x.limit ?? '0',
      paymentTermDays: x.term,
    } as never);
    ids.set(x.code, r.id);
  }
  return ids;
}

/** Biaya operasional rutin lewat kas/bank */
export async function expense(c: Demo, daysAgo: number, from: 'kas' | 'bank', code: string, desc: string, amount: number, ref?: string) {
  return c.step(`biaya ${desc}`, () =>
    c.svc.cash.create(c.admin as never, {
      type: 'OUT',
      cashAccountId: from === 'kas' ? c.kas : c.bank,
      date: c.ago(daysAgo),
      description: desc,
      reference: ref ?? `BKT-${c.int(1000, 9999)}`,
      lines: [{ accountId: c.acc(code), amount: String(amount) }],
    } as never),
  );
}

/** Pembayaran piutang faktur (sebagian atau penuh) */
export async function receive(c: Demo, invoiceId: string, daysAgo: number, method: 'TRANSFER' | 'CASH' = 'TRANSFER', fraction = 1) {
  const cur = await c.svc.inv.get(c.tenantId, invoiceId);
  const out = (Number(cur.total) - Number(cur.paidAmount) - Number(cur.returnedAmount)) * fraction;
  if (out <= 0) return;
  await c.svc.pay.create(c.admin as never, {
    invoiceId,
    amount: out.toFixed(2),
    date: c.ago(daysAgo),
    method,
    cashAccountId: method === 'CASH' ? c.kas : c.bank,
  } as never);
}

/** Pembayaran faktur supplier penuh */
export async function payBill(c: Demo, billId: string, daysAgo: number) {
  const inv = await c.svc.pi.get(c.tenantId, billId);
  const out = Number(inv.total) - Number(inv.paidAmount) - Number(inv.returnedAmount);
  if (out <= 0) return;
  await c.svc.pi.pay(c.admin as never, { purchaseInvoiceId: billId, amount: out.toFixed(2), cashAccountId: c.bank, date: c.ago(daysAgo) } as never);
}

/** Gaji bulan lalu: karyawan, proses penggajian, bayar */
export async function payroll(c: Demo, staff: { code: string; name: string; title: string; dept: string; salary: number; allowance: number; ptkp: string; production?: boolean }[]) {
  for (const e of staff) {
    await c.step(`karyawan ${e.name}`, () =>
      c.svc.hr.createEmployee(c.admin as never, {
        code: e.code,
        name: e.name,
        ptkp: e.ptkp,
        jobTitle: e.title,
        department: e.dept,
        joinDate: c.ago(400),
        baseSalary: String(e.salary),
        fixedAllowance: String(e.allowance),
        bpjsKes: true,
        bpjsTk: true,
        isProduction: e.production ?? false,
      } as never),
    );
  }
  const prev = addDays(`${c.today.slice(0, 7)}-01`, -1);
  const run = (await c.step('proses gaji', () => c.svc.payroll.createRun(c.admin as never, { period: prev.slice(0, 7), payDate: prev } as never))) as { id: string } | undefined;
  if (!run) return;
  await c.step('posting gaji', () => c.svc.payroll.post(c.admin as never, run.id));
  await c.step('bayar gaji', () => c.svc.payroll.pay(c.admin as never, run.id, { cashAccountId: c.bank, date: prev } as never));
}

/** Pesanan beli → diterima & difakturkan → (opsional) dibayar */
export async function purchase(c: Demo, supplierId: string, daysAgo: number, lines: { productId: string; uom?: string; qty: number; price: number }[], opts: { pay?: boolean; invoiceNo: string }) {
  const po = await c.svc.po.create(c.admin as never, {
    supplierId,
    warehouseId: c.wh,
    date: c.ago(daysAgo),
    lines: lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: String(l.qty), price: String(l.price) })),
  } as never);
  await c.svc.po.confirm(c.admin as never, po.id);
  const bill = await c.svc.pi.createFromOrder(c.admin as never, { purchaseOrderId: po.id, supplierInvoiceNo: opts.invoiceNo, date: c.ago(daysAgo - 1) } as never);
  if (opts.pay) await payBill(c, bill.id, Math.max(daysAgo - 8, 1));
  c.last.bill = bill.id;
  return bill;
}

/** Pesanan jual → konfirmasi → faktur; mengembalikan id faktur */
export async function sell(c: Demo, customerId: string, daysAgo: number, lines: { productId: string; uom?: string; qty: number }[]) {
  const so = await c.svc.so.create(c.admin as never, {
    customerId,
    warehouseId: c.wh,
    date: c.ago(daysAgo),
    lines: lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: String(l.qty) })),
  } as never);
  await c.svc.so.confirm(c.admin as never, so.id);
  const inv = await c.svc.inv.createFromOrder(c.admin as never, { salesOrderId: so.id, date: c.ago(daysAgo) } as never);
  c.last.inv = inv.id;
  return inv.id as string;
}

/** Sesi kasir satu hari dengan beberapa transaksi tunai/QRIS */
export async function posDay(c: Demo, daysAgo: number, items: { id: string; price: number }[], orders: number) {
  const { withSimulatedDay } = await import('../../common/utils/dates');
  await withSimulatedDay(c.ago(daysAgo), async () => {
    const s = await c.svc.pos.open(c.admin as never, { warehouseId: c.wh, openingCash: '300000' } as never);
    for (let i = 0; i < orders; i++) {
      const lines = [...items].sort(() => c.rnd() - 0.5).slice(0, c.int(1, 4)).map((p) => ({ productId: p.id, qty: String(c.int(1, 3)), price: p.price }));
      const total = Number(documentTotals(lines.map((l) => ({ qty: Number(l.qty), price: l.price })), 11).total);
      const qris = c.rnd() < 0.4;
      await c.step('transaksi kasir', () =>
        c.svc.pos.createOrder(c.admin as never, {
          sessionId: s.id,
          lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          // QRIS: bayar sebagian lewat QRIS dan sisanya tunai (selalu lolos aturan "non-tunai tidak boleh melebihi total")
          payments: qris
            ? [{ method: 'QRIS', amount: String(Math.floor((total * 0.6) / 100) * 100) }, { method: 'CASH', amount: String(Math.ceil((total * 0.4) / 1000) * 1000 + 1000) }]
            : [{ method: 'CASH', amount: String(Math.ceil(total / 5000) * 5000) }],
        } as never),
      );
    }
    const cur = (await c.svc.pos.current(c.admin as never)) as { summary: { expectedCash: string } } | null;
    await c.svc.pos.close(c.admin as never, s.id, { countedCash: String(Number(cur?.summary.expectedCash ?? 300000)) } as never);
  });
}

