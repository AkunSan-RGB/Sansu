import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { VaRepository } from '../../modules/utility-ops/va.repository';
import { ProductionRepository } from '../../modules/utility-ops/production.repository';
import { WorkflowRepository } from '../../modules/workflow/workflow.repository';
import { assertDocDateText, assertUuid, textArray } from './sql-guard';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
/** Basis data palsu yang hanya menangkap kueri */
const capture = () => {
  const seen: SQL[] = [];
  const db = { execute: async (q: SQL) => { seen.push(q); return { rows: [], rowCount: 0 }; } };
  return { db: db as never, seen };
};
const EVIL = `x'); DROP TABLE users; --`;
const UUID = '0193b3c4-7a1b-7c2d-8e3f-0123456789ab';

describe('pertahanan injeksi SQL', () => {
  it('textArray menjadikan tiap nilai parameter, bukan bagian teks kueri', () => {
    const r = render(sql`SELECT ${textArray([EVIL, "a'b"])} AS x`);
    expect(r.sql).not.toContain('DROP TABLE');
    expect(r.sql).not.toContain("a'b");
    expect(r.params).toEqual([EVIL, "a'b"]);
    expect(render(textArray([])).sql).toContain('ARRAY[]::text[]');
  });

  it('assertUuid menolak apa pun yang bukan UUID, termasuk tanda kutip dan tipe salah', () => {
    expect(assertUuid(UUID)).toBe(UUID);
    for (const bad of [EVIL, `${UUID}'`, "' OR '1'='1", '', '123', `${UUID}; --`]) expect(() => assertUuid(bad)).toThrow(/tidak valid/);
    expect(() => assertUuid(undefined as never)).toThrow();
    expect(() => assertDocDateText('2026-10-28')).not.toThrow();
    expect(() => assertDocDateText(`2026-10-28' OR 1=1`)).toThrow(/tidak valid/);
  });

  it('pembayaran VA: nomor pembayaran masuk sebagai parameter', async () => {
    const { db, seen } = capture();
    await new VaRepository().update(db, UUID, { status: 'APPLIED', applied: '1', unapplied: '0', paymentNumbers: [EVIL], message: null });
    const r = render(seen[0]);
    expect(r.sql).not.toContain('DROP TABLE');
    expect(r.params).toContain(EVIL);
  });

  it('kualitas air: parameter gagal masuk sebagai parameter', async () => {
    const { db, seen } = capture();
    await new ProductionRepository().qualityInsert(db, { tenantId: UUID, sampledOn: '2026-10-28', point: 'P1', ph: 7, turbidity: 1, chlorine: 1, coliform: 0, tds: 100, ok: false, failed: [EVIL], samplerId: UUID, note: null }).catch(() => undefined);
    const r = render(seen[0]);
    expect(r.sql).not.toContain('DROP TABLE');
    expect(r.params).toContain(EVIL);
  });

  it('alur kerja: ID dokumen atau perusahaan yang bukan UUID ditolak sebelum kueri dibuat', () => {
    const { db, seen } = capture();
    const repo = new WorkflowRepository();
    const src = { number: (a: string) => `${a}.number`, status: (a: string) => `${a}.status` } as never;
    expect(() => repo.queryLiveLinks(db, src, 'invoices', UUID, EVIL)).toThrow(/tidak valid/);
    expect(() => repo.queryLiveLinks(db, src, 'invoices', EVIL, UUID)).toThrow(/tidak valid/);
    expect(() => repo.queryFollowLinksForFollowLinks(db, src, 'invoices', UUID, EVIL)).toThrow(/tidak valid/);
    expect(() => repo.queryFollowLinks(db, { to: 'INVOICE', ids: (t: string, i: string) => `SELECT '${t}${i}'` }, UUID, EVIL)).toThrow(/tidak valid/);
    expect(() => repo.queryDiscoverDocs(db, src, 'd.customer_id', 'invoices', UUID, 'created_at', `2026-01-01' OR 1=1`, { link: 'INVOICE', label: 'x' })).toThrow(/tidak valid/);
    expect(seen).toHaveLength(0);
    // nilai sah tetap lolos
    expect(() => repo.queryLiveLinks(db, src, 'invoices', UUID, UUID)).not.toThrow();
  });

  it('kunci peta audit memakai kepemilikan: nama bawaan objek bukan entitas sah', () => {
    const REF: Record<string, unknown> = { Invoice: {} };
    expect(Object.hasOwn(REF, 'Invoice')).toBe(true);
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(Object.hasOwn(REF, k)).toBe(false);
  });
});
