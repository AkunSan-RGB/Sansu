import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { auditLogs, users } from '../../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { AuditQueryDto } from './audit.dto';
import type { SQL } from 'drizzle-orm';

/** Larik Postgres sebagai satu parameter: {a,b,c} */
export const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '')}"`).join(',')}}`;

/** Akses data untuk Audit: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AuditRepository {
  /** Dipakai oleh AuditLogService.list */
  listAuditLogsWithUsersById(
    db: DbOrTx,
    conds: (SQL<unknown> | undefined)[],
    q: AuditQueryDto,
    size: number,
    page: number,
  ) {
    return db
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
  }

  /** Dipakai oleh AuditLogService.resolveRefs */
  queryResolveRefs(db: DbOrTx, expr: string, table: string, tenantId: string, ids: Set<string>) {
    return db.execute<{ id: string; ref: string }>(
      sql`SELECT id::text AS id, ${sql.raw(expr)} AS ref FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId} AND id = ANY(${pgArray([...ids])}::uuid[])`,
    );
  }

  /** Dipakai oleh AuditLogService.searchCond */
  querySearchCond(db: DbOrTx, table: string, tenantId: string, expr: string, like: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId} AND (${sql.raw(expr)}) ILIKE ${like} LIMIT 200`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AuditLogService.users */
  listUsers(db: DbOrTx, tenantId: NonNullable<(typeof users.$inferSelect)['tenantId']>) {
    return db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.tenantId, tenantId));
  }
}
