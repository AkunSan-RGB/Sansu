import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { randomUUID } from 'crypto';
import { senderDomain } from './mail-check';

export interface Mail {
  to: string;
  subject: string;
  /** Judul besar di badan email */
  heading: string;
  /** Paragraf isi (teks biasa, akan di-escape) */
  paragraphs: string[];
  /** Tombol ajakan (opsional) */
  action?: { label: string; url: string };
  /** Catatan kecil di bawah tombol */
  footnote?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Alamat aplikasi untuk tautan di email, mis. https://app.sansu.id */
export const appUrl = () => (process.env.APP_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:5173')).replace(/\/+$/, '');

/** HTML email bermerek SANSU — tabel sederhana agar tampil benar di Gmail/Outlook */
export function renderMail(m: Mail): { html: string; text: string } {
  const p = m.paragraphs.map((x) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937">${esc(x)}</p>`).join('');
  const btn = m.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="background:#1C3160;border-radius:8px"><a href="${esc(m.action.url)}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none">${esc(m.action.label)}</a></td></tr></table>
       <p style="margin:0 0 14px;font-size:12px;color:#6b7280;word-break:break-all">Jika tombol tidak berfungsi, salin tautan ini ke browser:<br>${esc(m.action.url)}</p>`
    : '';
  const foot = m.footnote ? `<p style="margin:0;font-size:13px;color:#6b7280">${esc(m.footnote)}</p>` : '';
  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fa;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e9f0">
<tr><td style="background:#0D1628;padding:18px 28px"><span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.08em">SANSU</span><span style="display:inline-block;width:18px;height:3px;background:#16A37B;margin-left:10px;vertical-align:middle"></span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#101C33">${esc(m.heading)}</h1>${p}${btn}${foot}
</td></tr>
<tr><td style="padding:16px 28px;background:#f5f7fa;font-size:12px;color:#6b7280">SANSU · Alur Bisnis Terhubung dalam Satu Sistem<br>Email ini dikirim otomatis, mohon tidak dibalas.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [m.heading, '', ...m.paragraphs, ...(m.action ? ['', `${m.action.label}: ${m.action.url}`] : []), ...(m.footnote ? ['', m.footnote] : [])].join('\n');
  return { html, text };
}

/**
 * Pengirim email lewat SMTP (Brevo, Gmail, Zoho, server sendiri, ...).
 * Bila SMTP_HOST belum diisi, email tidak dikirim tetapi dicatat di log server
 * (dan disimpan di `outbox` saat pengujian) — fitur tetap bisa dicoba.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Email');
  private transporter?: Transporter;
  /** Email terakhir (hanya diisi saat SMTP tidak aktif) — dipakai pengujian */
  readonly outbox: (Mail & { at: Date })[] = [];

  /** Brevo lewat API (HTTPS) — dipakai di hosting yang memblokir port SMTP (mis. Railway paket gratis/Hobby) */
  private get brevoKey() {
    return process.env.BREVO_API_KEY?.trim() || undefined;
  }

  get configured() {
    return !!this.brevoKey || !!process.env.SMTP_HOST;
  }

  get from() {
    return process.env.MAIL_FROM || `SANSU <${process.env.SMTP_USER || 'no-reply@localhost'}>`;
  }

  private transport() {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT || 587);
      this.transporter = createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    }
    return this.transporter;
  }

  /** Kirim lewat REST API Brevo. Pengirim: BREVO_SENDER_EMAIL/NAME, bila kosong diambil dari MAIL_FROM. */
  private async sendViaBrevo(m: Mail, html: string, text: string) {
    const parsed = parseFrom(this.from);
    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || parsed.email;
    if (!senderEmail || senderEmail.endsWith('@localhost')) throw new Error('Pengirim email belum diatur: isi BREVO_SENDER_EMAIL (alamat yang sudah diverifikasi di Brevo)');
    const replyTo = process.env.MAIL_REPLY_TO?.trim();
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.brevoKey!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME?.trim() || parsed.name || 'SANSU', email: senderEmail },
        to: [{ email: m.to }],
        subject: m.subject,
        htmlContent: html,
        textContent: text,
        ...(replyTo ? { replyTo: { email: parseFrom(replyTo).email ?? replyTo } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Brevo menolak email (${res.status}): ${detail}`);
    }
  }

  /** Kirim email. Tidak pernah melempar galat ke pemanggil kecuali `strict` (dipakai tombol "kirim email uji"). */
  async send(m: Mail, strict = false): Promise<boolean> {
    if (!this.configured) {
      this.outbox.push({ ...m, at: new Date() });
      if (this.outbox.length > 50) this.outbox.shift();
      this.logger.log(`[Email belum diatur (SMTP/Brevo) — tidak dikirim] Ke: ${m.to} · ${m.subject}${m.action ? ` · ${m.action.url}` : ''}`);
      if (strict) throw new Error('Email belum diatur (isi BREVO_API_KEY atau SMTP_HOST dkk.)');
      return false;
    }
    try {
      const { html, text } = renderMail(m);
      if (this.brevoKey) {
        await this.sendViaBrevo(m, html, text);
        return true;
      }
      // Message-ID memakai domain pengirim dan Reply-To tetap (MAIL_REPLY_TO) agar konsisten di mata filter spam
      const domain = senderDomain(this.from) ?? 'localhost';
      await this.transport().sendMail({ from: this.from, replyTo: process.env.MAIL_REPLY_TO || undefined, to: m.to, subject: m.subject, html, text, messageId: `<${randomUUID()}@${domain}>` });
      return true;
    } catch (e) {
      this.logger.error(`Gagal kirim email ke ${m.to}: ${(e as Error).message}`);
      if (strict) throw e;
      return false;
    }
  }
}

/** "Nama <alamat@domain>" atau "alamat@domain" → nama & alamat. */
export function parseFrom(from: string): { name?: string; email?: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || undefined, email: m[2].trim() };
  return { email: from.trim() || undefined };
}
