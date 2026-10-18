/**
 * Utilitas (air, listrik, internet): model usaha baru. Tarif bertingkat, sambungan, catat meter (dicatat → diverifikasi orang lain),
 * tagihan bulanan lewat faktur jasa, denda keterlambatan, pemutusan/penyambungan, kontrol kebocoran pendapatan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Utilitas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const longAgo = `${month(4)}-05`;
  let owner: string; let fin: string; let field: string; let adm: string; let acct: string;
  let tariff: string; let fixedTariff: string; let customer: string; let customer2: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const put = (url: string, body: object = {}, t = owner) => http.put(url).set(as(t)).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Griya Asri', name: 'Pemilik', email: `ut-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `ut-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `ut-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    field = await mk('WAREHOUSE', 'lapangan');
    adm = await mk('ADMIN', 'adm');
    acct = await mk('ACCOUNTANT', 'akuntan');
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Budi', paymentTermDays: 20 }).expect(201)).body.id;
    customer2 = (await post('/api/customers', { code: 'PLG2', name: 'Siti', paymentTermDays: 20 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('jenis usaha Utilitas: aplikasi, akun pendapatan, alur kerja, dan istilah khusus tersedia', async () => {
    const me = (await get('/api/auth/me').expect(200)).body;
    expect(me.businessModel).toBe('UTILITAS');
    expect(me.apps).toContain('utility');
    const coa = (await get('/api/accounting/accounts').expect(200)).body as { code: string }[];
    for (const c of ['4-2300', '4-2310', '4-2320', '4-2330', '5-1550']) expect(coa.map((a) => a.code)).toContain(c);
    const flows = (await get('/api/workflow/pipelines').expect(200)).body as { key: string }[];
    expect(flows.map((f) => f.key)).toEqual(expect.arrayContaining(['UTILITAS_PASANG', 'UTILITAS_TUNGGAKAN', 'UTILITAS_BAHAN']));
  });

  it('tarif: blok harus berurutan; Keuangan boleh membuat, hanya Admin/Pemilik mengubah (dengan jejak audit)', async () => {
    const bad = { name: 'Air salah', serviceType: 'AIR', fixedFee: 1000, adminFee: 0, blocks: [{ upTo: 20, price: 3000 }, { upTo: 10, price: 4000 }, { upTo: null, price: 5000 }] };
    expect((await post('/api/utility/tariffs', bad, fin)).status).toBe(400);
    expect((await post('/api/utility/tariffs', { ...bad, blocks: [{ upTo: 10, price: 3000 }] }, fin)).status).toBe(400); // blok terakhir wajib tanpa batas
    expect((await post('/api/utility/tariffs', { name: 'Internet', serviceType: 'INTERNET', fixedFee: 0, adminFee: 0, blocks: [] }, fin)).status).toBe(400);
    expect((await post('/api/utility/tariffs', { name: 'X', serviceType: 'AIR', fixedFee: 1, adminFee: 0, blocks: [{ upTo: null, price: 1 }] }, field)).status).toBe(403);
    const good = { name: 'Air rumah tangga', serviceType: 'AIR', fixedFee: 12000, adminFee: 2500, minUsage: 5, blocks: [{ upTo: 10, price: 3000 }, { upTo: 20, price: 4500 }, { upTo: null, price: 7000 }] };
    tariff = (await post('/api/utility/tariffs', good, fin).expect(201)).body.id;
    expect((await post('/api/utility/tariffs', good, fin)).status).toBe(400); // nama kembar
    fixedTariff = (await post('/api/utility/tariffs', { name: 'Internet 20 Mbps', serviceType: 'INTERNET', fixedFee: 185000, adminFee: 0, blocks: [] }, fin).expect(201)).body.id;
    expect((await put(`/api/utility/tariffs/${tariff}`, { ...good, fixedFee: 15000 }, fin)).status).toBe(403);
    await put(`/api/utility/tariffs/${tariff}`, { ...good, fixedFee: 15000 }, adm).expect(200);
    await put(`/api/utility/tariffs/${tariff}`, good, adm).expect(200); // kembalikan agar hitungan di bawah tetap
    const audited = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'UtilityTariff' AND action = 'UPDATE'`);
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('sambungan: nomor meter wajib untuk layanan terukur; alamat/meter ganda ditolak', async () => {
    const base = { customerId: customer, tariffId: tariff, address: 'Griya Asri Blok A-01', installedAt: longAgo, initialReading: '0' };
    expect((await post('/api/utility/connections', base, fin)).status).toBe(400); // tanpa nomor meter
    expect((await post('/api/utility/connections', { ...base, meterNo: 'MA-1' }, field)).status).toBe(403);
    const c1 = (await post('/api/utility/connections', { ...base, meterNo: 'MA-1' }, fin).expect(201)).body;
    expect(c1.number).toMatch(/^SBG\//);
    expect((await post('/api/utility/connections', { ...base, customerId: customer2, meterNo: 'MA-9' }, fin)).status).toBe(400); // alamat ganda
    expect((await post('/api/utility/connections', { ...base, customerId: customer2, address: 'Blok B-02', meterNo: 'MA-1' }, fin)).status).toBe(400); // meter ganda
    expect((await post('/api/utility/connections', { customerId: customer2, tariffId: fixedTariff, address: 'Blok B-02', meterNo: 'X', installedAt: longAgo }, fin)).status).toBe(400); // tarif tetap tanpa meter
    await post('/api/utility/connections', { customerId: customer2, tariffId: fixedTariff, address: 'Blok B-02', installedAt: longAgo }, fin).expect(201);
  });

  let conn: string;
  const rd = (period: string, current: string, extra: object = {}, t = field) => post('/api/utility/readings', { connectionId: conn, period, current, ...extra }, t);

  it('catat meter: angka tidak boleh turun, berurutan, hanya petugas lapangan; verifikasi oleh orang lain', async () => {
    conn = ((await get('/api/utility/connections?search=A-01').expect(200)).body[0]).id;
    expect((await rd(month(4), '10', {}, fin)).status).toBe(403); // Keuangan tidak mencatat
    expect((await rd(month(-1), '10')).status).toBe(400); // masa depan
    const r1 = (await rd(month(4), '10').then((r) => { expect(r.status).toBe(201); return r; })).body;
    expect(r1.usage).toBe('10.0000');
    expect((await rd(month(4), '12')).status).toBe(400); // periode sama
    expect((await rd(month(3), '9')).status).toBe(400); // turun tanpa ganti meter
    // verifikasi: petugas tidak berhak; Admin pembuat sendiri ditolak; Keuangan boleh
    expect((await post(`/api/utility/readings/${r1.id}/verify`, {}, field)).status).toBe(403);
    await post(`/api/utility/readings/${r1.id}/verify`, {}, fin).expect(201);
    expect((await post(`/api/utility/readings/${r1.id}/verify`, {}, fin)).status).toBe(400); // sudah diputuskan
    // Admin yang mencatat tidak boleh memverifikasi catatannya sendiri
    const r2 = (await rd(month(3), '21', {}, adm).then((r) => { expect(r.status).toBe(201); return r; })).body;
    expect((await post(`/api/utility/readings/${r2.id}/verify`, {}, adm)).status).toBe(403);
    expect((await post(`/api/utility/readings/${r2.id}/reject`, { reason: 'x' }, fin)).status).toBe(400); // alasan terlalu pendek
    await post(`/api/utility/readings/${r2.id}/verify`, {}, fin).expect(201);
  });

  it('meter diganti: wajib angka akhir meter lama + awal meter baru + catatan; pemakaian dijumlahkan', async () => {
    expect((await rd(month(2), '3', { meterReplaced: true })).status).toBe(400); // tanpa angka meter lama/baru
    expect((await rd(month(2), '3', { meterReplaced: true, oldMeterFinal: '30', newMeterStart: '0' })).status).toBe(400); // tanpa catatan
    expect((await rd(month(2), '3', { meterReplaced: true, oldMeterFinal: '15', newMeterStart: '0', note: 'ganti meter' })).status).toBe(400); // meter lama lebih kecil dari catatan sebelumnya (21)
    const r = (await rd(month(2), '3', { meterReplaced: true, oldMeterFinal: '30', newMeterStart: '0', note: 'Meter MA-1 diganti MA-7 (macet)' }).then((x) => { expect(x.status).toBe(201); return x; })).body;
    expect(r.usage).toBe('12.0000'); // (30-21) + (3-0)
    expect(r.flags).toContain('METER_DIGANTI');
    expect((await post(`/api/utility/readings/${r.id}/verify`, {}, fin)).status).toBe(400); // ditandai: wajib catatan pemeriksa
    await post(`/api/utility/readings/${r.id}/verify`, { note: 'Berita acara ganti meter diperiksa' }, fin).expect(201);
  });

  it('angka melonjak ditandai; pemeriksa wajib menulis catatan', async () => {
    await rd(month(1), '14').expect(201).then(async (x) => post(`/api/utility/readings/${x.body.id}/verify`, {}, fin).expect(201)); // usage 11 (3 → 14)
    const r = (await rd(month(0), '90').expect(201)).body; // usage 76 jauh di atas rata-rata
    expect(r.flags).toContain('LONJAKAN');
    expect((await post(`/api/utility/readings/${r.id}/verify`, {}, fin)).status).toBe(400);
    await post(`/api/utility/readings/${r.id}/reject`, { reason: 'Angka salah baca' }, fin).expect(201);
    const again = (await rd(month(0), '19').expect(201)).body; // setelah ditolak boleh dicatat ulang
    expect(again.flags).toEqual([]);
    await post(`/api/utility/readings/${again.id}/verify`, {}, fin).expect(201);
  });

  it('tagihan: hitungan blok tarif benar, hanya dari catatan terverifikasi, tidak bisa tertagih dua kali', async () => {
    const pv = (await get(`/api/utility/billing/preview?period=${month(4)}`, fin).expect(200)).body;
    const mine = pv.ready.find((x: { connectionId: string }) => x.connectionId === conn);
    // 10 m³ → 10×3000 + abonemen 12.000 + admin 2.500
    expect(mine.subtotal).toBe(44500);
    expect((await get(`/api/utility/billing/preview?period=${month(-2)}`, fin)).status).toBe(400);
    expect((await post('/api/utility/billing/run', { period: month(4) }, field)).status).toBe(403);
    expect((await post('/api/utility/billing/run', { period: month(4) }, acct)).status).toBe(403);
    const run = (await post('/api/utility/billing/run', { period: month(4) }, fin).expect(201)).body;
    expect(run.failed).toEqual([]);
    expect(run.billedCount).toBeGreaterThanOrEqual(2); // air terukur + internet tarif tetap
    const again = (await post('/api/utility/billing/run', { period: month(4) }, fin).expect(201)).body;
    expect(again.billedCount).toBe(0);
    const detail = (await get(`/api/utility/connections/${conn}`).expect(200)).body;
    const bill = detail.bills.find((b: { period: string }) => b.period === month(4));
    expect(Number(bill.total)).toBe(44500);
    expect(detail.readings.find((r: { period: string }) => r.period === month(4)).status).toBe('BILLED');
    // faktur nyata di Penjualan, memakai pendapatan pemakaian + abonemen
    const inv = (await get(`/api/invoices/${bill.invoiceId}`).expect(200)).body;
    expect(Number(inv.total)).toBe(44500);
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    const codes = JSON.stringify(tb);
    expect(codes).toContain('4-2300');
    expect(codes).toContain('4-2310');
  });

  it('blok tarif progresif: 11 m³ = 10×3.000 + 1×4.500 + abonemen + admin', async () => {
    const pv = (await get(`/api/utility/billing/preview?period=${month(3)}`, fin).expect(200)).body;
    const mine = pv.ready.find((x: { connectionId: string }) => x.connectionId === conn);
    expect(mine.usage).toBe(11);
    expect(mine.subtotal).toBe(10 * 3000 + 1 * 4500 + 12000 + 2500);
  });

  it('denda keterlambatan: sekali per tagihan, dibatasi persentase; pemutusan hanya bila menunggak; sambung kembali oleh orang lain & lunas', async () => {
    await post('/api/utility/billing/run', { period: month(3) }, fin).expect(201);
    // tagihan periode lama dibuat menunggak 45 hari
    await db.execute(sql`UPDATE invoices SET due_date = CURRENT_DATE - 45 WHERE id IN (SELECT invoice_id FROM utility_bills WHERE connection_id = ${conn})`);
    const od = (await get('/api/utility/overdue', fin).expect(200)).body.find((x: { id: string }) => x.id === conn);
    expect(od.daysLate).toBeGreaterThan(30);
    expect(od.suggestSuspend).toBe(true);
    // bulan berikutnya: denda 2% dari sisa tagihan (maks 10% dari nilai tagihan) ikut ditagih
    const pv = (await get(`/api/utility/billing/preview?period=${month(2)}`, fin).expect(200)).body;
    const mine = pv.ready.find((x: { connectionId: string }) => x.connectionId === conn);
    expect(mine.lateFee).toBeCloseTo((44500 + 49000) * 0.02, 0);
    await post('/api/utility/billing/run', { period: month(2) }, fin).expect(201);
    expect((await get(`/api/utility/billing/preview?period=${month(1)}`, fin).expect(200)).body.ready.find((x: { connectionId: string }) => x.connectionId === conn)?.lateFee ?? 0).toBe(0); // denda tidak dikenakan dua kali
    // pemutusan
    expect((await post(`/api/utility/connections/${conn}/suspend`, { reason: 'x' }, fin)).status).toBe(400);
    await post(`/api/utility/connections/${conn}/suspend`, { reason: 'Menunggak lebih dari 30 hari' }, fin).expect(201);
    expect((await post(`/api/utility/connections/${conn}/reconnect`, { reason: 'sudah bayar' }, fin)).status).toBe(403); // pemutus sendiri
    expect((await post(`/api/utility/connections/${conn}/reconnect`, { reason: 'sudah bayar' }, adm)).status).toBe(400); // masih menunggak
    // lunasi semua tagihan sambungan lalu sambung kembali
    const bills = (await get(`/api/utility/connections/${conn}`).expect(200)).body.bills as { invoiceId: string; total: string; paidAmount: string }[];
    for (const b of bills) {
      const due = Number(b.total) - Number(b.paidAmount);
      if (due > 0) await post('/api/payments', { invoiceId: b.invoiceId, amount: String(due), method: 'CASH' }).expect(201);
    }
    await post(`/api/utility/connections/${conn}/reconnect`, { reason: 'Tagihan lunas' }, adm).expect(201);
    expect((await get(`/api/utility/connections/${conn}`).expect(200)).body.status).toBe('ACTIVE');
    // pembongkaran permanen hanya Admin dan hanya bila lunas
    expect((await post(`/api/utility/connections/${conn}/disconnect`, { reason: 'Pelanggan pindah rumah' }, fin)).status).toBe(403);
  });

  it('kontrol anti-kebocoran dan ringkasan tersedia; peran lain tidak bisa melihat kontrol', async () => {
    const c = (await get('/api/utility/controls', fin).expect(200)).body as { key: string }[];
    expect(c.map((x) => x.key)).toEqual(expect.arrayContaining(['NO_READING', 'ZERO_USAGE', 'STALE', 'FLAGGED', 'DUPLICATE', 'SELF_VERIFIED']));
    expect((await get('/api/utility/controls', field)).status).toBe(403);
    const s = (await get('/api/utility/summary', fin).expect(200)).body;
    expect(s.active).toBeGreaterThanOrEqual(1);
    expect(typeof s.overdueTotal).toBe('number');
  });

  it('aturan denda: dibatasi nilai wajar dan hanya Admin yang mengubah', async () => {
    const rules = (await get('/api/utility/rules', fin).expect(200)).body;
    expect(rules.lateFeePct).toBe(2);
    expect((await put('/api/utility/rules', { ...rules, lateFeePct: 50 }, adm)).status).toBe(400);
    expect((await put('/api/utility/rules', { ...rules, lateFeePct: 3 }, fin)).status).toBe(403);
    expect((await put('/api/utility/rules', { ...rules, lateFeePct: 3 }, adm).expect(200)).body.lateFeePct).toBe(3);
  });

  it('data perusahaan lain tidak terlihat', async () => {
    const other = (await http.post('/api/auth/register').send({ companyName: 'PAM Lain', name: 'X', email: `ut2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    expect((await get('/api/utility/connections', other).expect(200)).body).toEqual([]);
    expect((await get(`/api/utility/connections/${conn}`, other)).status).toBe(404);
  });
});
