import { MailService, parseFrom } from './mail.service';

const KEY = 'xkeysib-RAHASIA-uji';
const ENV_KEYS = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'MAIL_FROM', 'MAIL_REPLY_TO', 'SMTP_HOST'];

describe('MailService — Brevo lewat API', () => {
  const saved: Record<string, string | undefined> = {};
  const realFetch = global.fetch;
  let calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (status: number, body = '{"messageId":"<abc>"}') =>
    (global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status });
    }) as typeof fetch);

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    calls = [];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
    global.fetch = realFetch;
  });

  const mail = { to: 'orang@contoh.id', subject: 'Uji', heading: 'Halo', paragraphs: ['Isi pesan'] };

  it('dengan BREVO_API_KEY: mengirim lewat API Brevo dengan pengirim, penerima, html, dan teks yang benar', async () => {
    process.env.BREVO_API_KEY = KEY;
    process.env.BREVO_SENDER_EMAIL = 'pengirim@sansu.id';
    process.env.BREVO_SENDER_NAME = 'SANSU';
    process.env.MAIL_REPLY_TO = 'bantuan@sansu.id';
    fakeFetch(201);
    const svc = new MailService();
    expect(svc.configured).toBe(true);
    expect(await svc.send(mail)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0].init.headers as Record<string, string>)['api-key']).toBe(KEY);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ sender: { name: 'SANSU', email: 'pengirim@sansu.id' }, to: [{ email: 'orang@contoh.id' }], subject: 'Uji', replyTo: { email: 'bantuan@sansu.id' } });
    expect(body.htmlContent).toContain('Isi pesan');
    expect(body.textContent).toContain('Isi pesan');
  });

  it('pengirim diambil dari MAIL_FROM bila BREVO_SENDER_EMAIL kosong', async () => {
    process.env.BREVO_API_KEY = KEY;
    process.env.MAIL_FROM = 'SANSU Resmi <noreply@sansu.id>';
    fakeFetch(201);
    await new MailService().send(mail);
    expect(JSON.parse(String(calls[0].init.body)).sender).toEqual({ name: 'SANSU Resmi', email: 'noreply@sansu.id' });
  });

  it('Brevo menolak: send() mengembalikan false; mode strict melempar galat tanpa membocorkan kunci', async () => {
    process.env.BREVO_API_KEY = KEY;
    process.env.BREVO_SENDER_EMAIL = 'pengirim@sansu.id';
    fakeFetch(401, '{"message":"Key not found"}');
    const svc = new MailService();
    expect(await svc.send(mail)).toBe(false);
    await expect(svc.send(mail, true)).rejects.toThrow(/401/);
    await svc.send(mail, true).catch((e) => expect(String(e.message)).not.toContain(KEY));
  });

  it('pengirim belum diatur: galat jelas, tidak ada permintaan ke Brevo', async () => {
    process.env.BREVO_API_KEY = KEY;
    fakeFetch(201);
    await expect(new MailService().send(mail, true)).rejects.toThrow(/BREVO_SENDER_EMAIL/);
    expect(calls).toHaveLength(0);
  });

  it('tanpa BREVO_API_KEY dan SMTP_HOST: tidak dikirim, dicatat di outbox (perilaku lama)', async () => {
    fakeFetch(201);
    const svc = new MailService();
    expect(svc.configured).toBe(false);
    expect(await svc.send(mail)).toBe(false);
    expect(svc.outbox).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('parseFrom', () => {
  it('memisah nama dan alamat', () => {
    expect(parseFrom('SANSU <a@b.id>')).toEqual({ name: 'SANSU', email: 'a@b.id' });
    expect(parseFrom('"PT Sansu, Tbk" <a@b.id>')).toEqual({ name: 'PT Sansu, Tbk', email: 'a@b.id' });
    expect(parseFrom('a@b.id')).toEqual({ email: 'a@b.id' });
    expect(parseFrom('<a@b.id>')).toEqual({ name: undefined, email: 'a@b.id' });
  });
});
