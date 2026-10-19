import { planErase } from './erase';

const T = '11111111-2222-3333-4444-555555555555';

describe('planErase', () => {
  const tenantTables = ['invoices', 'journal_entries', 'customers'];
  const all = [...tenantTables, 'invoice_lines', 'journal_lines', 'line_notes', 'plans', 'tenants'];
  const fks = [
    { child: 'invoice_lines', col: 'invoice_id', parent: 'invoices', pcol: 'id' },
    { child: 'journal_lines', col: 'journal_id', parent: 'journal_entries', pcol: 'id' },
    { child: 'line_notes', col: 'line_id', parent: 'invoice_lines', pcol: 'id' }, // cucu: lewat dua tingkat
    { child: 'invoices', col: 'customer_id', parent: 'customers', pcol: 'id' },
    { child: 'journal_entries', col: 'reversal_of_id', parent: 'journal_entries', pcol: 'id' }, // rujukan diri sendiri
  ];

  it('tabel ber-tenant dan anak (termasuk cucu) dikaitkan ke perusahaan; tabel global dilewati', () => {
    const p = planErase(tenantTables, all, fks, T);
    expect([...p.cond.keys()].sort()).toEqual(['customers', 'invoice_lines', 'invoices', 'journal_entries', 'journal_lines', 'line_notes']);
    expect(p.cond.get('invoices')).toBe(`"invoices"."tenant_id" = '${T}'`);
    expect(p.cond.get('invoice_lines')).toContain(`"invoice_id" IN (SELECT "id" FROM "invoices" WHERE "invoices"."tenant_id" = '${T}')`);
    expect(p.cond.get('line_notes')).toContain(`"line_id" IN (SELECT "id" FROM "invoice_lines"`);
    expect(p.cond.has('plans')).toBe(false);
    expect(p.cond.has('tenants')).toBe(false);
    expect(p.unowned).toEqual([]);
  });

  it('urutan hapus: anak sebelum induk, rujukan ke diri sendiri tidak menghalangi', () => {
    const { order } = planErase(tenantTables, all, fks, T);
    const idx = (t: string) => order.indexOf(t);
    expect(idx('line_notes')).toBeLessThan(idx('invoice_lines'));
    expect(idx('invoice_lines')).toBeLessThan(idx('invoices'));
    expect(idx('invoices')).toBeLessThan(idx('customers'));
    expect(idx('journal_lines')).toBeLessThan(idx('journal_entries'));
  });

  it('tabel tanpa tenant_id yang tidak terhubung ke perusahaan dilaporkan (skema berubah tanpa penyesuaian)', () => {
    const p = planErase(tenantTables, [...all, 'tabel_yatim'], fks, T);
    expect(p.unowned).toEqual(['tabel_yatim']);
  });

  it('ketergantungan melingkar antar tabel ditolak', () => {
    expect(() => planErase(['a', 'b'], ['a', 'b'], [{ child: 'a', col: 'b_id', parent: 'b', pcol: 'id' }, { child: 'b', col: 'a_id', parent: 'a', pcol: 'id' }], T)).toThrow('melingkar');
  });

  it('tenantId yang bukan UUID ditolak (mencegah injeksi SQL)', () => {
    expect(() => planErase(tenantTables, all, fks, "x'; DROP TABLE tenants;--")).toThrow('tidak valid');
  });
});
