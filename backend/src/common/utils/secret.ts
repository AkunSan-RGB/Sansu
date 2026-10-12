import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Token acak aman untuk tautan email (base64url, 256 bit) */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Hash SHA-256 (hex) — token disimpan dalam bentuk hash saja */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const key = () => createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'sansu-dev-key').digest();

/** Enkripsi AES-256-GCM untuk menyimpan token pihak ketiga (marketplace) di database */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, body] = blob.split('.');
  if (v !== 'v1') throw new Error('Format data terenkripsi tidak dikenal');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}
