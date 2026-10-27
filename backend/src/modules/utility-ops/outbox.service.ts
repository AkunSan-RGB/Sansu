import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { MessagingConfigDto, OutboxEnqueueDto } from './outbox.dto';
import { OutboxRepository, OutboxRow } from './outbox.repository';
import { NoticesRepository } from './notices.repository';
import { NoticesService } from './notices.service';
import { schedulersEnabled } from '../../common/schedulers';

const SECTION = 'utilityMessaging';
const DEFAULTS = { enabled: false, url: '', authHeader: 'Authorization', token: '', bodyTemplate: '{"to":"{to}","message":"{message}"}' };
type Config = typeof DEFAULTS;
const MAX_ATTEMPTS = 3;

/** Alamat penyedia yang diizinkan: https dan bukan jaringan internal (kecuali dibuka lewat env untuk uji) */
export function assertSafeUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BadRequestException('Alamat penyedia pesan tidak valid'); }
  const insecureOk = process.env.OUTBOX_ALLOW_PRIVATE === 'true';
  if (u.protocol !== 'https:' && !(insecureOk && u.protocol === 'http:')) throw new BadRequestException('Alamat penyedia pesan harus https');
  const h = u.hostname.toLowerCase();
  const priv = h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || h.startsWith('[');
  if (priv && !insecureOk) throw new BadRequestException('Alamat penyedia pesan tidak boleh jaringan internal');
}

/**
 * Antrean pesan otomatis: tagihan dan surat peringatan dikirim ke penyedia pesan perusahaan (webhook) di latar, dengan percobaan ulang.
 * Pengiriman berhasil dicatat sebagai pemberitahuan (riwayat pengiriman) seperti pengiriman manual.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AntreanPesan');
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: OutboxRepository,
    private readonly notices: NoticesService,
    private readonly noticesRepo: NoticesRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {

    if (!schedulersEnabled()) return; // banyak proses: hanya satu yang menjalankan tugas berkala
    // di tes tidak berjalan sendiri (tes memanggil process); di produksi memeriksa antrean tiap 20 detik
    if (process.env.NODE_ENV === 'test' && process.env.OUTBOX_WORKER !== 'on') return;
    this.timer = setInterval(() => { void this.tick(); }, 20_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try { await this.process(); } catch (e) { this.log.error(`Antrean pesan gagal diproses: ${(e as Error).message}`); } finally { this.busy = false; }
  }

  // ---- pengaturan penyedia ----
  private config(tenantId: string): Promise<Config> { return this.settings.section(this.db, tenantId, SECTION, DEFAULTS); }
  async getConfig(tenantId: string) { const c = await this.config(tenantId); return { ...c, token: c.token ? '••••••••' : '', hasToken: !!c.token }; }
  async saveConfig(u: AuthUser, dto: MessagingConfigDto) {
    const before = await this.config(u.tenantId);
    const next: Config = { ...before, ...(Object.fromEntries(Object.entries(dto).filter(([k, v]) => v !== undefined && !(k === 'token' && (v === '' || /^•+$/.test(String(v)))))) as Partial<Config>) };
    if (next.enabled) {
      if (!next.url) throw new BadRequestException('Isi alamat penyedia pesan');
      assertSafeUrl(next.url);
      if (!next.bodyTemplate.includes('{to}') || !next.bodyTemplate.includes('{message}')) throw new BadRequestException('Badan permintaan harus memuat {to} dan {message}');
      try { JSON.parse(this.render(next.bodyTemplate, '628123456789', 'uji')); } catch { throw new BadRequestException('Badan permintaan bukan JSON yang valid'); }
    }
    await this.settings.saveSection(this.db, u.tenantId, SECTION, DEFAULTS, next);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityMessagingConfig', entityId: u.tenantId, data: { enabled: next.enabled, url: next.url } });
    return this.getConfig(u.tenantId);
  }

  private render(template: string, to: string, message: string) {
    const esc = (v: string) => JSON.stringify(v).slice(1, -1);
    return template.split('{to}').join(esc(to)).split('{message}').join(esc(message));
  }
  private async send(c: Config, to: string, message: string) {
    assertSafeUrl(c.url);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (c.token) headers[c.authHeader || 'Authorization'] = c.token;
    const res = await fetch(c.url, { method: 'POST', headers, body: this.render(c.bodyTemplate, to, message), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!res.ok) throw new Error(`Penyedia menjawab ${res.status}`);
  }
  async testSend(u: AuthUser, to: string) {
    const c = await this.config(u.tenantId);
    if (!c.enabled) throw new BadRequestException('Penyedia pesan belum diaktifkan');
    try { await this.send(c, normalizePhone(to), 'Uji pengiriman pesan dari SANSU. Abaikan pesan ini.'); } catch (e) { throw new BadRequestException(`Pengiriman uji gagal: ${(e as Error).message}`); }
    return { ok: true };
  }

  // ---- antrean ----
  async enqueue(u: AuthUser, dto: OutboxEnqueueDto) {
    const c = await this.config(u.tenantId);
    if (!c.enabled) throw new BadRequestException('Pengiriman otomatis belum diaktifkan. Admin mengisinya di Antrean pesan › Pengaturan penyedia.');
    if (!dto.all && !dto.items?.length) throw new BadRequestException('Pilih pelanggan atau antrekan semuanya');
    const cand = await this.notices.candidates(u.tenantId, dto.kind, dto.period, 50_000);
    const by = new Map(cand.rows.map((r) => [r.connection_id, r]));
    const items = dto.all ? cand.rows.map((r) => ({ connectionId: r.connection_id })) : dto.items!;
    let queued = 0; let noPhone = 0; let duplicates = 0; let notEligible = 0; let alreadySent = 0;
    for (const it of items) {
      const r = by.get(it.connectionId);
      if (!r) { notEligible++; continue; }
      if (r.alreadyToday) { alreadySent++; continue; }
      const to = normalizePhone(r.phone ?? '');
      if (to.length < 9) { noPhone++; continue; }
      const ok = await this.repo.enqueue(this.db, { tenantId: u.tenantId, kind: dto.kind, channel: dto.channel, connectionId: r.connection_id, invoiceId: r.invoice_id, to, message: r.message, userId: u.sub });
      if (ok) queued++; else duplicates++;
    }
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityOutbox', entityId: u.tenantId, data: { kind: dto.kind, channel: dto.channel, queued, noPhone, duplicates, notEligible, alreadySent } });
    return { queued, noPhone, duplicates, notEligible, alreadySent };
  }
  list(tenantId: string, status?: string) { return this.repo.list(this.db, tenantId, status || undefined); }
  async summary(tenantId: string) { return Object.fromEntries((await this.repo.summary(this.db, tenantId)).map((r) => [r.status, r.n])); }
  async retry(u: AuthUser, id: string) { if (!(await this.repo.retry(this.db, u.tenantId, id))) throw new NotFoundException('Pesan tidak ditemukan atau tidak bisa dicoba lagi'); return { ok: true }; }
  async cancel(u: AuthUser, id: string) { if (!(await this.repo.cancel(this.db, u.tenantId, id))) throw new NotFoundException('Pesan tidak ditemukan atau sudah diproses'); return { ok: true }; }

  /** Kirim sejumlah pesan yang menunggu. `tenantId` kosong = semua perusahaan (penjadwal). Mengembalikan jumlah terkirim dan gagal. */
  async process(tenantId?: string, limit = 50) {
    const rows = await this.repo.claim(this.db, limit, tenantId);
    let sent = 0; let failed = 0;
    const configs = new Map<string, Config>();
    for (const r of rows) {
      let c = configs.get(r.tenant_id);
      if (!c) { c = await this.config(r.tenant_id); configs.set(r.tenant_id, c); }
      try {
        if (!c.enabled) throw new Error('Penyedia pesan dinonaktifkan');
        await this.send(c, r.to_address, r.message);
        await this.repo.markSent(this.db, r.id);
        await this.noticesRepo.log(this.db, r.tenant_id, r.created_by_id ?? r.tenant_id, r.kind, r.channel, [{ connectionId: r.connection_id, invoiceId: r.invoice_id ?? undefined }], 'Dikirim otomatis dari antrean pesan');
        sent++;
      } catch (e) {
        const attempts = r.attempts + 1;
        await this.repo.markFailed(this.db, r.id, attempts, (e as Error).message, attempts >= MAX_ATTEMPTS);
        failed++;
      }
    }
    return { sent, failed, picked: rows.length };
  }
}

/** Nomor Indonesia ke format internasional tanpa tanda (08… → 628…) */
export function normalizePhone(raw: string) {
  const d = String(raw).replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? `62${d.slice(1)}` : d.startsWith('8') ? `62${d}` : d;
}
export type { OutboxRow };
