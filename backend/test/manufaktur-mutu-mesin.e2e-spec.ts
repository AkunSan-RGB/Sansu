/**
 * Manufaktur: pusat kerja + jadwal mesin (bentrok ditolak), biaya per operasi, dan QC dengan karantina.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Manufaktur: mutu + mesin + biaya operasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const today = todayJakarta();
  let owner = ''; let adm = ''; let wh1 = ''; let wh2 = ''; let fin = ''; let acct = ''; let other = '';
  let W = ''; let RAW = ''; let FG = ''; let FG2 = ''; let bom = ''; let bom2 = '';
  let wc1 = ''; let wc2 = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `mm-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return login(`mm-${n}-${stamp}@uji.id`);
  };
  const stockOf = async (product: string, wh: string) => Number(((await get(owner, `/api/inventory/balances?productId=${product}&warehouseId=${wh}`).expect(200)).body[0]?.qty) ?? 0);
  const balanced = async () => expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  const at = (day: string, h: number, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
  const day = addDays(today, 5);
  const mkOrder = async (t: string, bomId: string, batches = '2') => (await post(t, '/api/production/orders', { bomId, warehouseId: W, batches, date: today }).expect(201)).body;
  const ops = async (orderId: string) => (await get(wh1, `/api/production/orders/${orderId}/operations`).expect(200)).body as { id: string; sequence: number; plannedMinutes: string; status: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Mutu', name: 'Pemilik', email: `mm-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    adm = await mk('ADMIN', 'adm'); wh1 = await mk('WAREHOUSE', 'gd1'); wh2 = await mk('WAREHOUSE', 'gd2'); fin = await mk('FINANCE', 'fin'); acct = await mk('ACCOUNTANT', 'akt');
    other = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Lain', name: 'Lain', email: `mm-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    RAW = (await post(owner, '/api/products', { sku: 'RAW-1', name: 'Bahan Baku', sellPrice: '1000' }).expect(201)).body.id;
    FG = (await post(owner, '/api/products', { sku: 'FG-1', name: 'Produk Jadi A', sellPrice: '50000' }).expect(201)).body.id;
    FG2 = (await post(owner, '/api/products', { sku: 'FG-2', name: 'Produk Jadi B', sellPrice: '70000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: RAW, qty: '1000', unitCost: '1000' }] }).expect(201);
    bom = (await post(owner, '/api/production/boms', { name: 'Resep A', productId: FG, outputQty: '10', laborCost: '5000', overheadCost: '2000', lines: [{ productId: RAW, qty: '5' }] }).expect(201)).body.id;
    bom2 = (await post(owner, '/api/production/boms', { name: 'Resep B', productId: FG2, outputQty: '10', laborCost: '5000', overheadCost: '2000', lines: [{ productId: RAW, qty: '5' }] }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  describe('pusat kerja dan operasi', () => {
    it('pusat kerja: hanya Admin; kode unik; operasi resep disimpan berurutan', async () => {
      const body = { code: 'MSN-01', name: 'Mesin Potong', laborRate: 30000, overheadRate: 60000, capacityHours: 8 };
      await post(wh1, '/api/production/work-centers', body).expect(403);
      wc1 = (await post(adm, '/api/production/work-centers', body).expect(201)).body.id;
      await post(adm, '/api/production/work-centers', { ...body, name: 'Dobel' }).expect(400);
      wc2 = (await post(adm, '/api/production/work-centers', { code: 'MSN-02', name: 'Stasiun Rakit', laborRate: 24000, overheadRate: 12000 }).expect(201)).body.id;
      await put(wh1, `/api/production/boms/${bom}/operations`, { operations: [] }).expect(403);
      await put(adm, `/api/production/boms/${bom}/operations`, { operations: [{ name: 'Potong', workCenterId: wc1, minutesPerBatch: 30 }, { name: 'Rakit', workCenterId: wc2, minutesPerBatch: 20 }] }).expect(200);
      await put(adm, `/api/production/boms/${bom}/operations`, { operations: [{ name: 'X', workCenterId: '00000000-0000-4000-8000-000000000000', minutesPerBatch: 5 }] }).expect(400);
      const saved = (await get(wh1, `/api/production/boms/${bom}/operations`).expect(200)).body as { name: string; sequence: number }[];
      expect(saved.map((o) => o.name)).toEqual(['Potong', 'Rakit']);
      expect((await get(other, '/api/production/work-centers').expect(200)).body).toHaveLength(0);
    });

    let o1 = ''; let o2 = ''; let op1a = ''; let op1b = ''; let op2a = '';
    it('perintah produksi menyalin operasi resep dikali batch', async () => {
      o1 = (await mkOrder(wh1, bom, '2')).id;
      o2 = (await mkOrder(wh1, bom, '1')).id;
      const a = await ops(o1);
      expect(a.map((x) => Number(x.plannedMinutes))).toEqual([60, 40]);
      op1a = a[0].id; op1b = a[1].id;
      op2a = (await ops(o2))[0].id;
    });

    it('jadwal mesin: bentrok ditolak, bersebelahan boleh, urutan dijaga, mesin mati menolak', async () => {
      await post(wh2, `/api/production/operations/${op1a}/schedule`, { startsAt: at(day, 9), endsAt: at(day, 10) }).expect(201);
      const clash = await post(wh2, `/api/production/operations/${op2a}/schedule`, { startsAt: at(day, 9, 30), endsAt: at(day, 10, 30) });
      expect(clash.status).toBe(409);
      await post(wh2, `/api/production/operations/${op2a}/schedule`, { startsAt: at(day, 10), endsAt: at(day, 11) }).expect(201); // bersebelahan
      await post(wh2, `/api/production/operations/${op1b}/schedule`, { startsAt: at(day, 9, 30), endsAt: at(day, 10, 30) }).expect(400); // sebelum operasi 1 selesai
      await post(wh2, `/api/production/operations/${op1b}/schedule`, { startsAt: at(day, 10), endsAt: at(day, 11) }).expect(201); // mesin lain
      await post(fin, `/api/production/operations/${op1b}/schedule`, { startsAt: at(day, 10), endsAt: at(day, 11) }).expect(403); // Keuangan hanya melihat
      await post(wh2, `/api/production/work-centers/${wc1}/downtime`, { startsAt: at(day, 13), endsAt: at(day, 15), reason: 'Perawatan berkala' }).expect(201);
      await post(wh2, `/api/production/operations/${op2a}/schedule`, { startsAt: at(day, 14), endsAt: at(day, 15) }).expect(409); // mesin mati
      await post(wh2, `/api/production/operations/${op2a}/schedule`, { startsAt: at(day, 12), endsAt: at(day, 11) }).expect(400);
      const plan = (await get(acct, `/api/production/schedule?from=${day}&to=${day}`).expect(200)).body;
      expect(plan.operations.length).toBe(3);
      expect(plan.downtime.length).toBe(1);
      await post(wh2, `/api/production/operations/${op2a}/unschedule`).expect(201);
    });

    it('penjadwalan bersamaan pada slot yang sama: tepat satu berhasil', async () => {
      const orders: string[] = [];
      for (let i = 0; i < 4; i++) orders.push((await mkOrder(wh1, bom, '1')).id);
      const first = await Promise.all(orders.map(async (id) => (await ops(id))[0].id));
      const day2 = addDays(today, 6);
      const rs = await Promise.all(first.map((id) => post(wh2, `/api/production/operations/${id}/schedule`, { startsAt: at(day2, 9), endsAt: at(day2, 10) })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
      for (const id of orders) await post(wh1, `/api/production/orders/${id}/cancel`, { date: today }).expect(201);
    });

    it('pelaksanaan: urutan, satu mesin satu operasi, waktu aktual berlebih wajib catatan, biaya = jam × tarif', async () => {
      await post(wh1, `/api/production/operations/${op1a}/start`).expect(400); // perintah belum dimulai
      await post(wh1, `/api/production/orders/${o1}/start`, { date: today }).expect(201);
      await post(wh1, `/api/production/orders/${o2}/start`, { date: today }).expect(201);
      await post(wh1, `/api/production/operations/${op1b}/start`).expect(400); // operasi 1 belum selesai
      await post(wh1, `/api/production/operations/${op1a}/start`).expect(201);
      await post(wh1, `/api/production/operations/${op2a}/start`).expect(409); // mesin sedang dipakai
      await post(wh1, `/api/production/orders/${o1}/complete`, { outputQty: '20', date: today }).expect(400); // operasi belum selesai
      await post(wh1, `/api/production/operations/${op1a}/finish`, { actualMinutes: 100 }).expect(400); // > 150% rencana tanpa catatan
      await post(wh1, `/api/production/operations/${op1a}/finish`, { actualMinutes: 100, note: 'Mata pisau tumpul, potong ulang' }).expect(201);
      await post(wh1, `/api/production/operations/${op1b}/start`).expect(201);
      await post(wh1, `/api/production/operations/${op1b}/finish`, { actualMinutes: 40 }).expect(201);
      const a = (await get(wh1, `/api/production/orders/${o1}/costing`).expect(200)).body;
      // 100 mnt × 30.000/jam = 50.000 ; 40 mnt × 24.000/jam = 16.000 → upah 66.000 ; overhead 100/60×60.000 = 100.000 + 40/60×12.000 = 8.000 → 108.000
      expect(Number(a.operationsLabor)).toBe(66000);
      expect(Number(a.operationsOverhead)).toBe(108000);
      // biaya tidak boleh diketik bila resep beroperasi
      await post(wh1, `/api/production/orders/${o1}/complete`, { outputQty: '20', date: today, laborCost: '1' }).expect(400);
      await put(wh1, `/api/production/operations/${op1a}/correct`, {}).expect(404);
      await post(wh1, `/api/production/operations/${op1a}/correct`, { actualMinutes: 90, reason: 'Koreksi pencatatan' }).expect(403); // hanya Admin
      await post(adm, `/api/production/operations/${op1a}/correct`, { actualMinutes: 90, reason: 'x' }).expect(400);
      await post(adm, `/api/production/operations/${op1a}/correct`, { actualMinutes: 95, reason: 'Koreksi pencatatan mesin' }).expect(201);
      const done = (await post(wh1, `/api/production/orders/${o1}/complete`, { outputQty: '20', date: today }).expect(201)).body;
      expect(Number(done.laborCost)).toBe(47500 + 16000); // 95 mnt × 30.000/jam + 16.000
      expect(Number(done.overheadCost)).toBe(95000 + 8000);
      await post(adm, `/api/production/operations/${op1a}/correct`, { actualMinutes: 60, reason: 'Sudah selesai produksi' }).expect(400);
      await balanced();
    });

    it('kontrol dan pemakaian pusat kerja', async () => {
      const c = (await get(acct, '/api/production/schedule/controls').expect(200)).body;
      expect(c.overruns.length).toBeGreaterThanOrEqual(1);
      expect(c.scheduledDuringDowntime).toBeDefined();
      const u = (await get(acct, '/api/production/work-centers-utilization').expect(200)).body;
      const row = u.rows.find((r: { code: string }) => r.code === 'MSN-01');
      expect(Number(row.actualHours)).toBeCloseTo(95 / 60, 1);
      await post(wh1, `/api/production/orders/${o2}/cancel`, { date: today }).expect(201);
      const cancelled = (await get(wh1, `/api/production/orders/${o2}/operations`).expect(200)).body as { status: string }[];
      expect(cancelled.every((x) => x.status === 'CANCELLED')).toBe(true);
    });
  });

  describe('QC dan karantina', () => {
    const plan = { name: 'QC Produk A', params: [{ name: 'Berat bersih', kind: 'NUMERIC', minValue: 95, maxValue: 105, unit: 'g', critical: true }, { name: 'Segel utuh', kind: 'PASSFAIL' }] };
    let qid = ''; let insp = '';
    const produce = async (bomId: string, product: string, out: string) => {
      const o = await mkOrder(wh1, bomId, '1');
      await post(wh1, `/api/production/orders/${o.id}/start`, { date: today }).expect(201);
      const ops = (await get(wh1, `/api/production/orders/${o.id}/operations`).expect(200)).body as { id: string }[];
      for (const op of ops) { await post(wh1, `/api/production/operations/${op.id}/start`).expect(201); await post(wh1, `/api/production/operations/${op.id}/finish`, { actualMinutes: 1 }).expect(201); }
      await post(wh1, `/api/production/orders/${o.id}/complete`, { outputQty: out, date: today }).expect(201);
      return { orderId: o.id as string, product };
    };

    it('rencana QC: Admin; wajib karantina siap sebelum produk ditandai wajib QC', async () => {
      await put(wh1, `/api/qc/plans/${FG}`, plan).expect(403);
      await put(adm, `/api/qc/plans/${FG}`, { ...plan, params: [{ name: 'Berat', kind: 'NUMERIC' }] }).expect(400); // batas kosong
      await put(adm, `/api/qc/plans/${FG}`, plan).expect(400); // karantina belum disiapkan
      qid = (await post(adm, '/api/qc/setup').expect(201)).body.id;
      expect((await post(adm, '/api/qc/setup').expect(201)).body.created).toBe(false);
      const plans = (await put(adm, `/api/qc/plans/${FG}`, plan).expect(200)).body as { params: unknown[]; qcRequired: boolean }[];
      expect(plans[0].params).toHaveLength(2);
      expect(plans[0].qcRequired).toBe(true);
      await put(adm, `/api/qc/plans/${FG2}`, { ...plan, name: 'QC B' }).expect(200);
    });

    it('hasil produksi produk wajib QC masuk karantina; tidak bisa dikeluarkan sebelum QC', async () => {
      const r = await produce(bom, FG, '10');
      expect(await stockOf(FG, qid)).toBe(10);
      expect(await stockOf(FG, W)).toBe(20); // hasil perintah o1 sebelumnya? (FG belum wajib QC saat itu)
      const list = (await get(wh2, '/api/qc/inspections?status=PENDING').expect(200)).body as { id: string; orderNumber: string }[];
      expect(list).toHaveLength(1);
      insp = list[0].id;
      // stok karantina tidak bisa dikoreksi/dipindah/dijual
      await post(owner, '/api/inventory/adjustments', { warehouseId: qid, reason: 'DAMAGED', date: today, lines: [{ productId: FG, qty: '-1' }] }).expect(400);
      expect(r.orderId).toBeTruthy();
    });

    it('keputusan QC: pemisahan fungsi, penilaian oleh server, kritis gagal = lot gagal, lolos dipindah ke gudang tujuan', async () => {
      const d = (await get(wh2, `/api/qc/inspections/${insp}`).expect(200)).body as { results: { id: string; kind: string }[] };
      const [w, seal] = d.results;
      const ok = [{ resultId: w.id, value: 100 }, { resultId: seal.id, pass: true }];
      await post(wh1, `/api/qc/inspections/${insp}/decide`, { results: ok }).expect(403); // pembuat hasil produksi tidak boleh menginspeksi
      await post(fin, `/api/qc/inspections/${insp}/decide`, { results: ok }).expect(403); // bukan peran QC
      await post(wh2, `/api/qc/inspections/${insp}/decide`, { results: [ok[0]] }).expect(400); // parameter belum lengkap
      await post(wh2, `/api/qc/inspections/${insp}/decide`, { results: [{ resultId: w.id, pass: true }, ok[1]] }).expect(400); // parameter angka wajib angka
      // kritis gagal: server menolak mengesahkan lolos, meski klien meminta
      await post(wh2, `/api/qc/inspections/${insp}/decide`, { results: [{ resultId: w.id, value: 120 }, ok[1]], qtyPass: 10 }).expect(400);
      const pass = (await post(wh2, `/api/qc/inspections/${insp}/decide`, { results: ok }).expect(201)).body;
      expect(pass.status).toBe('PASSED');
      expect(await stockOf(FG, qid)).toBe(0);
      expect(await stockOf(FG, W)).toBe(30);
      await post(wh2, `/api/qc/inspections/${insp}/decide`, { results: ok }).expect(400); // sudah diputuskan
      await balanced();
    });

    it('lot gagal tetap di karantina; sebagian lolos; scrap hanya Admin dan orang lain dari inspektur; dijurnal', async () => {
      const r2 = await produce(bom2, FG2, '10');
      const i2 = ((await get(wh2, '/api/qc/inspections?status=PENDING').expect(200)).body as { id: string; orderNumber: string }[])[0].id;
      const d = (await get(wh2, `/api/qc/inspections/${i2}`).expect(200)).body as { results: { id: string }[] };
      const [w, seal] = d.results;
      // segel tidak utuh (non-kritis): seluruh lot tidak boleh lolos, sebagian boleh dengan catatan
      await post(wh2, `/api/qc/inspections/${i2}/decide`, { results: [{ resultId: w.id, value: 100 }, { resultId: seal.id, pass: false }], qtyPass: 10, note: 'semua lolos saja' }).expect(400);
      await post(wh2, `/api/qc/inspections/${i2}/decide`, { results: [{ resultId: w.id, value: 100 }, { resultId: seal.id, pass: false }], qtyPass: 7 }).expect(400); // tanpa catatan
      const part = (await post(wh2, `/api/qc/inspections/${i2}/decide`, { results: [{ resultId: w.id, value: 100 }, { resultId: seal.id, pass: false }], qtyPass: 7, note: '3 unit segel bocor, 7 unit lolos sortir' }).expect(201)).body;
      expect(part.status).toBe('PARTIAL');
      expect(await stockOf(FG2, qid)).toBe(3);
      expect(await stockOf(FG2, W)).toBe(7);
      await post(wh2, `/api/qc/inspections/${i2}/scrap`, { qty: 3, reason: 'Segel bocor' }).expect(403); // bukan Admin
      await post(adm, `/api/qc/inspections/${i2}/scrap`, { qty: 5, reason: 'Segel bocor' }).expect(400); // melebihi sisa
      await post(adm, `/api/qc/inspections/${i2}/scrap`, { qty: 3, reason: 'x' }).expect(400);
      const before = Number((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.rows.length);
      const sc = (await post(adm, `/api/qc/inspections/${i2}/scrap`, { qty: 3, reason: 'Segel bocor, dimusnahkan' }).expect(201)).body;
      expect(Number(sc.qtyScrapped)).toBe(3);
      expect(await stockOf(FG2, qid)).toBe(0);
      expect(before).toBeGreaterThan(0);
      await balanced();
      await post(adm, `/api/qc/inspections/${i2}/scrap`, { qty: 1, reason: 'Sudah habis' }).expect(400);
      expect(r2.orderId).toBeTruthy();
    });

    it('kontrol QC dan isolasi antar perusahaan', async () => {
      const c = (await get(acct, '/api/qc/controls').expect(200)).body;
      expect(c.failRateByProduct.length).toBeGreaterThanOrEqual(1);
      expect((await get(other, '/api/qc/inspections').expect(200)).body).toHaveLength(0);
      expect((await get(other, '/api/qc/plans').expect(200)).body).toHaveLength(0);
      await get(other, `/api/qc/inspections/${insp}`).expect(404);
      const a = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity IN ('QcInspection','ProductionOperation')`);
      expect(a.rows[0].n).toBeGreaterThanOrEqual(8);
    });
  });
});
