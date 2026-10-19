import { maskField } from '../utils/secret';

const IDENTITY_KEY = /^(nik|npwp|bank_?account(_?no)?)$/i;

/** Jejak audit tidak menyimpan NIK/NPWP/nomor rekening utuh: hanya 4 karakter terakhir (nilai lama dan baru tetap bisa dibedakan) */
export function maskIdentity(v: unknown, force = false, depth = 0): unknown {
  if (typeof v === 'string') return force ? maskField(v) : v;
  if (v === null || typeof v !== 'object' || depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => maskIdentity(x, force, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskIdentity(x, force || IDENTITY_KEY.test(k), depth + 1)]));
}
