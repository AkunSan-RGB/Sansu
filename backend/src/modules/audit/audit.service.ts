import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { auditLogs, users } from '../../db/schema';
import { Category, describe } from './audit.shared';
import { AuditQueryDto } from './audit.dto';

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
