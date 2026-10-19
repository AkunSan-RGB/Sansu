/**
 * Jejak audit: siapa mengubah apa dan kapan. Sumbernya dua: catatan rinci dari proses bisnis
 * (AuditService) dan catatan otomatis setiap perubahan data lewat API (AuditInterceptor).
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { auditLogs, users } from '../../db/schema';

export const AUDIT_CATEGORIES = ['sales', 'purchase', 'inventory', 'accounting', 'master', 'hr', 'settings', 'security'] as const;
type Category = (typeof AUDIT_CATEGORIES)[number];

export class AuditQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: AUDIT_CATEGORIES }) @IsOptional() @IsIn(AUDIT_CATEGORIES) category?: Category;
  @ApiPropertyOptional({ description: 'Cari nomor dokumen / isi' }) @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize?: number;
}

// ---------- label bahasa Indonesia ----------
const NOUN: Record<string, [string, Category]> = {
  // entitas dari catatan rinci
  SalesOrder: ['sales order', 'sales'],
  DeliveryTrip: ['rute pengiriman', 'sales'],
  DeliveryVehicle: ['kendaraan pengiriman', 'sales'],
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

function describe(action: string, entity: string, data: Record<string, unknown> | null): { label: string; category: Category } {
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

const CATEGORY_LABEL: Record<Category, string> = {
  sales: 'Penjualan',
  purchase: 'Pembelian',
  inventory: 'Inventori',
  accounting: 'Akuntansi',
  master: 'Data master',
  hr: 'SDM',
  settings: 'Pengaturan',
  security: 'Keamanan',
};

/** Tabel rujukan untuk menampilkan nomor dokumen / nama, dan tautan ke halamannya */
const REF: Record<string, { table: string; expr: string; link?: string }> = {
  SalesOrder: { table: 'sales_orders', expr: 'number', link: '/sales-orders/:id' },
  'sales-orders': { table: 'sales_orders', expr: 'number', link: '/sales-orders/:id' },
  Invoice: { table: 'invoices', expr: 'number', link: '/invoices/:id' },
  invoices: { table: 'invoices', expr: 'number', link: '/invoices/:id' },
  Payment: { table: 'payments', expr: 'number' },
  SalesReturn: { table: 'sales_returns', expr: 'number' },
  Quotation: { table: 'quotations', expr: 'number', link: '/quotations/:id' },
  quotations: { table: 'quotations', expr: 'number', link: '/quotations/:id' },
  Lead: { table: 'leads', expr: 'title' },
  leads: { table: 'leads', expr: 'title' },
  PosSession: { table: 'pos_sessions', expr: 'number' },
  sessions: { table: 'pos_sessions', expr: 'number' },
  PurchaseOrder: { table: 'purchase_orders', expr: 'number', link: '/purchase-orders/:id' },
  'purchase-orders': { table: 'purchase_orders', expr: 'number', link: '/purchase-orders/:id' },
  PurchaseInvoice: { table: 'purchase_invoices', expr: 'number' },
  PurchaseBill: { table: 'purchase_invoices', expr: 'number' },
  SupplierPayment: { table: 'supplier_payments', expr: 'number' },
  PurchaseReturn: { table: 'purchase_returns', expr: 'number' },
  CashTransaction: { table: 'cash_transactions', expr: 'number' },
  TaxPayment: { table: 'tax_payments', expr: 'number' },
  FixedAsset: { table: 'fixed_assets', expr: "code || ' · ' || name" },
  journals: { table: 'journal_entries', expr: 'number' },
  recurring: { table: 'recurring_journals', expr: 'name' },
  accounts: { table: 'accounts', expr: "code || ' · ' || name" },
  products: { table: 'products', expr: "sku || ' · ' || name" },
  customers: { table: 'customers', expr: "code || ' · ' || name" },
  suppliers: { table: 'suppliers', expr: "code || ' · ' || name" },
  warehouses: { table: 'warehouses', expr: "code || ' · ' || name" },
  Employee: { table: 'employees', expr: "code || ' · ' || name" },
  employees: { table: 'employees', expr: "code || ' · ' || name" },
  PayrollRun: { table: 'payroll_runs', expr: "number || ' (' || period || ')'", link: '/payroll/:id' },
  runs: { table: 'payroll_runs', expr: "number || ' (' || period || ')'", link: '/payroll/:id' },
  User: { table: 'users', expr: "name || ' (' || email || ')'" },
  users: { table: 'users', expr: "name || ' (' || email || ')'" },
};
/** Larik Postgres sebagai satu parameter: {a,b,c} */
const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '')}"`).join(',')}}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Kunci rujukan sebuah catatan: nama entitas, atau segmen rute API untuk catatan otomatis */
function refKey(entity: string, data: Record<string, unknown> | null): string | undefined {
  if (entity !== 'API') return REF[entity] ? entity : undefined;
  const segs = String(data?.route ?? '').split(' ')[1]?.replace(/^\/api\//, '').split('/') ?? [];
  const idAt = segs.indexOf(':id');
  const res = idAt > 0 ? segs[idAt - 1] : segs.filter((x) => !x.startsWith(':')).pop();
  return res && REF[res] ? res : undefined;
}

@Injectable()
export class AuditLogService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(tenantId: string, q: AuditQueryDto) {
    const page = q.page ?? 1;
    const size = q.pageSize ?? 50;
    const conds = [
      eq(auditLogs.tenantId, tenantId),
      q.from ? gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00+07:00`)) : undefined,
      q.to ? lt(auditLogs.createdAt, new Date(`${addDays(q.to, 1)}T00:00:00+07:00`)) : undefined,
      q.userId ? eq(auditLogs.userId, q.userId) : undefined,
      q.q ? await this.searchCond(tenantId, q.q) : undefined,
    ];
    // kategori dihitung dari label → saring di memori pada jendela yang cukup besar
    const raw = await this.db
      .select({
        id: auditLogs.id,
        at: auditLogs.createdAt,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        data: auditLogs.data,
        userId: auditLogs.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(...conds))
      .orderBy(desc(auditLogs.id))
      .limit(q.category ? 5000 : size + 1)
      .offset(q.category ? 0 : (page - 1) * size);
    let rows = raw.map((r) => {
      const d = describe(r.action, r.entity, r.data as Record<string, unknown> | null);
      return { ...r, ...d, categoryLabel: CATEGORY_LABEL[d.category] };
    });
    if (q.category) rows = rows.filter((r) => r.category === q.category).slice((page - 1) * size, page * size + 1);
    const hasMore = rows.length > size;
    rows = rows.slice(0, size);
    const refs = await this.resolveRefs(tenantId, rows);
    return {
      page,
      pageSize: size,
      hasMore,
      rows: rows.map((r) => {
        const k = refKey(r.entity, r.data as Record<string, unknown> | null);
        const ref = k ? refs.get(`${REF[k].table}|${r.entityId}`) : undefined;
        const number = (r.data as { number?: string } | null)?.number;
        return { ...r, ref: ref ?? number ?? null, link: ref && k && REF[k].link ? REF[k].link!.replace(':id', r.entityId) : null };
      }),
    };
  }

  /** Ambil nomor dokumen / nama untuk ID yang tercatat, satu kueri per tabel */
  private async resolveRefs(tenantId: string, rows: { entity: string; entityId: string; data: unknown }[]) {
    const byTable = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = refKey(r.entity, r.data as Record<string, unknown> | null);
      if (!k || !UUID.test(r.entityId)) continue;
      const t = REF[k].table;
      byTable.set(t, (byTable.get(t) ?? new Set()).add(r.entityId));
    }
    const out = new Map<string, string>();
    for (const [table, ids] of byTable) {
      const expr = Object.values(REF).find((x) => x.table === table)!.expr;
      const res = await this.db.execute<{ id: string; ref: string }>(
        sql`SELECT id::text AS id, ${sql.raw(expr)} AS ref FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId} AND id = ANY(${pgArray([...ids])}::uuid[])`,
      );
      for (const x of res.rows) out.set(`${table}|${x.id}`, x.ref);
    }
    return out;
  }

  /** Pencarian: isi catatan, ID, atau nomor/nama dokumen yang dirujuk */
  private async searchCond(tenantId: string, q: string) {
    const like = `%${q}%`;
    const tables = [...new Map(Object.values(REF).map((r) => [r.table, r.expr])).entries()];
    const ids: string[] = [];
    for (const [table, expr] of tables) {
      const res = await this.db.execute<{ id: string }>(
        sql`SELECT id::text AS id FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId} AND (${sql.raw(expr)}) ILIKE ${like} LIMIT 200`,
      );
      ids.push(...res.rows.map((x) => x.id));
    }
    return sql`(${auditLogs.data}::text ILIKE ${like} OR ${auditLogs.entityId} ILIKE ${like}${ids.length ? sql` OR ${auditLogs.entityId} = ANY(${pgArray(ids)}::text[])` : sql``})`;
  }

  users(tenantId: string) {
    return this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.tenantId, tenantId));
  }
}

@ApiTags('Jejak audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly svc: AuditLogService) {}

  @Roles('ADMIN')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: AuditQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Roles('ADMIN')
  @Get('users')
  users(@CurrentUser() u: AuthUser) {
    return this.svc.users(u.tenantId);
  }
}

@Module({ controllers: [AuditLogController], providers: [AuditLogService] })
export class AuditLogModule {}

export { describe as describeAudit };
