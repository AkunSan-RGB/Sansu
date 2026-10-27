import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { SANSU_BUILD } from '@sansu/shared';
import { platformAdminEmails } from '../auth/platform-admin';
import { MailService } from '../mail/mail.service';
import { Db } from '../../db/db';
import { telegram } from './telegram-send';
import { InjectDb } from '../../db/db.module';
import { errorLogs } from '../../db/schema';

export interface ErrorEvent {
  status: number;
  method: string;
  path: string;
  error: unknown;
  tenantId?: string | null;
  userId?: string | null;
}

export { telegram };

/**
 * Pencatat error server (5xx): simpan ke tabel error_logs, beri peringatan
 * ke pemilik layanan (Telegram + email) dengan pembatasan agar tidak membanjir,
 * dan hapus catatan lebih lama dari 30 hari.
 */
@Injectable()
export class ErrorMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ErrorMonitor');
  private lastAlert = 0;
  private suppressed = 0;
  private timer?: NodeJS.Timeout;
  /** jeda minimum antar peringatan */
  static ALERT_GAP_MS = 15 * 60_000;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const purge = () => void this.purge().catch((e) => this.logger.warn(`Gagal membersihkan log error: ${e}`));
    this.timer = setInterval(purge, 24 * 60 * 60_000);
    setTimeout(purge, 60_000).unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async purge(days = 30) {
    await this.db.delete(errorLogs).where(lt(errorLogs.at, sql`now() - make_interval(days => ${days})`));
  }

  /** Tidak pernah melempar — monitor tidak boleh menjatuhkan respons */
  record(e: ErrorEvent) {
    void this.persist(e).catch((err) => this.logger.warn(`Gagal mencatat error: ${err}`));
  }

  private async persist(e: ErrorEvent) {
    const err = e.error instanceof Error ? e.error : new Error(String(e.error));
    const message = (err.message || 'Kesalahan tidak dikenal').slice(0, 2000);
    const path = e.path.split('?')[0].slice(0, 500);
    await this.db.insert(errorLogs).values({
      status: e.status,
      method: e.method.slice(0, 10),
      path,
      message,
      stack: err.stack?.slice(0, 8000) ?? null,
      tenantId: e.tenantId ?? null,
      userId: e.userId ?? null,
    });
    await this.alert(`${e.method} ${path} → ${e.status}\n${message}`);
  }

  private async alert(summary: string) {
    const now = Date.now();
    if (now - this.lastAlert < ErrorMonitor.ALERT_GAP_MS) {
      this.suppressed++;
      return;
    }
    const extra = this.suppressed ? `\n(+${this.suppressed} error lain sejak peringatan terakhir)` : '';
    this.lastAlert = now;
    this.suppressed = 0;
    const host = process.env.DOMAIN || 'server';
    const text = `⚠️ SANSU (${host}) mengalami error server\n${summary}${extra}\n\nLihat detail: Panel Admin → Sistem`;
    const sent = await telegram(text);
    if (!sent && this.mail.configured) {
      for (const to of platformAdminEmails()) {
        await this.mail.send({
          to,
          subject: 'Peringatan: error server SANSU',
          heading: 'Terjadi error di server',
          paragraphs: [summary, ...(extra ? [extra.trim()] : []), 'Buka Panel Admin → Sistem untuk melihat detailnya.'],
        });
      }
    }
  }
}

/** Ringkasan kesehatan server untuk Panel Admin → Sistem */
export async function systemStatus(db: Db) {
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  const dbLatencyMs = Date.now() - t0;
  const size = await db.execute<{ size: string; version: string }>(
    sql`select pg_database_size(current_database())::text as size, current_setting('server_version') as version`,
  );
  const counts = await db.execute<{ h24: number; d7: number }>(
    sql`select count(*) filter (where at > now() - interval '24 hours')::int as h24, count(*) filter (where at > now() - interval '7 days')::int as d7 from error_logs`,
  );
  const top = await db.execute<{ path: string; message: string; n: number; last: string }>(
    sql`select method || ' ' || path as path, message, count(*)::int as n, max(at) as last from error_logs where at > now() - interval '7 days' group by 1, 2 order by n desc limit 10`,
  );
  const recent = await db.execute(
    sql`select id, at, status, method, path, message, stack, tenant_id as "tenantId", user_id as "userId" from error_logs order by at desc limit 50`,
  );
  const mem = process.memoryUsage();
  return {
    version: SANSU_BUILD,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    memory: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
    db: {
      latencyMs: dbLatencyMs,
      sizeMb: Math.round(Number(size.rows[0]?.size ?? 0) / 1048576),
      version: size.rows[0]?.version,
    },
    errors: { last24h: counts.rows[0]?.h24 ?? 0, last7d: counts.rows[0]?.d7 ?? 0, top: top.rows, recent: recent.rows },
    alerts: { telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) },
    backup: lastBackup(),
  };
}

/** File backup terbaru di BACKUP_DIR (di produksi: folder backup dipasang read-only ke kontainer api) */
function lastBackup(): { configured: boolean; file?: string; at?: string; sizeMb?: number; count?: number } {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return { configured: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const all: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) for (const f of fs.readdirSync(`${dir}/${e.name}`)) all.push(`${e.name}/${f}`);
      else all.push(e.name);
    }
    const files = all
      .filter((f) => /\.dump$/.test(f))
      .map((f) => ({ f, st: fs.statSync(`${dir}/${f}`) }))
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    if (!files.length) return { configured: true, count: 0 };
    return {
      configured: true,
      file: files[0].f,
      at: files[0].st.mtime.toISOString(),
      sizeMb: Math.round((files[0].st.size / 1048576) * 10) / 10,
      count: files.length,
    };
  } catch {
    return { configured: true, count: 0 };
  }
}
