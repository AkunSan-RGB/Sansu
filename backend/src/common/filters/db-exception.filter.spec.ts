import { ArgumentsHost } from '@nestjs/common';
import { DbExceptionFilter } from './db-exception.filter';

function run(code: string) {
  const out: { status?: number; body?: { message: string } } = {};
  const res = {
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: { message: string }) {
      out.body = b;
      return this;
    },
  };
  const host = { getType: () => 'http', switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }) } as unknown as ArgumentsHost;
  new DbExceptionFilter().catch(Object.assign(new Error('pg'), { code }), host);
  return out;
}

describe('DbExceptionFilter: galat database yang aman diulang', () => {
  it.each(['57014', '25P03', '40P01', '40001', '55P03'])('kode %s menjadi 503 dengan pesan jelas', (code) => {
    const r = run(code);
    expect(r.status).toBe(503);
    expect(r.body?.message).toMatch(/tidak ada data yang tersimpan setengah jalan/i);
  });
});
