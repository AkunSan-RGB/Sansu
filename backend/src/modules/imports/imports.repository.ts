import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import {
  products,
  stockBalances,
  productUoms,
  warehouses,
  invoices,
  purchaseInvoices,
  accounts,
  assetCategories,
  customers,
  suppliers,
} from '../../db/schema';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { date } from './parse';
import { Dec } from '../../common/utils/money';

/** Pelanggan atau pemasok: impor data induk memakai logika yang sama untuk keduanya, tabelnya dipilih di sini */
export type PartyKind = 'customers' | 'suppliers';
const partyTable = (kind: PartyKind) => (kind === 'customers' ? customers : suppliers);
type PartyInsert = typeof customers.$inferInsert & typeof suppliers.$inferInsert;
type PartyPatch = Partial<typeof customers.$inferInsert>;

/** Akses data untuk Imports: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ImportsRepository {
  /** Dipakai oleh ImportsService.products */
  listProducts(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: products.id, sku: products.sku, barcode: products.barcode, baseUom: products.baseUom })
      .from(products)
      .where(eq(products.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.products */
  listStockBalances(db: DbOrTx, tenantId: string) {
    return db
      .selectDistinct({ id: stockBalances.productId })
      .from(stockBalances)
      .where(eq(stockBalances.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.products */
  deleteProductUomsByProductId(db: DbOrTx, chunk: string[]) {
    return db.delete(productUoms).where(inArray(productUoms.productId, chunk));
  }

  /** Dipakai oleh ImportsService.products */
  insertProductUoms(db: DbOrTx, chunk: { uom: string; factor: string; productId: string }[]) {
    return db.insert(productUoms).values(chunk);
  }

  /** Dipakai oleh ImportsService.stock */
  listProductsForStock(db: DbOrTx, tenantId: string) {
    return db.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.stock */
  listWarehouses(db: DbOrTx, tenantId: string) {
    return db.select().from(warehouses).where(eq(warehouses.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.stock */
  listStockBalancesByQty(db: DbOrTx, tenantId: string) {
    return db
      .select({ p: stockBalances.productId, w: stockBalances.warehouseId })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), sql`${stockBalances.qty} <> 0`));
  }

  /** Dipakai oleh ImportsService.openItems */
  listInvoices(db: DbOrTx, tenantId: string) {
    return db.select({ n: invoices.number }).from(invoices).where(eq(invoices.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.openItems */
  listPurchaseInvoices(db: DbOrTx, tenantId: string) {
    return db
      .select({ s: purchaseInvoices.supplierId, n: purchaseInvoices.supplierInvoiceNo })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.openItems */
  listPurchaseInvoicesForOpenItems(db: DbOrTx, tenantId: string) {
    return db
      .select({ n: purchaseInvoices.number })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.openItems */
  insertInvoices(
    db: DbOrTx,
    chunk: { partyId: string; code: string; no: string; date: string; due: string; amount: Dec }[],
    tenantId: string,
    id: string,
  ) {
    return db.insert(invoices).values(
      chunk.map((x) => ({
        tenantId: tenantId,
        number: x.no,
        date: x.date,
        dueDate: x.due,
        customerId: x.partyId,
        isOpening: true,
        subtotal: x.amount.toFixed(2),
        taxAmount: '0',
        total: x.amount.toFixed(2),
        journalId: id,
      })),
    );
  }

  /** Dipakai oleh ImportsService.openItems */
  insertPurchaseInvoices(
    db: DbOrTx,
    chunk: { partyId: string; code: string; no: string; date: string; due: string; amount: Dec }[],
    tenantId: string,
    docNo: (supplierCode: string, no: string) => string,
    id: string,
  ) {
    return db.insert(purchaseInvoices).values(
      chunk.map((x) => ({
        tenantId: tenantId,
        number: docNo(x.code, x.no),
        supplierInvoiceNo: x.no,
        date: x.date,
        dueDate: x.due,
        supplierId: x.partyId,
        kind: 'OPENING',
        description: 'Saldo awal utang (impor)',
        subtotal: x.amount.toFixed(2),
        taxAmount: '0',
        total: x.amount.toFixed(2),
        journalId: id,
      })),
    );
  }

  /** Dipakai oleh ImportsService.accountBalances */
  listAccounts(db: DbOrTx, tenantId: string) {
    return db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
  }

  /** Dipakai oleh ImportsService.accountBalances */
  queryJournalLine(db: DbOrTx, tenantId: string) {
    return db.execute<{ account_id: string }>(sql`
          SELECT DISTINCT l.account_id::text AS account_id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
          WHERE j.tenant_id = ${tenantId} AND j.source_type = 'OPENING'`);
  }

  /** Dipakai oleh ImportsService.existingAssets */
  listAssetCategories(db: DbOrTx, tenantId: string) {
    return db.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ImportsService.products */
  insertProducts(db: DbOrTx, rows: (typeof products.$inferInsert)[]) {
    return db.insert(products).values(rows).returning({ id: products.id, sku: products.sku });
  }

  /** Kode yang sudah dipakai pelanggan/pemasok perusahaan ini */
  listPartyCodes(db: DbOrTx, tenantId: string, kind: PartyKind) {
    const table = partyTable(kind);
    return db.select({ id: table.id, code: table.code }).from(table).where(eq(table.tenantId, tenantId));
  }

  /** Kode, nama, dan tempo bayar pelanggan/pemasok (untuk impor saldo piutang/utang awal) */
  listPartyTerms(db: DbOrTx, tenantId: string, kind: PartyKind) {
    const table = partyTable(kind);
    return db
      .select({ id: table.id, code: table.code, name: table.name, term: table.paymentTermDays })
      .from(table)
      .where(eq(table.tenantId, tenantId));
  }

  async updateParty(db: DbOrTx, kind: PartyKind, tenantId: string, id: string, patch: PartyPatch) {
    const table = partyTable(kind);
    await db
      .update(table)
      .set(patch)
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  }

  async insertParties(db: DbOrTx, kind: PartyKind, rows: PartyInsert[]) {
    // tabel dipilih saat jalan (pelanggan atau pemasok) sehingga tipe sisipnya tidak bisa dipersempit statis
    await db.insert(partyTable(kind)).values(rows as never);
  }

  /** Ubah produk milik perusahaan ini (impor produk: pembaruan baris yang sudah ada) */
  async updateProduct(db: DbOrTx, tenantId: string, id: string, patch: Partial<typeof products.$inferInsert>) {
    await db.update(products).set(patch).where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
  }
}
