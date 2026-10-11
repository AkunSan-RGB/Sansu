/**
 * Pemeriksaan kesiapan email agar tidak masuk spam: kecocokan domain pengirim, SPF, DKIM (selector umum), DMARC,
 * dan alamat aplikasi di tautan email. Penilaian (`evaluateMailSetup`) murni dan diuji; pencarian DNS dipisah.
 */
import { promises as dns } from 'dns';

export type CheckStatus = 'OK' | 'WARN' | 'ERROR';
export interface MailCheckItem {
  key: string;
  title: string;
  status: CheckStatus;
  message: string;
}

export interface MailDnsFacts {
  /** Domain pengirim (bagian setelah @ di MAIL_FROM) */
  domain: string | null;
  spf: string | null;
  dmarc: string | null;
  /** Selector DKIM yang ditemukan (kosong = tidak ada di selector umum) */
  dkim: string[];
  /** Alamat aplikasi di tautan email */
  appUrl: string;
  smtpConfigured: boolean;
}

/** Domain bersama/contoh yang tidak bisa diautentikasi oleh pengguna SANSU */
const SHARED_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'contoh.co.id', 'example.com', 'localhost']);

export const COMMON_DKIM_SELECTORS = ['default', 'mail', 'google', 'selector1', 'selector2', 'k1', 'k2', 's1', 's2', 'brevo1', 'brevo2', 'mandrill', 'smtp', 'dkim', 'zoho', 'mailjet', 'sendgrid', 'em1', 'cm'];

export function senderDomain(from: string): string | null {
  const m = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = m.lastIndexOf('@');
  return at > 0 ? m.slice(at + 1).trim().toLowerCase() : null;
}

export function evaluateMailSetup(f: MailDnsFacts): MailCheckItem[] {
  const out: MailCheckItem[] = [];
  out.push(
    f.smtpConfigured
      ? { key: 'smtp', title: 'SMTP', status: 'OK', message: 'SMTP sudah diisi.' }
      : { key: 'smtp', title: 'SMTP', status: 'ERROR', message: 'SMTP belum diisi (SMTP_HOST dkk. di .env); email tidak dikirim sama sekali.' },
  );
  if (!f.domain) {
    out.push({ key: 'from', title: 'Alamat pengirim', status: 'ERROR', message: 'MAIL_FROM tidak berisi alamat email yang valid, mis. "SANSU <no-reply@domain-anda>".' });
    return out;
  }
  if (SHARED_DOMAINS.has(f.domain)) {
    out.push({ key: 'from', title: 'Alamat pengirim', status: 'ERROR', message: `Domain pengirim ${f.domain} bukan domain milik Anda atau hanya contoh. Pakai alamat di domain Anda sendiri (mis. no-reply@perusahaananda.co.id) yang diautentikasi di penyedia SMTP; email dari domain bersama hampir pasti masuk spam.` });
  } else {
    out.push({ key: 'from', title: 'Alamat pengirim', status: 'OK', message: `Pengirim memakai domain ${f.domain}.` });
    out.push(
      f.spf && /v=spf1/i.test(f.spf)
        ? /\ball\b/i.test(f.spf) && /\+all/i.test(f.spf)
          ? { key: 'spf', title: 'SPF', status: 'ERROR', message: 'SPF memakai "+all" sehingga siapa pun boleh mengirim atas nama domain Anda. Ganti ke "~all" atau "-all".' }
          : { key: 'spf', title: 'SPF', status: 'OK', message: 'Record SPF ditemukan. Pastikan penyedia SMTP Anda tercantum di dalamnya (include:...).' }
        : { key: 'spf', title: 'SPF', status: 'ERROR', message: `Record SPF (TXT "v=spf1 ...") untuk ${f.domain} tidak ditemukan. Tambahkan sesuai petunjuk penyedia SMTP, mis. "v=spf1 include:<penyedia> ~all".` },
    );
    out.push(
      f.dkim.length
        ? { key: 'dkim', title: 'DKIM', status: 'OK', message: `Record DKIM ditemukan (selector: ${f.dkim.join(', ')}).` }
        : { key: 'dkim', title: 'DKIM', status: 'WARN', message: 'DKIM tidak ditemukan pada selector umum. Bila penyedia Anda memakai selector lain, ini bisa keliru; kalau belum, aktifkan DKIM (record TXT/CNAME dari penyedia SMTP) agar email tidak ditandai spam.' },
    );
    out.push(
      f.dmarc && /v=DMARC1/i.test(f.dmarc)
        ? { key: 'dmarc', title: 'DMARC', status: 'OK', message: /p=none/i.test(f.dmarc) ? 'DMARC ada (mode pantau, p=none). Setelah email stabil, naikkan ke p=quarantine.' : 'Record DMARC ditemukan.' }
        : { key: 'dmarc', title: 'DMARC', status: 'WARN', message: `Record DMARC belum ada. Tambahkan TXT di _dmarc.${f.domain}: "v=DMARC1; p=none; rua=mailto:email-anda". Gmail dan Yahoo mewajibkannya untuk pengirim bervolume besar.` },
    );
  }
  try {
    const u = new URL(f.appUrl);
    const local = /^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
    if (local) out.push({ key: 'appurl', title: 'Alamat aplikasi di tautan', status: 'WARN', message: `APP_URL (${f.appUrl}) berupa alamat lokal/IP. Tautan semacam itu sering memicu filter spam dan tidak bisa dibuka penerima; pakai domain publik ber-HTTPS.` });
    else if (u.protocol !== 'https:') out.push({ key: 'appurl', title: 'Alamat aplikasi di tautan', status: 'WARN', message: 'APP_URL tidak memakai HTTPS; tautan tanpa HTTPS lebih sering dianggap mencurigakan.' });
    else if (f.domain && !(u.hostname === f.domain || u.hostname.endsWith(`.${f.domain}`) || f.domain.endsWith(`.${u.hostname.split('.').slice(-2).join('.')}`))) out.push({ key: 'appurl', title: 'Alamat aplikasi di tautan', status: 'WARN', message: `Domain tautan (${u.hostname}) berbeda dari domain pengirim (${f.domain}). Sebaiknya sama atau satu induk domain.` });
    else out.push({ key: 'appurl', title: 'Alamat aplikasi di tautan', status: 'OK', message: `Tautan memakai ${u.hostname}.` });
  } catch {
    out.push({ key: 'appurl', title: 'Alamat aplikasi di tautan', status: 'ERROR', message: 'APP_URL tidak valid.' });
  }
  return out;
}

const txt = async (name: string): Promise<string[]> => {
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(''));
  } catch {
    return [];
  }
};

/** Kumpulkan fakta DNS untuk domain pengirim (kegagalan DNS dianggap record tidak ada) */
export async function collectMailFacts(from: string, appUrl: string, smtpConfigured: boolean): Promise<MailDnsFacts> {
  const domain = senderDomain(from);
  if (!domain || SHARED_DOMAINS.has(domain)) return { domain, spf: null, dmarc: null, dkim: [], appUrl, smtpConfigured };
  const [root, dm, ...dk] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`), ...COMMON_DKIM_SELECTORS.map((s) => txt(`${s}._domainkey.${domain}`))]);
  const dkim = COMMON_DKIM_SELECTORS.filter((_, i) => dk[i].some((r) => /v=DKIM1|p=/i.test(r)));
  // beberapa penyedia memakai CNAME untuk DKIM: resolveTxt mengikuti CNAME, jadi tercakup di atas
  return { domain, spf: root.find((r) => /^v=spf1/i.test(r)) ?? null, dmarc: dm.find((r) => /^v=DMARC1/i.test(r)) ?? null, dkim, appUrl, smtpConfigured };
}
