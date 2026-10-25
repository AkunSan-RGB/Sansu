import { describe, expect, it } from 'vitest';
import { forgetIdempotencyKey, idempotencyKeyFor } from './client';

describe('kunci idempotensi klien', () => {
  it('permintaan identik dipakai ulang kuncinya sampai server menjawab', () => {
    const a = idempotencyKeyFor('POST', '/cash/transactions', '{"a":1}', 1_000);
    const b = idempotencyKeyFor('POST', '/cash/transactions', '{"a":1}', 2_000);
    expect(b.key).toBe(a.key);
    forgetIdempotencyKey(a.id);
    expect(idempotencyKeyFor('POST', '/cash/transactions', '{"a":1}', 3_000).key).not.toBe(a.key);
  });

  it('isi atau alamat berbeda mendapat kunci berbeda', () => {
    const a = idempotencyKeyFor('POST', '/x', '{"a":1}', 1_000);
    expect(idempotencyKeyFor('POST', '/x', '{"a":2}', 1_000).key).not.toBe(a.key);
    expect(idempotencyKeyFor('POST', '/y', '{"a":1}', 1_000).key).not.toBe(a.key);
    expect(idempotencyKeyFor('PUT', '/x', '{"a":1}', 1_000).key).not.toBe(a.key);
  });

  it('kunci kedaluwarsa setelah 10 menit', () => {
    const a = idempotencyKeyFor('POST', '/z', '{}', 1_000);
    expect(idempotencyKeyFor('POST', '/z', '{}', 1_000 + 11 * 60_000).key).not.toBe(a.key);
  });

  it('kunci memenuhi aturan server (8–100 huruf, angka, _ . : -)', () => {
    expect(idempotencyKeyFor('POST', '/k', '{}', 1).key).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
  });
});
