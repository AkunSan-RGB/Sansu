/**
 * Bagan akun dan laporan menurut jenis usaha (Dagang / Ritel / Jasa / Produksi):
 * akun khusus tiap model, label Laporan Laba Rugi, dan teks CALK.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Model = 'DAGANG' | 'RITEL' | 'JASA' | 'PRODUKSI' | 'MANUFAKTUR';
type Line = { key: string; label: string };
type Section = { key: string; paragraphs: string[]; subsections?: { title: string; paragraphs: string[] }[] };

describe('Bagan akun & laporan per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const year = new Date().getFullYear();
  const today = todayJakarta();
  const tokens = {} as Record<Model, string>;
  const as = (m: Model) => ({ Authorization: `Bearer ${tokens[m]}` });
  const get = (m: Model, url: string) => http.get(url).set(as(m));
  const post = (m: Model, url: string, body: object = {}) => http.post(url).set(as(m)).send(body);
  const codes = async (m: Model) => ((await get(m, '/api/accounting/accounts').expect(200)).body as { code: string }[]).map((a) => a.code);
  const accountId = async (m: Model, code: string) => ((await get(m, '/api/accounting/accounts')).body as { id: string; code: string }[]).find((a) => a.code === code)!.id;
  const income = async (m: Model, framework?: string) =>
    ((await get(m, `/api/accounting/statements/income?from=${year}-01-01&to=${today}${framework ? `&framework=${framework}` : ''}`).expect(200)).body.lines as Line[]);
  const label = (lines: Line[], key: string) => lines.find((l) => l.key === key)?.label;
  const journal = async (m: Model, debit: string, credit: string, amount: string) =>
    post(m, '/api/accounting/journals', {
      date: today,
      description: 'Uji',
      lines: [{ accountId: await accountId(m, debit), debit: amount }, { accountId: await accountId(m, credit), credit: amount }],
    }).expect(201);
  const notes = async (m: Model) => (await get(m, `/api/accounting/notes/${year}`).expect(200)).body.sections as Section[];
  const sec = (s: Section[], key: string) => s.find((x) => x.key === key);
  const text = (s?: Section) => [...(s?.paragraphs ?? []), ...(s?.subsections ?? []).flatMap((x) => x.paragraphs)].join(' ');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    for (const m of ['DAGANG', 'RITEL', 'JASA', 'PRODUKSI', 'MANUFAKTUR'] as Model[]) {
      tokens[m] = (
        await http.post('/api/auth/register').send({ companyName: `Usaha ${m}`, name: 'Pemilik', email: `rep-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)
      ).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe('bagan akun', () => {
    const specific = { DAGANG: ['6-2350'], RITEL: ['6-2450', '6-2500'], JASA: ['5-1500', '5-1600', '5-1700', '6-3600'], PRODUKSI: ['5-4300', '5-4400'], MANUFAKTUR: ['5-4300', '5-4400', '5-4950'] } as Record<Model, string[]>;
    const universal = ['1-1100', '1-1300', '2-1100', '4-1000', '5-1000', '6-7000', '9-1000'];

    it.each(['DAGANG', 'RITEL', 'JASA', 'PRODUKSI', 'MANUFAKTUR'] as Model[])('%s: akun umum lengkap, akun khusus hanya milik modelnya', async (m) => {
      const c = await codes(m);
      for (const code of universal) expect(c).toContain(code);
      for (const code of specific[m]) expect(c).toContain(code);
      // Manufaktur memuat semua akun khusus Produksi; selain itu akun khusus model lain tidak boleh ada
      for (const [other, list] of Object.entries(specific)) if (other !== m) for (const code of list) if (!(m === 'MANUFAKTUR' && other === 'PRODUKSI') && !specific[m].includes(code)) expect(c).not.toContain(code);
      expect(new Set(c).size).toBe(c.length); // tanpa kode ganda
    });

    it('akun khusus bisa dipakai di tagihan dan masuk kelompok laporan yang benar', async () => {
      const id = await accountId('JASA', '5-1500');
      const tb = await post('JASA', '/api/accounting/journals', {
        date: today,
        description: 'Biaya subkontraktor',
        lines: [{ accountId: id, debit: '1000000' }, { accountId: await accountId('JASA', '1-1100'), credit: '1000000' }],
      }).expect(201);
      expect(tb.body.number).toBeTruthy();
      const lines = await income('JASA');
      expect(lines.find((l) => l.key === 'COST_OF_SALES')).toMatchObject({ amount: '-1000000.00' });
    });

    it('ganti jenis usaha menambah akun model baru tanpa menghapus yang lama', async () => {
      const before = await codes('JASA');
      await http.put('/api/settings/business').set(as('JASA')).send({ model: 'RITEL', applyApps: false }).expect(200);
      const after = await codes('JASA');
      for (const code of before) expect(after).toContain(code); // tidak ada yang hilang
      for (const code of specific.RITEL) expect(after).toContain(code); // akun ritel muncul
      expect(new Set(after).size).toBe(after.length);
      // ganti kembali: tetap tanpa duplikat dan tanpa kehilangan
      await http.put('/api/settings/business').set(as('JASA')).send({ model: 'JASA', applyApps: false }).expect(200);
      const again = await codes('JASA');
      expect(again.sort()).toEqual(after.sort());
    });
  });

  describe('Laporan Laba Rugi', () => {
    it.each([
      ['DAGANG', 'Pendapatan usaha', 'Beban pokok penjualan'],
      ['RITEL', 'Pendapatan usaha', 'Beban pokok penjualan'],
      ['JASA', 'Pendapatan jasa', 'Beban pokok pendapatan'],
      ['PRODUKSI', 'Pendapatan usaha', 'Beban pokok produksi dan penjualan'],
      ['MANUFAKTUR', 'Pendapatan usaha', 'Beban pokok produksi dan penjualan'],
    ] as [Model, string, string][])('%s memakai istilah sendiri di SAK EP', async (m, revenue, cogs) => {
      const lines = await income(m, 'SAK_EP');
      expect(label(lines, 'SALES_REVENUE')).toBe(revenue);
      expect(label(lines, 'COST_OF_SALES')).toBe(cogs);
    });

    it.each([
      ['JASA', 'Pendapatan jasa', 'Beban pokok pendapatan'],
      ['PRODUKSI', 'Pendapatan usaha', 'Beban pokok produksi dan penjualan'],
      ['MANUFAKTUR', 'Pendapatan usaha', 'Beban pokok produksi dan penjualan'],
    ] as [Model, string, string][])('%s memakai istilah sendiri di SAK EMKM', async (m, revenue, cogs) => {
      const lines = await income(m, 'SAK_EMKM');
      expect(label(lines, 'REVENUE')).toBe(revenue);
      expect(label(lines, 'COST_OF_SALES')).toBe(cogs);
    });

    it('angka tidak berubah oleh istilah: kunci baris dan jumlah sama di semua model', async () => {
      const a = await income('DAGANG', 'SAK_EP');
      const b = await income('PRODUKSI', 'SAK_EP');
      expect(a.map((l) => l.key)).toEqual(b.map((l) => l.key));
    });
  });

  describe('CALK', () => {
    it('dagang: teks seperti sebelumnya', async () => {
      await journal('DAGANG', '1-1100', '4-1000', '5000000');
      const s = await notes('DAGANG');
      expect(text(sec(s, 'general'))).toContain('Kegiatan usaha Perusahaan adalah perdagangan besar (distribusi) barang konsumsi.');
      expect(text(sec(s, 'revenue'))).toContain('penjualan barang dagang di dalam negeri');
      expect(text(sec(s, 'policies'))).toContain('pengendalian atas barang berpindah');
    });

    it('jasa: pendapatan jasa, pengakuan berdasarkan kemajuan pekerjaan, beban pokok pendapatan', async () => {
      await journal('JASA', '1-1100', '4-2000', '8000000');
      const s = await notes('JASA');
      expect(text(sec(s, 'general'))).toContain('Kegiatan usaha Perusahaan adalah penyediaan jasa kepada pelanggan.');
      expect(text(sec(s, 'revenue'))).toContain('penyerahan jasa');
      expect(text(sec(s, 'revenue'))).not.toMatch(/barang dagang/);
      expect(text(sec(s, 'policies'))).toContain('persentase kemajuan');
      expect(text(sec(s, 'policies'))).toContain('liabilitas kontrak');
      expect(text(sec(s, 'cogs'))).toContain('subkontraktor');
      expect(text(sec(s, 'payables')) + text(sec(s, 'receivables'))).not.toMatch(/barang dagang/);
    });

    it('produksi: beban pokok produksi, persediaan bahan baku–barang jadi', async () => {
      await journal('PRODUKSI', '1-1100', '4-1000', '9000000');
      await journal('PRODUKSI', '5-1000', '1-1100', '3000000');
      await journal('PRODUKSI', '1-1400', '1-1100', '2000000');
      const s = await notes('PRODUKSI');
      expect(text(sec(s, 'general'))).toContain('industri pengolahan (produksi)');
      expect(text(sec(s, 'revenue'))).toContain('barang hasil produksi');
      expect(text(sec(s, 'cogs'))).toContain('bahan baku, upah langsung, dan overhead produksi');
      expect(text(sec(s, 'inventory'))).toContain('bahan baku, barang dalam proses, dan barang jadi');
    });

    it('ritel: eceran lewat kasir; selisih kas kasir disebut di kebijakan', async () => {
      await journal('RITEL', '1-1100', '4-1000', '2000000');
      const s = await notes('RITEL');
      expect(text(sec(s, 'general'))).toContain('perdagangan eceran (ritel)');
      expect(text(sec(s, 'revenue'))).toContain('kasir toko');
      expect(text(sec(s, 'policies'))).toContain('Selisih kas kasir');
    });

    it('kegiatan usaha buatan pengguna dipakai apa adanya; teks bawaan mengikuti model yang berlaku', async () => {
      await http.patch('/api/settings/reporting').set(as('JASA')).send({ businessActivity: 'jasa konsultasi manajemen dan pelatihan' }).expect(200);
      expect(text(sec(await notes('JASA'), 'general'))).toContain('Kegiatan usaha Perusahaan adalah jasa konsultasi manajemen dan pelatihan.');
      // pengguna mengosongkan ke teks bawaan dagang lama → mengikuti model JASA
      await http.patch('/api/settings/reporting').set(as('JASA')).send({ businessActivity: 'perdagangan besar (distribusi) barang konsumsi' }).expect(200);
      expect(text(sec(await notes('JASA'), 'general'))).toContain('penyediaan jasa kepada pelanggan');
    });

    it('ganti model mengubah teks CALK tanpa mengubah angka', async () => {
      const total = async () => (await get('JASA', `/api/accounting/notes/${year}`)).body.totals;
      const before = await total();
      await http.put('/api/settings/business').set(as('JASA')).send({ model: 'PRODUKSI', applyApps: false }).expect(200);
      expect(text(sec(await notes('JASA'), 'revenue'))).toContain('barang hasil produksi');
      expect(await total()).toEqual(before);
    });
  });
});
