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
const MODELS = ['DAGANG', 'RITEL', 'JASA', 'PRODUKSI'] as const;

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
    expect(has('PRODUKSI', '5-4500')).toBe(true);
    expect(has('PRODUKSI', '5-4800')).toBe(true);
    expect(has('DAGANG', '5-4500')).toBe(false);
  });

  it('nama akun inti mengikuti jenis usaha', () => {
    expect(name('DAGANG', '1-1400')).toBe('Persediaan Barang Dagang');
    expect(name('PRODUKSI', '1-1400')).toBe('Persediaan Bahan Baku & Barang Jadi');
    expect(name('JASA', '5-1000')).toBe('Beban Pokok Pendapatan (Barang & Material)');
    expect(name('RITEL', '4-1000')).toBe('Penjualan Toko (Kasir)');
    expect(name('PRODUKSI', '1-2200')).toBe('Mesin & Peralatan Produksi');
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
    await http.put('/api/settings/business').set(auth).send({ model: 'PRODUKSI', applyApps: false }).expect(200);
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
      expect(active('PRODUKSI', '1-1400')).toBe(true);
      expect(active('PRODUKSI', '1-1420')).toBe(true);
      expect(active('PRODUKSI', '4-2100')).toBe(false); // konstruksi tidak relevan untuk produksi
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
});
