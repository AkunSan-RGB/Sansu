import { Injectable, Logger } from '@nestjs/common';

/**
 * Pengirim email transaksional lewat REST API Brevo (tanpa SDK, jadi tidak terikat versi paket).
 * Env: BREVO_API_KEY (wajib), BREVO_SENDER_NAME, BREVO_SENDER_EMAIL.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendEmail(toEmail: string, subject: string, htmlContent: string) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error('BREVO_API_KEY belum diisi');

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME || 'SANSU ERP',
          email: process.env.BREVO_SENDER_EMAIL || 'sansuglobalinti@gmail.com',
        },
        to: [{ email: toEmail }],
        subject,
        htmlContent,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Gagal mengirim email via Brevo (${res.status}): ${detail}`);
      throw new Error('Gagal mengirim email');
    }
    const result = (await res.json().catch(() => ({}))) as { messageId?: string };
    this.logger.log(`Email terkirim ke ${toEmail} (${result.messageId ?? 'tanpa id'})`);
    return { success: true, result };
  }
}
