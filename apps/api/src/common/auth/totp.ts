/**
 * TOTP (RFC 6238) untuk verifikasi 2 langkah — kompatibel dengan Google Authenticator,
 * Microsoft Authenticator, Authy, dll. Tanpa pustaka luar.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Rahasia baru 160 bit (base32) */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** Kode HOTP untuk satu langkah waktu */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const totp = (secretB32: string, at = Date.now(), digits = 6) =>
  hotp(base32Decode(secretB32), Math.floor(at / 30_000), digits);

/** Cocokkan kode 6 digit; toleransi ±1 langkah (30 detik) untuk jam HP yang sedikit meleset */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  const c = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secretB32);
  const step = Math.floor(at / 30_000);
  for (const w of [0, -1, 1]) {
    const a = Buffer.from(hotp(key, step + w));
    if (timingSafeEqual(a, Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'SANSU') {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** 10 kode cadangan sekali pakai, format xxxx-xxxx */
export function newBackupCodes(n = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeBackupCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
