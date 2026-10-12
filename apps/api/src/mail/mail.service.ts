import { Injectable } from '@nestjs/common';
import * as Brevo from '@getbrevo/brevo';

@Injectable()
export class MailService {
  private apiInstance = new Brevo.TransactionalEmailsApi();

  constructor() {
    // Mengaktifkan API Key dari environment variable
    this.apiInstance.setApiKey(
      Brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY,
    );
  }

  async sendEmail(toEmail: string, subject: string, htmlContent: string) {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    
    sendSmtpEmail.sender = {
      name: process.env.BREVO_SENDER_NAME || 'SANSU ERP',
      email: process.env.BREVO_SENDER_EMAIL || 'sansuglobalinti@gmail.com',
    };
    sendSmtpEmail.to = [{ email: toEmail }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;

    try {
      const result = await this.apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log('Email berhasil dikirim:', result);
      return { success: true, result };
    } catch (error) {
      console.error('Gagal mengirim email via Brevo:', error);
      throw new Error('Gagal mengirim email');
    }
  }
}