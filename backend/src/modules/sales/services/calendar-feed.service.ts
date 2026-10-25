import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppsService } from '../../../common/apps/apps.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { addDays, todayJakarta } from '../../../common/utils/dates';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { FeedDto } from './calendar-feed.dto';
import { CalendarFeedRepository } from './calendar-feed.repository';

const PAST_DAYS = 30;

const FUTURE_DAYS = 180;

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
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService, private readonly apps: AppsService,
    private readonly repo: CalendarFeedRepository) {}

  async list(tenantId: string) {
    const r = await this.repo.querySchedulingFeed(this.db, tenantId);
    return r.rows;
  }

  async create(u: AuthUser, dto: FeedDto) {
    if (dto.resourceId) {
      const ok = await this.repo.querySchedulingResource(this.db, dto.resourceId, u.tenantId);
      if (!ok.rows.length) throw new BadRequestException('Sumber daya tidak ditemukan');
    }
    const token = `cal_${randomBytes(24).toString('base64url')}`;
    const row = (await this.repo.querySchedulingFeedForCreate(this.db, u, dto, token)).rows[0];
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SchedulingFeed', entityId: row.id, data: { name: dto.name, resourceId: dto.resourceId ?? null } });
    // token hanya tampil sekali; tautan lengkap dibentuk oleh klien dari alamat situs
    return { id: row.id, token, path: `/api/calendar/${token}.ics` };
  }

  async revoke(u: AuthUser, id: string) {
    const r = await this.repo.queryRevoke(this.db, id, u.tenantId);
    if (!r.rows.length) throw new NotFoundException('Tautan tidak ditemukan atau sudah dicabut');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REVOKE', entity: 'SchedulingFeed', entityId: id, data: { name: r.rows[0].name } });
    return { ok: true };
  }

  /** Isi kalender untuk token publik; semua kegagalan sama-sama 404 agar token tidak dapat ditebak bertahap */
  async render(rawToken: string) {
    const token = rawToken.replace(/\.ics$/i, '');
    if (!/^cal_[A-Za-z0-9_-]{20,80}$/.test(token)) throw new NotFoundException();
    const f = (await this.repo.querySchedulingFeedForRender(this.db, token)).rows[0];
    if (!f || f.revoked_at || !(await this.apps.isEnabled(f.tenant_id, ['sales']))) throw new NotFoundException();
    if (!f.last_used_at || Date.now() - new Date(f.last_used_at).getTime() > 5 * 60_000) await this.repo.queryRender(this.db, f.id);
    const from = addDays(todayJakarta(), -PAST_DAYS);
    const to = addDays(todayJakarta(), FUTURE_DAYS);
    const rows = (await this.repo.queryResourceBooking(this.db, f, to, from)).rows;
    return buildIcs(f.name, rows);
  }
}
