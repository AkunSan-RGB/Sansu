import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Token acak aman untuk tautan email (base64url, 256 bit) */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Hash SHA-256 (hex) — token disimpan dalam bentuk hash saja */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const derive = (material: string) => createHash('sha256').update(material).digest();
const DEV_KEY = 'sansu-dev-key';

/** Kunci untuk enkripsi baru: DATA_ENCRYPTION_KEY (wajib di produksi; lihat assertProductionConfig) */
const key = () => derive(process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || DEV_KEY);

/**
 * Kunci lama yang masih dicoba saat membuka data: sebelum DATA_ENCRYPTION_KEY diwajibkan, data dienkripsi dengan kunci turunan
 * JWT_SECRET (atau kunci pengembangan). Dengan ini mengisi DATA_ENCRYPTION_KEY tidak membuat token yang sudah tersimpan tak terbaca.
 */
const legacyKeys = () => [process.env.JWT_SECRET, DEV_KEY].filter((m): m is string => !!m).map(derive);

/** Enkripsi AES-256-GCM untuk menyimpan token pihak ketiga (marketplace) di database */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

function open(blob: string, k: Buffer): string {
  const [v, iv, tag, body] = blob.split('.');
  if (v !== 'v1') throw new Error('Format data terenkripsi tidak dikenal');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

export function decrypt(blob: string): string {
  let lastError: unknown;
  for (const k of [key(), ...legacyKeys()]) {
    try {
      return open(blob, k);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Enkripsi per kolom untuk data identitas/rekening (NIK, NPWP, nomor rekening): di database tersimpan `enc1:<ciphertext>`.
 * Nilai kosong tidak dienkripsi; nilai lama yang masih teks biasa tetap terbaca (diselesaikan oleh pengisi ulang saat start).
 * Enkripsi acak (IV berbeda tiap kali), sehingga kolom ini tidak bisa dicari/diurutkan di SQL; pencocokan dilakukan di aplikasi.
 */
export const FIELD_PREFIX = 'enc1:';
export const FIELD_TOKEN = /enc1:v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g;
export const isEncryptedField = (v: unknown): v is string => typeof v === 'string' && v.startsWith(FIELD_PREFIX);
export function encryptField(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v.trim() === '' || isEncryptedField(v)) return v;
  return FIELD_PREFIX + encrypt(v);
}
export function decryptField(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return isEncryptedField(v) ? decrypt(v.slice(FIELD_PREFIX.length)) : v;
}
/** Menyamarkan nilai identitas untuk jejak audit/log: hanya 4 karakter terakhir yang tampak */
export function maskField(v: unknown): string {
  const plain = typeof v === 'string' ? (decryptField(v) ?? '') : String(v ?? '');
  return plain.length > 4 ? `••••${plain.slice(-4)}` : plain ? '••••' : '';
}
