/**
 * Tautan kalender (iCal) untuk jadwal sumber daya Jasa: satu arah, SANSU → Google Calendar/Outlook/Apple.
 *
 * Tautan memuat token rahasia (disimpan hanya sebagai hash, tampil sekali saat dibuat) dan dapat dicabut. Isinya hanya waktu dan judul
 * pemesanan aktif serta nama sumber daya; nama pelanggan dan catatan tidak dikeluarkan. Setiap akses tanpa token sah ditolak 404.
 */
import { BadRequestException, Body, Controller, Get, Header, Injectable, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { AppsService } from '../../../common/apps/apps.service';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../../common/auth/decorators';
import { addDays, todayJakarta } from '../../../common/utils/dates';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';

const hash = (k: string) => createHash('sha256').update(k).digest('hex');
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

export class FeedDto {
  @ApiProperty({ example: 'Kalender tim' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiPropertyOptional({ description: 'Kosong = semua sumber daya' }) @IsOptional() @IsUUID() resourceId?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lipat baris > 75 byte sesuai RFC 5545 (potong di batas karakter, bukan di tengah karakter multibyte) */
const fold = (line: string) => {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
};
const utc = (d: Date | string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildIcs(calName: string, rows: { id: string; title: string; resourceName: string; startsAt: Date | string; endsAt: Date | string; status: string }[]) {
  const stamp = utc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SANSU//Jadwal//ID', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`, 'X-WR-TIMEZONE:Asia/Jakarta', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const r of rows) {
    lines.push('BEGIN:VEVENT', `UID:${r.id}@sansu`, `DTSTAMP:${stamp}`, `DTSTART:${utc(r.startsAt)}`, `DTEND:${utc(r.endsAt)}`, `SUMMARY:${esc(`${r.title} (${r.resourceName})`)}`, 'STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

@Injectable()
export class CalendarFeedService {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService, private readonly apps: AppsService) {}

  async list(tenantId: string) {
    const r = await this.db.execute(sql`SELECT f.id, f.name, f.token_prefix AS "tokenPrefix", f.resource_id AS "resourceId", r.name AS "resourceName", f.created_at AS "createdAt", f.last_used_at AS "lastUsedAt", f.revoked_at AS "revokedAt" FROM scheduling_feeds f LEFT JOIN scheduling_resources r ON r.id = f.resource_id WHERE f.tenant_id = ${tenantId} ORDER BY f.created_at DESC`);
    return r.rows;
  }

  async create(u: AuthUser, dto: FeedDto) {
    if (dto.resourceId) {
      const ok = await this.db.execute(sql`SELECT 1 FROM scheduling_resources WHERE id = ${dto.resourceId} AND tenant_id = ${u.tenantId}`);
      if (!ok.rows.length) throw new BadRequestException('Sumber daya tidak ditemukan');
    }
    const token = `cal_${randomBytes(24).toString('base64url')}`;
    const row = (await this.db.execute<{ id: string }>(sql`INSERT INTO scheduling_feeds (tenant_id, resource_id, name, token_hash, token_prefix, created_by_id) VALUES (${u.tenantId}, ${dto.resourceId ?? null}, ${dto.name.trim()}, ${hash(token)}, ${token.slice(0, 8)}, ${u.sub}) RETURNING id`)).rows[0];
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SchedulingFeed', entityId: row.id, data: { name: dto.name, resourceId: dto.resourceId ?? null } });
    // token hanya tampil sekali; tautan lengkap dibentuk oleh klien dari alamat situs
    return { id: row.id, token, path: `/api/calendar/${token}.ics` };
  }

  async revoke(u: AuthUser, id: string) {
    const r = await this.db.execute<{ name: string }>(sql`UPDATE scheduling_feeds SET revoked_at = now() WHERE id = ${id} AND tenant_id = ${u.tenantId} AND revoked_at IS NULL RETURNING name`);
    if (!r.rows.length) throw new NotFoundException('Tautan tidak ditemukan atau sudah dicabut');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REVOKE', entity: 'SchedulingFeed', entityId: id, data: { name: r.rows[0].name } });
    return { ok: true };
  }

  /** Isi kalender untuk token publik; semua kegagalan sama-sama 404 agar token tidak dapat ditebak bertahap */
  async render(rawToken: string) {
    const token = rawToken.replace(/\.ics$/i, '');
    if (!/^cal_[A-Za-z0-9_-]{20,80}$/.test(token)) throw new NotFoundException();
    const f = (await this.db.execute<{ id: string; tenant_id: string; resource_id: string | null; name: string; revoked_at: Date | null; last_used_at: Date | null }>(sql`SELECT id, tenant_id, resource_id, name, revoked_at, last_used_at FROM scheduling_feeds WHERE token_hash = ${hash(token)}`)).rows[0];
    if (!f || f.revoked_at || !(await this.apps.isEnabled(f.tenant_id, ['sales']))) throw new NotFoundException();
    if (!f.last_used_at || Date.now() - new Date(f.last_used_at).getTime() > 5 * 60_000) await this.db.execute(sql`UPDATE scheduling_feeds SET last_used_at = now() WHERE id = ${f.id}`);
    const from = addDays(todayJakarta(), -PAST_DAYS);
    const to = addDays(todayJakarta(), FUTURE_DAYS);
    const rows = (await this.db.execute<{ id: string; title: string; resourceName: string; startsAt: Date; endsAt: Date; status: string }>(sql`
      SELECT b.id, b.title, r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id
      WHERE b.tenant_id = ${f.tenant_id} AND b.status IN ('BOOKED', 'DONE') AND b.starts_at < (${to}::date + 1)::timestamptz AND b.ends_at > ${from}::date::timestamptz
        ${f.resource_id ? sql`AND b.resource_id = ${f.resource_id}` : sql``}
      ORDER BY b.starts_at LIMIT 2000`)).rows;
    return buildIcs(f.name, rows);
  }
}

@ApiTags('Penjadwalan')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN')
@Controller('scheduling/feeds')
export class CalendarFeedController {
  constructor(private readonly svc: CalendarFeedService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: FeedDto) { return this.svc.create(u, dto); }
  @Post(':id/revoke') revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.revoke(u, id); }
}

/** Alamat publik yang dilanggan aplikasi kalender; dilindungi token rahasia, bukan login */
@ApiTags('Penjadwalan')
@Public()
@Controller('calendar')
export class CalendarPublicController {
  constructor(private readonly svc: CalendarFeedService) {}
  @Get(':token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex')
  feed(@Param('token') token: string) { return this.svc.render(token); }
}
