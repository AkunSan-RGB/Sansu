/**
 * Pengiriman pengingat lewat email:
 *  - ringkasan harian ke pemilik, admin, dan keuangan (hanya bila ada pengingat mendesak)
 *  - pengingat tagihan ke pelanggan (sebelum jatuh tempo, saat jatuh tempo, dan tunggakan berulang), bisa juga manual per faktur
 * Setiap pengiriman dicatat di `reminder_log` sehingga tidak terkirim dua kali meski penjadwal berjalan berulang.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../../common/settings.service';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { Role } from '../../db/schema';
import { RemindersService, type ReminderItem, type ReminderSettings } from './reminders.service';

const DIGEST_ROLES: Role[] = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'];
const DIGEST_HOUR_WIB = 7;
const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
const LEVEL_MARK = { error: '‼', warning: '•', info: '·' } as const;

/** Tahap pengingat tagihan pelanggan menurut selisih hari terhadap jatuh tempo (negatif = belum jatuh tempo) */
export function customerStage(daysFromDue: number, c: Pick<ReminderSettings, 'customerLeadDays' | 'customerRepeatDays' | 'customerMaxOverdue'>): string | null {
  if (daysFromDue < 0) return c.customerLeadDays > 0 && daysFromDue >= -c.customerLeadDays ? 'BEFORE' : null;
  if (daysFromDue === 0) return 'DUE';
  const n = Math.floor((daysFromDue - 1) / c.customerRepeatDays) + 1;
  return n <= c.customerMaxOverdue ? `OVERDUE-${n}` : null;
}

@Injectable()
export class ReminderMailer {
  private readonly logger = new Logger('Pengingat');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly reminders: RemindersService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  /** Catat pengiriman; false bila sudah pernah dicatat (tidak boleh dikirim lagi) */
  private async claim(tenantId: string, kind: 'DIGEST' | 'CUSTOMER', ref: string, stage: string, sentTo: string, force = false) {
    const r = await this.db.execute<{ id: string }>(
      force
        ? sql`INSERT INTO reminder_log (tenant_id, kind, ref, stage, sent_to) VALUES (${tenantId}, ${kind}, ${ref}, ${stage}, ${sentTo})
              ON CONFLICT (tenant_id, kind, ref, stage) DO UPDATE SET sent_at = now(), sent_to = EXCLUDED.sent_to RETURNING id`
        : sql`INSERT INTO reminder_log (tenant_id, kind, ref, stage, sent_to) VALUES (${tenantId}, ${kind}, ${ref}, ${stage}, ${sentTo})
              ON CONFLICT (tenant_id, kind, ref, stage) DO NOTHING RETURNING id`,
    );
    return r.rows.length > 0;
  }

  private release(tenantId: string, kind: string, ref: string, stage: string) {
    return this.db.execute(sql`DELETE FROM reminder_log WHERE tenant_id = ${tenantId} AND kind = ${kind} AND ref = ${ref} AND stage = ${stage}`);
  }

  // ---------- ringkasan harian ----------

  private digestMail(to: string, name: string, company: string, items: ReminderItem[]) {
    const urgent = items.filter((i) => i.level !== 'info');
    const shown = items.slice(0, 15);
    return {
      to,
      subject: `${urgent.length} hal perlu perhatian · ${company}`,
      heading: `Ringkasan hari ini, ${name.split(' ')[0]}`,
      paragraphs: [
        `Berikut hal yang perlu ditindaklanjuti di ${company}:`,
        ...shown.map((i) => `${LEVEL_MARK[i.level]} ${i.title} — ${i.detail}`),
        ...(items.length > shown.length ? [`… dan ${items.length - shown.length} pengingat lain di aplikasi.`] : []),
      ],
      action: { label: 'Buka SANSU', url: `${appUrl()}/` },
      footnote: 'Ringkasan ini dikirim otomatis. Atur atau matikan di Pengaturan › Pengingat.',
    };
  }

  /** Kirim ringkasan harian satu perusahaan; hanya ke pengguna aktif berperan keuangan yang punya pengingat mendesak */
  async sendDigest(tenantId: string, opts: { force?: boolean } = {}) {
    const cfg = await this.reminders.config(tenantId);
    if (!cfg.enabled || !cfg.emailDigest) return { sent: 0, skipped: 'nonaktif' };
    if (!this.mail.configured && process.env.NODE_ENV !== 'test') return { sent: 0, skipped: 'smtp' };
    const today = todayJakarta();
    const [t] = (await this.db.execute<{ name: string }>(sql`SELECT name FROM tenants WHERE id = ${tenantId}`)).rows;
    const users = (await this.db.execute<{ id: string; email: string; name: string; role: Role }>(sql`
      SELECT id, email, name, role FROM users WHERE tenant_id = ${tenantId} AND is_active AND role IN (${sql.join(DIGEST_ROLES.map((r) => sql`${r}::role`), sql`, `)})`)).rows;
    let sent = 0;
    for (const u of users) {
      const view = await this.reminders.forUser({ tenantId, sub: u.id, role: u.role } as AuthUser);
      if (!view.items.some((i) => i.level !== 'info')) continue;
      // dikirim manual pun dicatat, supaya penjadwal tidak mengirim ringkasan ganda pada hari yang sama
      if (!(await this.claim(tenantId, 'DIGEST', u.id, today, u.email, opts.force))) continue;
      const ok = await this.mail.send(this.digestMail(u.email, u.name, t.name, view.items));
      if (ok || process.env.NODE_ENV === 'test') sent++;
      else await this.release(tenantId, 'DIGEST', u.id, today); // gagal kirim: coba lagi pada putaran berikutnya
    }
    return { sent };
  }

  /** Kirim ringkasan ke pengguna yang meminta (uji / lihat contoh); tidak dicatat sebagai ringkasan harian */
  async sendDigestTo(user: AuthUser) {
    const view = await this.reminders.forUser(user, false);
    const [me] = (await this.db.execute<{ email: string; name: string }>(sql`SELECT email, name FROM users WHERE id = ${user.sub}`)).rows;
    const [t] = (await this.db.execute<{ name: string }>(sql`SELECT name FROM tenants WHERE id = ${user.tenantId}`)).rows;
    if (!view.items.length) throw new BadRequestException('Tidak ada pengingat saat ini, jadi tidak ada ringkasan yang dikirim');
    const ok = await this.mail.send(this.digestMail(me.email, me.name, t.name, view.items), true).catch((e: Error) => {
      throw new BadRequestException(`Email gagal dikirim: ${e.message}`);
    });
    return { sent: ok, to: me.email, items: view.items.length };
  }

  // ---------- pengingat tagihan ke pelanggan ----------

  private customerMail(p: { to: string; company: string; customer: string; number: string; due: string; outstanding: string; days: number; bank: string; phone: string; note: string; stage: string }) {
    const late = p.days > 0;
    return {
      to: p.to,
      subject: late ? `Pengingat: tagihan ${p.number} lewat jatuh tempo · ${p.company}` : `Pengingat tagihan ${p.number} · ${p.company}`,
      heading: late ? 'Tagihan sudah lewat jatuh tempo' : 'Pengingat pembayaran',
      paragraphs: [
        `Yth. ${p.customer},`,
        late
          ? `Kami mengingatkan bahwa tagihan ${p.number} sebesar ${rp(p.outstanding)} telah melewati jatuh tempo ${p.due} (${p.days} hari). Mohon segera dilakukan pembayaran.`
          : p.days === 0
            ? `Tagihan ${p.number} sebesar ${rp(p.outstanding)} jatuh tempo hari ini (${p.due}).`
            : `Tagihan ${p.number} sebesar ${rp(p.outstanding)} akan jatuh tempo pada ${p.due} (${-p.days} hari lagi).`,
        ...(p.bank ? [`Pembayaran dapat ditransfer ke:\n${p.bank}`] : []),
        ...(p.note ? [p.note] : []),
        'Abaikan email ini bila pembayaran sudah dilakukan. Terima kasih atas kerja samanya.',
        `Hormat kami,\n${p.company}${p.phone ? `\nTelp. ${p.phone}` : ''}`,
      ],
    };
  }

  private async invoiceInfo(tenantId: string, invoiceId: string) {
    const rows = (await this.db.execute<{ number: string; due: string; outstanding: string; name: string; email: string | null; company: string }>(sql`
      SELECT i.number, i.due_date::text AS due, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding, c.name, c.email, t.name AS company
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.id = ${invoiceId} AND i.status <> 'PAID'`)).rows;
    return rows[0];
  }

  private async branding(tenantId: string) {
    const b = await this.settings.section(this.db, tenantId, 'branding', { phone: '', bankInfo: '', invoiceNote: '' } as Record<string, string>);
    return { phone: b.phone ?? '', bank: b.bankInfo ?? '', note: b.invoiceNote ?? '' };
  }

  /** Kirim pengingat sekarang untuk satu faktur (tombol "Kirim pengingat"); satu kali per hari per faktur */
  async remindCustomer(user: AuthUser, invoiceId: string) {
    const inv = await this.invoiceInfo(user.tenantId, invoiceId);
    if (!inv) throw new NotFoundException('Faktur tidak ditemukan atau sudah lunas');
    if (!inv.email) throw new BadRequestException(`Pelanggan ${inv.name} belum punya alamat email. Isi di Data › Pelanggan.`);
    const today = todayJakarta();
    const days = Math.round((Date.parse(today) - Date.parse(inv.due)) / 86400000);
    if (!(await this.claim(user.tenantId, 'CUSTOMER', invoiceId, `MANUAL-${today}`, inv.email))) {
      throw new BadRequestException('Pengingat untuk faktur ini sudah dikirim hari ini');
    }
    const b = await this.branding(user.tenantId);
    const ok = await this.mail.send(this.customerMail({ to: inv.email, company: inv.company, customer: inv.name, number: inv.number, due: inv.due, outstanding: inv.outstanding, days, bank: b.bank, phone: b.phone, note: b.note, stage: 'MANUAL' }), true).catch(async (e: Error) => {
      await this.release(user.tenantId, 'CUSTOMER', invoiceId, `MANUAL-${today}`);
      throw new BadRequestException(`Email gagal dikirim: ${e.message}`);
    });
    return { sent: ok, to: inv.email };
  }

  /** Pengingat otomatis ke pelanggan untuk seluruh faktur terbuka perusahaan sesuai tahap jatuh tempo */
  async runCustomerReminders(tenantId: string) {
    const cfg = await this.reminders.config(tenantId);
    if (!cfg.enabled || !cfg.customerReminders) return { sent: 0, skipped: 'nonaktif' };
    if (!this.mail.configured && process.env.NODE_ENV !== 'test') return { sent: 0, skipped: 'smtp' };
    const today = todayJakarta();
    const rows = (await this.db.execute<{ id: string; number: string; due: string; outstanding: string; name: string; email: string; company: string }>(sql`
      SELECT i.id, i.number, i.due_date::text AS due, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding, c.name, c.email, t.name AS company
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND c.email IS NOT NULL AND c.email <> ''
        AND (i.total - i.paid_amount - i.returned_amount) > 0.005 AND i.is_opening = false`)).rows;
    const b = await this.branding(tenantId);
    let sent = 0;
    for (const r of rows) {
      const days = Math.round((Date.parse(today) - Date.parse(r.due)) / 86400000);
      const stage = customerStage(days, cfg);
      if (!stage) continue;
      if (!(await this.claim(tenantId, 'CUSTOMER', r.id, stage, r.email))) continue;
      const ok = await this.mail.send(this.customerMail({ to: r.email, company: r.company, customer: r.name, number: r.number, due: r.due, outstanding: r.outstanding, days, bank: b.bank, phone: b.phone, note: b.note, stage }));
      if (ok || process.env.NODE_ENV === 'test') sent++;
      else await this.release(tenantId, 'CUSTOMER', r.id, stage);
    }
    return { sent };
  }

  /** Satu putaran penjadwal untuk semua perusahaan: ringkasan harian (setelah pukul 07.00 WIB) dan pengingat pelanggan */
  async runAll() {
    const hour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
    if (hour < DIGEST_HOUR_WIB) return { digests: 0, customers: 0 };
    const tenants = (await this.db.execute<{ id: string }>(sql`SELECT id FROM tenants`)).rows;
    let digests = 0;
    let customers = 0;
    for (const t of tenants) {
      try {
        digests += (await this.sendDigest(t.id)).sent;
        customers += (await this.runCustomerReminders(t.id)).sent;
      } catch (e) {
        this.logger.error(`Pengingat perusahaan ${t.id}: ${(e as Error).message}`);
      }
    }
    return { digests, customers };
  }
}

/** Penjadwal: memeriksa tiap jam; pengiriman dijaga catatan agar tidak ganda */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Pengingat');
  constructor(private readonly mailer: ReminderMailer) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.mailer.runAll().catch((e) => this.logger.error(e));
    setTimeout(run, 90_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
