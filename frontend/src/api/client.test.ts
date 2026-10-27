// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

const ok = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const keyOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Idempotency-Key');

describe('api(): kunci idempotensi otomatis dan jaringan buruk', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('setiap permintaan yang mengubah data membawa Idempotency-Key; GET tidak', async () => {
    fetchMock.mockImplementation(async () => ok());
    await api('/cash/transactions', { method: 'POST', json: { a: 1 } });
    await api('/cash/transactions/1', { method: 'PUT', json: { a: 1 } });
    await api('/cash/transactions/1', { method: 'DELETE' });
    await api('/cash/transactions');
    expect(keyOf(fetchMock.mock.calls[0])).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
    expect(keyOf(fetchMock.mock.calls[1])).toBeTruthy();
    expect(keyOf(fetchMock.mock.calls[2])).toBeTruthy();
    expect(keyOf(fetchMock.mock.calls[3])).toBeNull();
  });

  it('jaringan putus: kirim ulang isi sama memakai kunci SAMA, dan pesannya memperingatkan kemungkinan sudah tersimpan', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok({ number: 'KK-1' }));
    const err = (await api('/cash/transactions', { method: 'POST', json: { amt: 5 } }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/MUNGKIN sudah tersimpan/);
    await api('/cash/transactions', { method: 'POST', json: { amt: 5 } });
    expect(keyOf(fetchMock.mock.calls[1])).toBe(keyOf(fetchMock.mock.calls[0]));
  });

  it('waktu habis (server tidak menjawab) juga mempertahankan kunci', async () => {
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    fetchMock.mockResolvedValueOnce(ok());
    const err = (await api('/sales/pay', { method: 'POST', json: { x: 1 }, timeoutMs: 20 }).catch((e) => e)) as ApiError;
    expect(err.status).toBe(504);
    expect(err.message).toMatch(/MUNGKIN sudah tersimpan/);
    await api('/sales/pay', { method: 'POST', json: { x: 1 } });
    expect(keyOf(fetchMock.mock.calls[1])).toBe(keyOf(fetchMock.mock.calls[0]));
  });

  it('begitu server menjawab (termasuk ditolak), transaksi berikutnya yang sama mendapat kunci baru', async () => {
    fetchMock.mockResolvedValueOnce(ok({ message: 'ditolak' }, 400)).mockResolvedValueOnce(ok());
    await api('/cash/transactions', { method: 'POST', json: { z: 1 } }).catch(() => undefined);
    await api('/cash/transactions', { method: 'POST', json: { z: 1 } });
    expect(keyOf(fetchMock.mock.calls[1])).not.toBe(keyOf(fetchMock.mock.calls[0]));
  });

  it('jawaban 5xx dan galat server dijelaskan, jawaban bukan JSON dianggap server belum siap', async () => {
    fetchMock.mockResolvedValueOnce(ok({ message: 'Internal server error' }, 500));
    await expect(api('/x')).rejects.toMatchObject({ status: 500 });
    fetchMock.mockResolvedValueOnce(new Response('upstream error', { status: 502 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/belum siap/) });
  });
});
