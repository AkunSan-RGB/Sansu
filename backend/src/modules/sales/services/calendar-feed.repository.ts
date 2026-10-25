import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk CalendarFeed: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CalendarFeedRepository {
  /** Dipakai oleh CalendarFeedService.list */
  querySchedulingFeed(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT f.id, f.name, f.token_prefix AS "tokenPrefix", f.resource_id AS "resourceId", r.name AS "resourceName", f.created_at AS "createdAt", f.last_used_at AS "lastUsedAt", f.revoked_at AS "revokedAt" FROM scheduling_feeds f LEFT JOIN scheduling_resources r ON r.id = f.resource_id WHERE f.tenant_id = ${tenantId} ORDER BY f.created_at DESC`,
    );
  }

  /** Dipakai oleh CalendarFeedService.create */
  querySchedulingResource(db: DbOrTx, resourceId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM scheduling_resources WHERE id = ${resourceId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh CalendarFeedService.revoke */
  queryRevoke(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ name: string }>(
      sql`UPDATE scheduling_feeds SET revoked_at = now() WHERE id = ${id} AND tenant_id = ${tenantId} AND revoked_at IS NULL RETURNING name`,
    );
  }

  /** Dipakai oleh CalendarFeedService.render */
  queryRender(db: DbOrTx, id: string) {
    return db.execute(sql`UPDATE scheduling_feeds SET last_used_at = now() WHERE id = ${id}`);
  }

  /** Dipakai oleh CalendarFeedService.render */
  queryResourceBooking(
    db: DbOrTx,
    f: {
      id: string;
      tenant_id: string;
      resource_id: string | null;
      name: string;
      revoked_at: Date | null;
      last_used_at: Date | null;
    },
    to: string,
    from: string,
  ) {
    return db.execute<{
      id: string;
      title: string;
      resourceName: string;
      startsAt: Date;
      endsAt: Date;
      status: string;
    }>(sql`
      SELECT b.id, b.title, r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id
      WHERE b.tenant_id = ${f.tenant_id} AND b.status IN ('BOOKED', 'DONE') AND b.starts_at < (${to}::date + 1)::timestamptz AND b.ends_at > ${from}::date::timestamptz
        ${f.resource_id ? sql`AND b.resource_id = ${f.resource_id}` : sql``}
      ORDER BY b.starts_at LIMIT 2000`);
  }
}
