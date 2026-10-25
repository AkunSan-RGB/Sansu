/**
 * Notifikasi Telegram per pengguna (gratis, tanpa penyedia berbayar). Pengguna menghubungkan akunnya sekali: klik tautan
 * `t.me/<bot>?start=<kode>`, bot menerima `/start <kode>` dan mencatat chat pribadi pengguna itu. Hanya chat pribadi yang diterima
 * (bukan grup) agar tautan persetujuan tidak terbaca orang lain. Tanpa TELEGRAM_BOT_TOKEN semua fungsi diam dan email tetap jalan.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';
import { patchById } from '../../db/owned';
import { TelegramRepository } from './telegram.repository';

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number; type: string } };
}

const LINK_TTL_MS = 15 * 60_000;
/** Kode disimpan sebagai hash: kebocoran basis data tidak membuka kode yang masih berlaku */
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
/** Percobaan kode salah per chat dibatasi agar tidak bisa menebak kode atau membanjiri balasan bot */
const MAX_BAD_TRIES = 8;
const BAD_WINDOW_MS = 15 * 60_000;

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  private polling = false;
  private offset = 0;
  /** Pesan yang dikirim selama pengujian (tidak ada panggilan jaringan saat NODE_ENV=test) */
  readonly outbox: { chatId: string; text: string }[] = [];

  private readonly badTries = new Map<string, { n: number; until: number }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly repo: TelegramRepository,
  ) {}

  private get token() {
    return process.env.TELEGRAM_BOT_TOKEN;
  }
  get enabled() {
    return !!this.token;
  }
  get botUsername() {
    return (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '');
  }

  async send(chatId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    if (process.env.NODE_ENV === 'test') {
      this.outbox.push({ chatId, text });
      return true;
    }
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Kirim ke pengguna yang sudah menghubungkan Telegram; pengguna lain dilewati. Mengembalikan jumlah terkirim. */
  async notifyUsers(userIds: string[], text: string): Promise<number> {
    if (!this.enabled || !userIds.length) return 0;
    const rows = await this.repo.listUsersByIdAndIsActiveAndTelegramChatId(this.db, userIds);
    let sent = 0;
    for (const r of rows) if (r.chat && (await this.send(r.chat, text))) sent++;
    return sent;
  }

  async status(userId: string) {
    const [u] = await this.repo.findUsersById(this.db, userId);
    return { enabled: this.enabled, botUsername: this.botUsername || null, linked: !!u?.chat };
  }

  /** Buat kode tautan sekali pakai (berlaku 15 menit) dan tautan pembuka bot */
  async createLink(userId: string) {
    const code = randomBytes(18).toString('base64url');
    await patchById(this.db, users, userId, { telegramLinkCode: hashCode(code), telegramLinkExpires: new Date(Date.now() + LINK_TTL_MS) });
    return { code, url: this.botUsername ? `https://t.me/${this.botUsername}?start=${code}` : null, expiresInMinutes: LINK_TTL_MS / 60_000 };
  }

  async unlink(userId: string, tenantId?: string) {
    await patchById(this.db, users, userId, { telegramChatId: null, telegramLinkCode: null, telegramLinkExpires: null });
    if (tenantId) await this.audit.log(this.db, { tenantId, userId, action: 'TELEGRAM_UNLINK', entity: 'User', entityId: userId });
    return { ok: true };
  }

  /** Proses pesan masuk ke bot: `/start <kode>` menghubungkan akun, `/stop` memutuskan */
  async handleUpdate(u: TelegramUpdate) {
    const m = u.message;
    if (!m?.text || m.chat.type !== 'private') return;
    const chatId = String(m.chat.id);
    const [cmd, arg] = m.text.trim().split(/\s+/);
    if (cmd === '/stop') {
      await this.repo.updateUsersByTelegramChatId(this.db, chatId);
      await this.send(chatId, 'Notifikasi SANSU dimatikan untuk chat ini.');
      return;
    }
    if (cmd !== '/start') return;
    if (!arg) {
      await this.send(chatId, 'Halo! Untuk menerima notifikasi SANSU, buka SANSU › Keamanan akun › Hubungkan Telegram, lalu klik tautan yang muncul.');
      return;
    }
    const tries = this.badTries.get(chatId);
    if (tries && tries.until > Date.now() && tries.n >= MAX_BAD_TRIES) return; // terlalu banyak kode salah: diam
    const [user] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, tenantId: users.tenantId })
      .from(users)
      .where(and(eq(users.telegramLinkCode, hashCode(arg)), gt(users.telegramLinkExpires, new Date()), eq(users.isActive, true)));
    if (!user) {
      const t = tries && tries.until > Date.now() ? tries : { n: 0, until: Date.now() + BAD_WINDOW_MS };
      this.badTries.set(chatId, { n: t.n + 1, until: t.until });
      // pesan sama untuk kode salah, kedaluwarsa, atau terpakai: tidak membocorkan kode mana yang pernah ada
      await this.send(chatId, 'Kode tidak valid atau sudah kedaluwarsa. Buat tautan baru di SANSU › Keamanan akun.');
      return;
    }
    this.badTries.delete(chatId);
    // satu chat hanya untuk satu pengguna
    await this.repo.updateUsersByTelegramChatId(this.db, chatId);
    await patchById(this.db, users, user.id, { telegramChatId: chatId, telegramLinkCode: null, telegramLinkExpires: null });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.id, action: 'TELEGRAM_LINK', entity: 'User', entityId: user.id });
    await this.send(chatId, `Terhubung ✅ Halo ${user.name}, notifikasi persetujuan SANSU akan dikirim ke sini. Kirim /stop untuk berhenti.`);
    // pemberitahuan ke email: bila bukan Anda yang menghubungkan, putuskan segera di Keamanan akun
    if (this.mail.configured) {
      await this.mail
        .send({ to: user.email, subject: 'Telegram dihubungkan ke akun SANSU Anda', heading: 'Telegram terhubung', paragraphs: ['Sebuah akun Telegram baru saja dihubungkan ke akun SANSU Anda untuk menerima notifikasi persetujuan.', 'Jika bukan Anda, putuskan di SANSU › Keamanan akun dan ganti kata sandi Anda.'] })
        .catch(() => undefined);
    }
  }

  // ----- Menarik pesan masuk (long polling): tidak perlu alamat publik/webhook -----
  onModuleInit() {
    if (!this.enabled || process.env.NODE_ENV === 'test') return;
    this.polling = true;
    void this.loop();
  }
  onModuleDestroy() {
    this.polling = false;
  }
  private async loop() {
    while (this.polling) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}&allowed_updates=%5B%22message%22%5D`, { signal: AbortSignal.timeout(35_000) });
        if (r.status === 409) {
          // webhook aktif di bot ini: pemantauan pesan masuk dimatikan
          this.logger.warn('Bot memakai webhook; penautan akun lewat polling dimatikan');
          return;
        }
        const j = (await r.json()) as { ok: boolean; result?: TelegramUpdate[] };
        for (const u of j.result ?? []) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch((e) => this.logger.warn(`Gagal memproses pesan: ${(e as Error).message}`));
        }
      } catch {
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  }
}
