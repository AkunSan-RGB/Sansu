/**
 * Rincian & perhitungan akun (e2e): untuk setiap jenis usaha, SETIAP akun yang tampil di laporan keuangan (neraca dan laba rugi)
 * punya jadwal, dan saldo akhir jadwal sama dengan angka akun itu di laporan keuangan. Saldo awal + mutasi bulanan = saldo akhir.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const MODELS = ['RITEL', 'DAGANG', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB', 'UTILITAS'] as const;

interface Item {
  accountId: string;
  code: string;
  name: string;
  kind: string;
  reported: string;
  computed: string;
  difference: string;
  matches: boolean;
  findings: number;
  needsDefinition: boolean;
}

const num = (v: unknown) => Number(v);
const seen = new Set<string>();

describe('Rincian & perhitungan akun (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const get = (t: string, u: string) => http.get(u).set({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.DEMO_STRICT = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    delete process.env.DEMO_STRICT;
    await app.close();
  });

  it.each(MODELS)('%s: setiap akun di laporan keuangan punya jadwal yang cocok dengan saldo akhir di laporan', async (model) => {
    const token = (await http.post('/api/demo/start').send({ businessModel: model }).expect(200)).body.accessToken as string;
    const year = new Date().getUTCFullYear();
    const ov = (await get(token, `/api/account-schedules?year=${year}`).expect(200)).body as { summary: { accounts: number }; items: Item[] };
    expect(ov.summary.accounts).toBeGreaterThan(5);
    const bad = ov.items.filter((i) => !i.matches).map((i) => `${i.code} ${i.name} [${i.kind}] laporan=${i.reported} jadwal=${i.computed} selisih=${i.difference} temuan=${i.findings}`);
    expect(bad).toEqual([]);
    ov.items.forEach((i) => seen.add(i.kind));
    // setiap akun bisa dibuka rinciannya: tabel tersedia dan jumlah bulanan menutup ke saldo akhir
    for (const it of ov.items.slice(0, 40)) {
      const d = (await get(token, `/api/account-schedules/${it.accountId}?year=${year}`).expect(200)).body;
      expect(d.tables.length).toBeGreaterThan(0);
      expect(d.method.formulas.length).toBeGreaterThan(0);
      expect(d.computed).toBe(it.computed);
      // rantai saldo mutasi bulanan: saldo awal + penambahan − pengurangan = saldo akhir, dan saldo akhir bulan = saldo awal bulan berikutnya
      const ledger = d.tables.find((t: { key: string }) => t.key === 'ledger-monthly');
      expect(ledger.rows).toHaveLength(12);
      const isBalance = ledger.columns.some((c: { key: string }) => c.key === 'opening');
      let prev: number | null = null;
      for (const r of ledger.rows as { cells: Record<string, string> }[]) {
        const c = r.cells;
        if (isBalance) {
          expect(num(c.opening) + num(c.add) - num(c.sub)).toBeCloseTo(num(c.closing), 1);
          if (prev !== null) expect(num(c.opening)).toBeCloseTo(prev, 1);
          prev = num(c.closing);
        } else {
          expect(num(c.add) - num(c.sub)).toBeCloseTo(num(c.net), 1);
          prev = (prev ?? 0) + num(c.net);
          expect(prev).toBeCloseTo(num(c.cumulative), 1);
        }
      }
    }
  });

  it('semua jenis jadwal khusus terpakai oleh akun nyata', () => {
    for (const k of ['FIXED_ASSET_COST', 'FIXED_ASSET_ACCUMULATED', 'RECEIVABLE', 'PAYABLE', 'INVENTORY', 'CASH', 'TAX', 'EQUITY', 'REVENUE', 'COST_OF_SALES', 'EXPENSE']) {
      expect([...seen]).toContain(k);
    }
  });

  it('akun baru otomatis punya jadwal: akun beban baru memakai jadwal beban, akun aset baru memakai jadwal umum yang ditandai', async () => {
    const token = (await http.post('/api/demo/start').send({ businessModel: 'DAGANG' }).expect(200)).body.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };
    const year = new Date().getUTCFullYear();
    const exp = (await http.post('/api/accounting/accounts').set(auth).send({ code: '6-9810', name: 'Beban Uji Baru', type: 'EXPENSE', reportGroup: 'ADMIN_EXPENSE' }).expect(201)).body;
    const ast = (await http.post('/api/accounting/accounts').set(auth).send({ code: '1-9810', name: 'Aset Lain Uji', type: 'ASSET', reportGroup: 'OTHER_CURRENT_ASSET' }).expect(201)).body;
    const accs = (await http.get('/api/accounting/accounts').set(auth).expect(200)).body as { id: string; code: string }[];
    const cash = accs.find((a) => a.code === '1-1100')!.id;
    const day = new Date().toISOString().slice(0, 10);
    await http.post('/api/accounting/journals').set(auth).send({ date: day, description: 'Uji akun baru', lines: [{ accountId: exp.id, debit: '123456' }, { accountId: ast.id, debit: '654321' }, { accountId: cash, credit: '777777' }] }).then((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); });
    const ov = (await http.get(`/api/account-schedules?year=${year}`).set(auth).expect(200)).body as { items: Item[] };
    const e = ov.items.find((i) => i.accountId === exp.id)!;
    const a = ov.items.find((i) => i.accountId === ast.id)!;
    expect(e.kind).toBe('EXPENSE');
    expect(e.matches).toBe(true);
    expect(Number(e.reported)).toBe(123456);
    expect(a.kind).toBe('GENERIC');
    expect(a.needsDefinition).toBe(true);
    expect(a.matches).toBe(true);
    expect(Number(a.reported)).toBe(654321);
  });
});
