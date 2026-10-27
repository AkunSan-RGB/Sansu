import { EventEmitter } from 'node:events';
import { createShedder } from './load-shedder';

const mkRes = () => {
  const res = new EventEmitter() as EventEmitter & { headers: Record<string, string>; statusCode?: number; body?: unknown; setHeader: (k: string, v: string) => void; status: (c: number) => typeof res; json: (b: unknown) => void };
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; };
  return res;
};
const call = (s: ReturnType<typeof createShedder>, path = '/api/x') => {
  const res = mkRes();
  let passed = false;
  s.middleware({ path } as never, res as never, () => { passed = true; });
  return { res, passed };
};

describe('pembatas permintaan bersamaan', () => {
  it('di atas batas permintaan ditolak 503 dengan Retry-After; sesudah selesai muat lagi', () => {
    const s = createShedder({ max: 2 });
    const a = call(s), b = call(s), c = call(s);
    expect([a.passed, b.passed, c.passed]).toEqual([true, true, false]);
    expect(c.res.statusCode).toBe(503);
    expect(c.res.headers['Retry-After']).toBe('2');
    expect((c.res.body as { message: string }).message).toMatch(/tidak ada data yang tersimpan/i);
    a.res.emit('finish');
    expect(call(s).passed).toBe(true);
    expect(s.stats()).toMatchObject({ inflight: 2, shed: 1, peak: 2 });
  });
  it('jalur pengecualian (kesehatan) tidak pernah ditolak dan tidak dihitung', () => {
    const s = createShedder({ max: 1, exempt: (p) => p === '/api/health' });
    call(s);
    expect(call(s, '/api/health').passed).toBe(true);
    expect(s.stats().inflight).toBe(1);
  });
  it('koneksi putus (close) setelah selesai tidak mengurangi dua kali', () => {
    const s = createShedder({ max: 5 });
    const a = call(s);
    a.res.emit('finish');
    a.res.emit('close');
    expect(s.stats().inflight).toBe(0);
  });
  it('max 0 = nonaktif', () => {
    const s = createShedder({ max: 0 });
    for (let i = 0; i < 50; i++) expect(call(s).passed).toBe(true);
  });
});
