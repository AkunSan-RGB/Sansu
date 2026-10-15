/**
 * Bagan akun menyesuaikan jenis usaha: akun khusus, nama akun inti, dan akun yang tidak relevan tidak dibuat.
 * Akun yang dipakai modul (kunci sistem) selalu ada di semua jenis usaha.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Acc = { id: string; code: string; name: string; systemKey: string | null; isActive: boolean; description: string | null };
const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'] as const;

describe('Bagan akun per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  const chart: Record<string, Acc[]> = {};
  const accounts = async (m: string) => (await http.get('/api/accounting/accounts').set({ Authorization: `Bearer ${tokens[m]}` }).expect(200)).body as Acc[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    for (const m of MODELS) {
      tokens[m] = (await http.post('/api/auth/register').send({ companyName: `Usaha ${m}`, name: 'Pemilik', email: `coa-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken;
      chart[m] = await accounts(m);
    }
  });
  afterAll(() => app.close());

  const has = (m: string, code: string) => chart[m].some((a) => a.code === code);
  const name = (m: string, code: string) => chart[m].find((a) => a.code === code)?.name;

  it('akun khusus hanya muncul di jenis usahanya', () => {
    expect(has('DAGANG', '5-1100')).toBe(true);
    expect(has('RITEL', '5-1100')).toBe(false);
    expect(has('RITEL', '5-1300')).toBe(true);
    expect(has('RITEL', '1-1130')).toBe(true);
    expect(has('JASA', '1-1380')).toBe(true);
    expect(has('JASA', '2-1760')).toBe(true);
    expect(has('MANUFAKTUR', '5-4500')).toBe(true);
    expect(has('MANUFAKTUR', '5-4800')).toBe(true);
    // FMCG: trade promo, barang kedaluwarsa & distribusi; tanpa akun pabrik
    for (const code of ['6-2150', '6-2160', '6-2700', '5-1100', '5-1200']) expect(has('FMCG', code)).toBe(true);
    for (const code of ['6-2150', '6-2160']) expect(has('DAGANG', code)).toBe(false);
    expect(has('FMCG', '5-4500')).toBe(false);
    expect(has('DAGANG', '5-4500')).toBe(false);
    // F&B: bahan terbuang, kemasan saji, komisi pesan-antar; pembayaran digital dipakai bersama ritel
    for (const code of ['5-1350', '5-1450', '6-2460', '1-1130', '6-2450']) expect(has('FNB', code)).toBe(true);
    for (const code of ['5-1350', '5-1450', '6-2460']) expect(has('RITEL', code)).toBe(false);
    expect(has('FNB', '5-4500')).toBe(false);
  });

  it('nama akun inti mengikuti jenis usaha', () => {
    expect(name('DAGANG', '1-1400')).toBe('Persediaan Barang Dagang');
    expect(name('MANUFAKTUR', '1-1400')).toBe('Persediaan Bahan Baku & Barang Jadi');
    expect(name('FMCG', '1-1400')).toBe('Persediaan Barang Jadi (Produk Konsumen)');
    expect(name('JASA', '5-1000')).toBe('Beban Pokok Pendapatan (Barang & Material)');
    expect(name('RITEL', '4-1000')).toBe('Penjualan Toko (Kasir)');
    expect(name('MANUFAKTUR', '1-2200')).toBe('Mesin & Peralatan Produksi');
    expect(name('FMCG', '4-1000')).toBe('Penjualan Produk Konsumen (Distribusi)');
    expect(name('FNB', '4-1000')).toBe('Penjualan Makanan & Minuman');
    expect(name('FNB', '1-1400')).toBe('Persediaan Bahan Makanan, Minuman & Kemasan');
    expect(name('FNB', '1-2200')).toBe('Peralatan Dapur & Outlet');
  });

  it('akun yang tidak relevan tidak dibuat, tetapi akun yang dipakai modul tetap ada di semua jenis usaha', () => {
    expect(has('RITEL', '6-2200')).toBe(false); // komisi penjualan
    expect(has('JASA', '6-2300')).toBe(false); // beban pengiriman
    expect(has('DAGANG', '6-2200')).toBe(true);
    for (const m of MODELS) {
      const keys = new Set(chart[m].map((a) => a.systemKey).filter(Boolean));
      for (const k of ['CASH', 'AR', 'AP', 'INVENTORY', 'COGS', 'SALES', 'WIP', 'VAT_IN', 'VAT_OUT', 'OPENING_EQUITY']) expect(keys.has(k)).toBe(true);
    }
  });

  it('bagan antar jenis usaha benar-benar berbeda', () => {
    const sig = (m: string) => chart[m].map((a) => `${a.code}:${a.name}`).sort().join('|');
    const sigs = new Set(MODELS.map(sig));
    expect(sigs.size).toBe(MODELS.length);
  });

  it('ganti jenis usaha: nama bawaan ikut berganti, nama buatan pengguna tidak ditimpa, akun lama tidak dihapus', async () => {
    const auth = { Authorization: `Bearer ${tokens.JASA}` };
    const inv = chart.JASA.find((a) => a.code === '1-1400')!;
    const sales = chart.JASA.find((a) => a.code === '4-1000')!;
    await http.patch(`/api/accounting/accounts/${sales.id}`).set(auth).send({ name: 'Omzet Khusus Saya' }).expect(200);
    await http.put('/api/settings/business').set(auth).send({ model: 'MANUFAKTUR', applyApps: false }).expect(200);
    const after = await accounts('JASA');
    expect(after.find((a) => a.code === '1-1400')!.name).toBe('Persediaan Bahan Baku & Barang Jadi'); // bawaan → ikut
    expect(after.find((a) => a.code === '4-1000')!.name).toBe('Omzet Khusus Saya'); // buatan pengguna → tetap
    expect(after.some((a) => a.code === '1-1380')).toBe(true); // akun model sebelumnya tidak dihapus
    expect(after.some((a) => a.code === '5-4500')).toBe(true); // akun model baru ditambahkan
    expect(inv.id).toBe(after.find((a) => a.code === '1-1400')!.id); // id sama, jurnal lama aman
  });

  describe('relevansi: akun yang tidak dipakai jenis usaha dinonaktifkan', () => {
    const active = (m: string, code: string) => chart[m].find((a) => a.code === code)?.isActive;
    it('jasa: persediaan dan produksi nonaktif; produksi: semuanya aktif', () => {
      expect(active('JASA', '1-1400')).toBe(false);
      expect(active('JASA', '1-1420')).toBe(false);
      expect(active('JASA', '5-4100')).toBe(false);
      expect(chart.JASA.find((a) => a.code === '1-1400')!.description).toMatch(/^Tidak dipakai/);
      expect(active('MANUFAKTUR', '1-1400')).toBe(true);
      expect(active('MANUFAKTUR', '1-1420')).toBe(true);
      expect(active('MANUFAKTUR', '4-2100')).toBe(false); // konstruksi tidak relevan untuk produksi
      expect(active('FMCG', '1-1400')).toBe(true);
      expect(active('FMCG', '1-1420')).toBe(false); // FMCG menyalurkan barang jadi: tanpa barang dalam proses
      expect(active('FNB', '1-1400')).toBe(true);
      expect(active('FNB', '1-1430')).toBe(true); // barang setengah jadi (saus, adonan)
      expect(active('FNB', '6-9100')).toBe(true); // selisih kas kasir
    });
    it('dagang/ritel: produksi nonaktif, persediaan aktif; ritel: kasir aktif; dagang: kasir nonaktif', () => {
      expect(active('DAGANG', '1-1400')).toBe(true);
      expect(active('DAGANG', '1-1420')).toBe(false);
      expect(active('RITEL', '6-9100')).toBe(true);
      expect(active('DAGANG', '6-9100')).toBe(false);
      expect(active('JASA', '4-2100')).toBe(true);
    });
    it('akun inti yang dipakai jurnal otomatis tidak ikut nonaktif', () => {
      for (const m of MODELS) for (const code of ['1-1100', '1-1300', '2-1100', '4-1000', '5-1000', '1-1500', '2-1200']) expect(active(m, code)).toBe(true);
    });
    it('ganti ke ritel: akun persediaan dan kasir aktif kembali', async () => {
      const auth = { Authorization: `Bearer ${tokens.JASA}` };
      await http.put('/api/settings/business').set(auth).send({ model: 'RITEL', applyApps: true }).expect(200);
      const after = await accounts('JASA');
      expect(after.find((a) => a.code === '1-1400')!.isActive).toBe(true); // ritel memakai persediaan: aktif kembali
      expect(after.find((a) => a.code === '1-1400')!.description).toBeNull();
      expect(after.find((a) => a.code === '6-9100')!.isActive).toBe(true);
    });
    it('akun yang sudah punya jurnal tidak pernah dinonaktifkan otomatis', async () => {
      const auth = { Authorization: `Bearer ${tokens.DAGANG}` };
      const list = await accounts('DAGANG');
      const wip = list.find((a) => a.code === '1-1420')!; // nonaktif otomatis (dagang)
      const cash = list.find((a) => a.code === '1-1100')!;
      await http.patch(`/api/accounting/accounts/${wip.id}`).set(auth).send({ isActive: true }).expect(200);
      await http.post('/api/accounting/journals').set(auth).send({ date: '2026-01-05', description: 'Pakai WIP', lines: [{ accountId: wip.id, debit: '1000' }, { accountId: cash.id, credit: '1000' }] }).expect(201);
      await http.put('/api/settings/business').set(auth).send({ model: 'DAGANG', applyApps: false }).expect(200);
      expect((await accounts('DAGANG')).find((a) => a.code === '1-1420')!.isActive).toBe(true); // sudah dipakai: tetap aktif
    });
  });

  describe('standar pelaporan: SAK EMKM tidak mengenal pajak tangguhan', () => {
    const DEFERRED = ['1-2600', '2-2300', '9-1100', '2-2200']; // pajak tangguhan dan liabilitas imbalan kerja aktuaria
    it('bawaan (SAK EP) pajak tangguhan aktif; pindah ke SAK EMKM menyembunyikannya; kembali ke SAK EP mengaktifkannya lagi', async () => {
      const t = tokens.FMCG;
      const auth = { Authorization: `Bearer ${t}` };
      const state = async () => Object.fromEntries((await accounts('FMCG')).filter((a) => DEFERRED.includes(a.code)).map((a) => [a.code, a.isActive]));
      expect(await state()).toEqual({ '1-2600': true, '2-2300': true, '9-1100': true, '2-2200': true });
      await http.patch('/api/settings/reporting').set(auth).send({ framework: 'SAK_EMKM' }).expect(200);
      expect(await state()).toEqual({ '1-2600': false, '2-2300': false, '9-1100': false, '2-2200': false });
      const hidden = (await accounts('FMCG')).find((a) => a.code === '1-2600')!;
      expect(hidden.description).toMatch(/^Tidak dipakai/);
      await http.patch('/api/settings/reporting').set(auth).send({ framework: 'SAK_EP' }).expect(200);
      expect(await state()).toEqual({ '1-2600': true, '2-2300': true, '9-1100': true, '2-2200': true });
    });
    it('lewat wizard standar: EMKM menyembunyikan pajak tangguhan; akun yang sudah punya saldo tetap terlihat', async () => {
      const t = tokens.DAGANG;
      const auth = { Authorization: `Bearer ${t}` };
      const list = await accounts('DAGANG');
      const dta = list.find((a) => a.code === '1-2600')!;
      const cap = list.find((a) => a.code === '3-1000')!;
      await http.post('/api/accounting/journals').set(auth).send({ date: '2026-01-05', description: 'Saldo pajak tangguhan', lines: [{ accountId: dta.id, debit: '1000' }, { accountId: cap.id, credit: '1000' }] }).expect(201);
      await http.post('/api/accounting/entity-profile/apply').set(auth).send({ framework: 'SAK_EMKM', taxScheme: 'GENERAL', legalForm: 'UD', publicAccountability: false, assets: 300000000, revenue: 1200000000 }).expect(201);
      const after = await accounts('DAGANG');
      expect(after.find((a) => a.code === '1-2600')!.isActive).toBe(true); // ada saldo: tidak disembunyikan
      expect(after.find((a) => a.code === '2-2300')!.isActive).toBe(false);
      expect(after.find((a) => a.code === '9-1100')!.isActive).toBe(false);
    });
  });
  describe('SAK EMKM berlaku untuk semua jenis usaha', () => {
    const EP_ONLY = ['1-2600', '2-2300', '9-1100', '2-2200', '1-1310', '6-7300', '5-3000', '1-1360', '2-1750'];
    const zero = '00000000-0000-4000-8000-000000000000';
    for (const m of MODELS) {
      it(`${m}: pindah ke EMKM menyembunyikan akun EP, CALK dan fitur EP menyesuaikan; kembali ke EP memulihkan`, async () => {
        const token = (await http.post('/api/auth/register').send({ companyName: `Matriks ${m}`, name: 'Pemilik', email: `mx-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken;
        const auth = { Authorization: `Bearer ${token}` };
        const list = async () => (await http.get('/api/accounting/accounts').set(auth).expect(200)).body as Acc[];
        const before = (await list()).filter((a) => EP_ONLY.includes(a.code));
        const wasActive = before.filter((a) => a.isActive).map((a) => a.code);
        expect(wasActive).toEqual(expect.arrayContaining(['1-2600', '1-1310']));
        await http.patch('/api/settings/reporting').set(auth).send({ framework: 'SAK_EMKM' }).expect(200);
        const hidden = (await list()).filter((a) => EP_ONLY.includes(a.code) && !a.isActive).map((a) => a.code);
        expect(hidden).toEqual(expect.arrayContaining(wasActive)); // akun EP yang aktif kini tersembunyi (yang memang tak relevan tetap tersembunyi)
        expect((await list()).filter((a) => EP_ONLY.includes(a.code) && a.isActive)).toEqual([]);
        const me = (await http.get('/api/auth/me').set(auth).expect(200)).body;
        expect(me.framework).toBe('SAK_EMKM');
        const inc = (await http.get('/api/accounting/statements/income').set(auth).expect(200)).body.lines.map((l: { key: string }) => l.key);
        expect(inc).not.toContain('OCI');
        const notes = JSON.stringify((await http.get(`/api/accounting/notes/${new Date().getFullYear()}`).set(auth).expect(200)).body);
        expect(notes).toContain('Piutang usaha dicatat sebesar jumlah tagihan');
        expect(notes).not.toContain('nilai realisasi neto');
        if (m !== 'RITEL' && m !== 'FNB') {
          // Ritel dan F&B tidak mengaktifkan aplikasi Penjualan/proyek
          const pr = await http.post(`/api/services/projects/${zero}/progress`).set(auth).send({ date: '2026-01-31', percent: '30' });
          expect(pr.body.message).toContain('SAK EMKM');
        }
        await http.patch('/api/settings/reporting').set(auth).send({ framework: 'SAK_EP' }).expect(200);
        const restored = (await list()).filter((a) => EP_ONLY.includes(a.code) && a.isActive).map((a) => a.code);
        expect(restored.sort()).toEqual([...wasActive].sort()); // pergantian standar tidak mengubah bagan akun usaha lain (mis. persediaan pada usaha jasa)
      });
    }
  });
});
