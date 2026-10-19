/**
 * Manufaktur lanjutan: kalender shift mesin, sampling, rework (maks. 3 percobaan), lampiran QC (foto/PDF),
 * dan QC barang masuk dari pemasok (karantina saat diterima, juga lewat faktur langsung).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64')}`;
const nextMonday = (from: string) => {
  let d = addDays(from, 4);
  while (new Date(`${d}T12:00:00+07:00`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
};

describe('Manufaktur lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const today = todayJakarta();
  let owner = ''; let adm = ''; let wh1 = ''; let wh2 = ''; let fin = ''; let acct = ''; let other = '';
  let W = ''; let RAW = ''; let FG = ''; let MAT = ''; let bom = ''; let Q = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const del = (t: string, u: string) => http.delete(u).set(as(t));
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ml-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return login(`ml-${n}-${stamp}@uji.id`);
  };
  const stockOf = async (product: string, wh: string) => Number(((await get(owner, `/api/inventory/balances?productId=${product}&warehouseId=${wh}`).expect(200)).body[0]?.qty) ?? 0);
  const balanced = async () => expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  const at = (day: string, h: number, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
  const mon = nextMonday(today);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Lanjutan', name: 'Pemilik', email: `ml-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    adm = await mk('ADMIN', 'adm'); wh1 = await mk('WAREHOUSE', 'gd1'); wh2 = await mk('WAREHOUSE', 'gd2'); fin = await mk('FINANCE', 'fin'); acct = await mk('ACCOUNTANT', 'akt');
    other = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Lain', name: 'Lain', email: `ml-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    RAW = (await post(owner, '/api/products', { sku: 'RAW-1', name: 'Bahan Baku', sellPrice: '1000' }).expect(201)).body.id;
    FG = (await post(owner, '/api/products', { sku: 'FG-1', name: 'Produk Jadi A', sellPrice: '50000' }).expect(201)).body.id;
    MAT = (await post(owner, '/api/products', { sku: 'MAT-1', name: 'Bahan Wajib QC', sellPrice: '1500' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: RAW, qty: '5000', unitCost: '1000' }] }).expect(201);
    bom = (await post(owner, '/api/production/boms', { name: 'Resep A', productId: FG, outputQty: '10', laborCost: '5000', overheadCost: '2000', lines: [{ productId: RAW, qty: '5' }] }).expect(201)).body.id;
    Q = (await post(adm, '/api/qc/setup').expect(201)).body.id;
  });
  afterAll(() => app.close());

  describe('kalender shift mesin', () => {
    let wc = ''; let wc2 = ''; let opA = ''; let opB = ''; let opC = ''; let opD = '';
    const mkOps = async (bomId: string, batches = '1') => {
      const o = (await post(wh1, '/api/production/orders', { bomId, warehouseId: W, batches, date: today }).expect(201)).body;
      return ((await get(wh1, `/api/production/orders/${o.id}/operations`).expect(200)).body as { id: string }[])[0].id;
    };
    it('kalender: Admin saja, validasi, tumpang tindih ditolak, dapat dibaca', async () => {
      wc = (await post(adm, '/api/production/work-centers', { code: 'SH-1', name: 'Mesin Shift', laborRate: 20000, overheadRate: 10000, capacityHours: 8 }).expect(201)).body.id;
      wc2 = (await post(adm, '/api/production/work-centers', { code: 'SH-2', name: 'Mesin Tanpa Kalender', laborRate: 20000, overheadRate: 10000 }).expect(201)).body.id;
      const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '07:00', end: '15:00' }));
      await put(wh1, `/api/production/work-centers/${wc}/shifts`, { shifts: weekdays }).expect(403);
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: [{ weekday: 1, start: '15:00', end: '07:00' }] }).expect(400);
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: [{ weekday: 1, start: '7am', end: '15:00' }] }).expect(400);
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: [{ weekday: 1, start: '07:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '15:00' }] }).expect(400); // tumpang tindih
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: [...weekdays, { weekday: 2, start: '18:00', end: '22:00' }] }).expect(200);
      const saved = (await get(acct, `/api/production/work-centers/${wc}/shifts`).expect(200)).body as { weekday: number; start: string; end: string }[];
      expect(saved).toHaveLength(6);
      expect(saved[0]).toEqual({ weekday: 1, start: '07:00', end: '15:00' });
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: weekdays }).expect(200); // kembali ke Senin–Jumat saja
      await put(adm, `/api/production/boms/${bom}/operations`, { operations: [{ name: 'Proses', workCenterId: wc, minutesPerBatch: 60 }] }).expect(200);
      opA = await mkOps(bom); opB = await mkOps(bom); opC = await mkOps(bom); opD = await mkOps(bom);
    });

    it('penjadwalan harus di dalam satu shift; di luar shift hanya Admin dengan alasan dan ditandai', async () => {
      const tue = addDays(mon, 1);
      await post(wh2, `/api/production/operations/${opA}/schedule`, { startsAt: at(tue, 8), endsAt: at(tue, 9) }).expect(201); // di dalam shift
      expect((await post(wh2, `/api/production/operations/${opB}/schedule`, { startsAt: at(tue, 16), endsAt: at(tue, 17) })).status).toBe(400); // luar jam
      expect((await post(wh2, `/api/production/operations/${opB}/schedule`, { startsAt: at(tue, 14, 30), endsAt: at(tue, 15, 30) })).status).toBe(400); // melewati akhir shift
      expect((await post(wh2, `/api/production/operations/${opB}/schedule`, { startsAt: at(addDays(mon, 5), 8), endsAt: at(addDays(mon, 5), 9) })).status).toBe(400); // Sabtu: tidak ada shift
      expect((await post(wh2, `/api/production/operations/${opB}/schedule`, { startsAt: at(tue, 16), endsAt: at(tue, 17), offShiftReason: 'Lembur mendesak' })).status).toBe(403); // bukan Admin
      expect((await post(adm, `/api/production/operations/${opB}/schedule`, { startsAt: at(tue, 16), endsAt: at(tue, 17), offShiftReason: 'x' })).status).toBe(400); // alasan pendek
      await post(adm, `/api/production/operations/${opB}/schedule`, { startsAt: at(tue, 16), endsAt: at(tue, 17), offShiftReason: 'Lembur pesanan mendesak' }).expect(201);
      const ctl = (await get(acct, '/api/production/schedule/controls').expect(200)).body;
      expect(ctl.scheduledOffShift.map((x: { workCenter: string }) => x.workCenter)).toContain('SH-1');
      // pusat kerja tanpa kalender: perilaku lama (bebas jam)
      await put(adm, `/api/production/boms/${bom}/operations`, { operations: [{ name: 'Proses', workCenterId: wc2, minutesPerBatch: 60 }] }).expect(200);
      const free = await mkOps(bom);
      await post(wh2, `/api/production/operations/${free}/schedule`, { startsAt: at(addDays(mon, 5), 20), endsAt: at(addDays(mon, 5), 21) }).expect(201);
    });

    it('kapasitas harian mengikuti kalender: hari tanpa shift berkapasitas 0', async () => {
      const wed = addDays(mon, 2);
      await put(adm, `/api/production/work-centers/${wc}/shifts`, { shifts: [{ weekday: 1, start: '07:00', end: '15:00' }] }).expect(200); // hanya Senin
      await post(adm, `/api/production/operations/${opC}/schedule`, { startsAt: at(wed, 9), endsAt: at(wed, 10), offShiftReason: 'Pesanan darurat Rabu' }).expect(201);
      const ctl = (await get(acct, '/api/production/schedule/controls').expect(200)).body;
      const row = ctl.overbookedDays.find((d: { code: string; day: string }) => d.code === 'SH-1' && d.day === wed);
      expect(row).toBeTruthy();
      expect(Number(row.capacity)).toBe(0);
      await post(wh2, `/api/production/operations/${opC}/unschedule`).expect(201);
      void opD;
    });
  });

  describe('QC: sampling, rework, lampiran', () => {
    const plan = { name: 'QC Produk A', samplePct: 10, sampleMin: 2, sampleMax: 5, acceptDefects: 1, params: [{ name: 'Berat bersih', kind: 'NUMERIC', minValue: 95, maxValue: 105, unit: 'g' }] };
    const produce = async (out: string) => {
      await put(adm, `/api/production/boms/${bom}/operations`, { operations: [] }).expect(200);
      const o = (await post(wh1, '/api/production/orders', { bomId: bom, warehouseId: W, batches: '1', date: today }).expect(201)).body;
      await post(wh1, `/api/production/orders/${o.id}/start`, { date: today }).expect(201);
      await post(wh1, `/api/production/orders/${o.id}/complete`, { outputQty: out, date: today, laborCost: '1000', overheadCost: '500' }).expect(201);
      const list = (await get(wh2, '/api/qc/inspections?status=PENDING').expect(200)).body as { id: string; sourceType: string }[];
      return list[0].id;
    };
    const detail = async (id: string) => (await get(wh2, `/api/qc/inspections/${id}`).expect(200)).body as { status: string; attempt: number; qty: string; qtyReworked: string; sampleSize: string | null; results: { id: string }[]; attachments: { id: string }[]; parentNumber: string | null };
    const decide = (t: string, id: string, d: { results: { id: string }[] }, extra: object = {}) => post(t, `/api/qc/inspections/${id}/decide`, { results: [{ resultId: d.results[0].id, value: 100 }], ...extra });

    it('rencana sampling: validasi', async () => {
      await put(adm, `/api/qc/plans/${FG}`, { ...plan, acceptDefects: undefined }).expect(400); // sampling tanpa batas cacat
      await put(adm, `/api/qc/plans/${FG}`, { ...plan, samplePct: undefined }).expect(400); // batas tanpa persen
      await put(adm, `/api/qc/plans/${FG}`, { ...plan, sampleMin: 9, sampleMax: 3 }).expect(400);
      const saved = (await put(adm, `/api/qc/plans/${FG}`, plan).expect(200)).body as { samplePct: string; acceptDefects: number }[];
      expect(Number(saved[0].samplePct)).toBe(10);
      expect(saved[0].acceptDefects).toBe(1);
    });

    let first = '';
    it('ukuran sampel dihitung server; cacat melebihi batas = lot gagal; cacat dalam batas = lolos', async () => {
      first = await produce('50');
      const d = await detail(first);
      expect(Number(d.sampleSize)).toBe(5); // 10% × 50 = 5 (di antara min 2 dan maks 5)
      await decide(wh2, first, d).expect(400); // jumlah cacat sampel belum diisi
      await decide(wh2, first, d, { sampleDefects: 6 }).expect(400); // melebihi ukuran sampel
      await decide(wh2, first, d, { sampleDefects: 2 }).expect(400); // gagal: wajib catatan karena tidak lolos
      const failed = (await decide(wh2, first, d, { sampleDefects: 2, note: '2 dari 5 sampel cacat, melebihi batas 1' }).expect(201)).body;
      expect(failed.status).toBe('FAILED');
      expect(Number(failed.qtyFail)).toBe(50);
      expect(await stockOf(FG, Q)).toBe(50);
      // sampling dalam batas pada lot lain
      const second = await produce('20');
      const d2 = await detail(second);
      expect(Number(d2.sampleSize)).toBe(2);
      const ok = (await decide(wh2, second, d2, { sampleDefects: 1 }).expect(201)).body;
      expect(ok.status).toBe('PASSED');
      expect(await stockOf(FG, W)).toBe(20);
    });

    it('rework: peran, jumlah, percobaan berikutnya, inspektur berbeda dari pengerja ulang; scrap menghormati sisa', async () => {
      await post(fin, `/api/qc/inspections/${first}/rework`, { qty: 10, reason: 'Sortir ulang' }).expect(403);
      await post(wh1, `/api/qc/inspections/${first}/rework`, { qty: 60, reason: 'Sortir ulang' }).expect(400); // melebihi sisa
      await post(wh1, `/api/qc/inspections/${first}/rework`, { qty: 30, reason: 'x' }).expect(400);
      const child = (await post(wh1, `/api/qc/inspections/${first}/rework`, { qty: 30, reason: 'Sortir dan ganti segel' }).expect(201)).body;
      expect(child.attempt).toBe(2);
      expect(child.parentNumber).toBeTruthy();
      expect(Number(child.qty)).toBe(30);
      expect(Number(child.sampleSize)).toBe(3); // 10% × 30
      expect(Number((await detail(first)).qtyReworked)).toBe(30);
      expect(await stockOf(FG, Q)).toBe(50); // stok tetap di karantina
      // sisa 20 yang boleh dibuang
      await post(adm, `/api/qc/inspections/${first}/scrap`, { qty: 25, reason: 'Dimusnahkan' }).expect(400);
      // tidak bisa menginspeksi sendiri hasil pengerjaan ulangnya
      const d = await detail(child.id);
      await decide(wh1, child.id, d, { sampleDefects: 0 }).expect(403);
      const passed = (await decide(wh2, child.id, d, { sampleDefects: 0 }).expect(201)).body;
      expect(passed.status).toBe('PASSED');
      expect(await stockOf(FG, Q)).toBe(20);
      expect(await stockOf(FG, W)).toBe(50);
      await post(adm, `/api/qc/inspections/${first}/scrap`, { qty: 20, reason: 'Sisa lot dimusnahkan' }).expect(201);
      expect(await stockOf(FG, Q)).toBe(0);
      await balanced();
    });

    it('rework dibatasi 3 percobaan', async () => {
      const a = await produce('10');
      const da = await detail(a);
      await decide(wh2, a, da, { sampleDefects: 2, note: 'Cacat banyak percobaan 1' }).expect(201);
      const b = (await post(wh1, `/api/qc/inspections/${a}/rework`, { qty: 10, reason: 'Ulang percobaan 2' }).expect(201)).body;
      await decide(wh2, b.id, await detail(b.id), { sampleDefects: 2, note: 'Masih cacat percobaan 2' }).expect(201);
      const c = (await post(wh1, `/api/qc/inspections/${b.id}/rework`, { qty: 10, reason: 'Ulang percobaan 3' }).expect(201)).body;
      expect(c.attempt).toBe(3);
      await decide(wh2, c.id, await detail(c.id), { sampleDefects: 2, note: 'Masih cacat percobaan 3' }).expect(201);
      expect((await post(wh1, `/api/qc/inspections/${c.id}/rework`, { qty: 10, reason: 'Ulang lagi' })).status).toBe(400); // batas tercapai
      await post(adm, `/api/qc/inspections/${c.id}/scrap`, { qty: 10, reason: 'Tiga kali gagal, dimusnahkan' }).expect(201);
      const ctl = (await get(acct, '/api/qc/controls').expect(200)).body;
      expect(ctl.reworkAttempts.length).toBeGreaterThanOrEqual(2);
      await balanced();
    });

    it('lampiran: foto dan sertifikat analisis (PDF), validasi isi, batas jumlah, dibuka per perusahaan, bukti tidak dihapus setelah diputuskan', async () => {
      await put(adm, `/api/qc/plans/${FG}`, { ...plan, samplePct: undefined, sampleMin: undefined, sampleMax: undefined, acceptDefects: undefined }).expect(200);
      const id = await produce('10');
      await post(acct, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: 'a.png', dataUrl: PNG }).expect(403);
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: 'a.pdf', dataUrl: PDF }).expect(400); // foto tidak boleh PDF
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: 'palsu.png', dataUrl: `data:image/png;base64,${Buffer.from('bukan gambar sama sekali').toString('base64')}` }).expect(400);
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'COA', filename: 'palsu.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('bukan pdf').toString('base64')}` }).expect(400);
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'COA', filename: 'x.exe', dataUrl: `data:application/zip;base64,UEsDBA==` }).expect(400);
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: 'sampel.png', dataUrl: PNG }).expect(201);
      const withDoc = (await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'COA', filename: 'sertifikat.pdf', dataUrl: PDF }).expect(201)).body as { attachments: { id: string; kind: string; mime: string }[] };
      expect(withDoc.attachments.map((a) => a.kind)).toEqual(['PHOTO', 'COA']);
      const coa = withDoc.attachments[1];
      const got = (await get(acct, `/api/qc/inspections/${id}/attachments/${coa.id}`).expect(200)).body;
      expect(got.mime).toBe('application/pdf');
      expect(got.dataUrl).toBe(PDF);
      await get(other, `/api/qc/inspections/${id}/attachments/${coa.id}`).expect(404);
      for (let i = 0; i < 8; i++) await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: `f${i}.png`, dataUrl: PNG }).expect(201);
      await post(wh2, `/api/qc/inspections/${id}/attachments`, { kind: 'PHOTO', filename: 'lebih.png', dataUrl: PNG }).expect(400); // maks. 10
      await del(wh2, `/api/qc/inspections/${id}/attachments/${coa.id}`).expect(403); // hanya Admin
      await del(adm, `/api/qc/inspections/${id}/attachments/${coa.id}`).expect(200);
      const d = await detail(id);
      await decide(wh2, id, d).expect(201);
      const left = (await detail(id)).attachments[0];
      await del(adm, `/api/qc/inspections/${id}/attachments/${left.id}`).expect(400); // sudah diputuskan: bukti dikunci
    });
  });

  describe('QC barang masuk dari pemasok', () => {
    let supp = '';
    const mkPo = async (qty: string) => {
      const po = (await post(owner, '/api/purchase-orders', { supplierId: supp, warehouseId: W, lines: [{ productId: MAT, qty, price: '1000' }] }).expect(201)).body;
      await post(owner, `/api/purchase-orders/${po.id}/confirm`).expect(201);
      return (await get(owner, `/api/purchase-orders/${po.id}`).expect(200)).body as { id: string; lines: { id: string }[] };
    };
    const pending = async () => (await get(wh2, '/api/qc/inspections?status=PENDING').expect(200)).body as { id: string; sourceType: string; receiptNumber: string | null; lotNo: string | null }[];
    it('barang wajib QC diterima ke karantina, bukan gudang tujuan; inspeksi dibuat; penerimaan tidak bisa dibatalkan', async () => {
      supp = (await post(owner, '/api/suppliers', { code: 'SUP-QC', name: 'Pemasok Bahan' }).expect(201)).body.id;
      await put(adm, `/api/qc/plans/${MAT}`, { name: 'QC bahan masuk', params: [{ name: 'Kadar air (%)', kind: 'NUMERIC', maxValue: 12, critical: true }] }).expect(200);
      const po = await mkPo('100');
      const rec = (await post(wh1, `/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: po.lines[0].id, qty: '100', lotNo: 'LOT-A1', expiryDate: addDays(today, 200) }] }).expect(201)).body;
      expect(await stockOf(MAT, W)).toBe(0);
      expect(await stockOf(MAT, Q)).toBe(100);
      const p = await pending();
      const insp = p.find((x) => x.sourceType === 'RECEIPT')!;
      expect(insp.receiptNumber).toBe(rec.number);
      expect(insp.lotNo).toBe('LOT-A1');
      await post(wh1, `/api/goods-receipts/${rec.id}/cancel`, {}).expect(400); // sudah memiliki inspeksi QC
      const d = (await get(wh2, `/api/qc/inspections/${insp.id}`).expect(200)).body as { results: { id: string }[] };
      await post(wh1, `/api/qc/inspections/${insp.id}/decide`, { results: [{ resultId: d.results[0].id, value: 10 }] }).expect(403); // penerima tidak boleh menginspeksi
      const ok = (await post(wh2, `/api/qc/inspections/${insp.id}/decide`, { results: [{ resultId: d.results[0].id, value: 10 }] }).expect(201)).body;
      expect(ok.status).toBe('PASSED');
      expect(await stockOf(MAT, W)).toBe(100);
      expect(await stockOf(MAT, Q)).toBe(0);
      // nomor lot dan kedaluwarsa ikut ke gudang tujuan
      const lots = await db.execute<{ lot_no: string; qty_remaining: string }>(sql`SELECT lot_no, qty_remaining FROM stock_lots WHERE product_id = ${MAT} AND warehouse_id = ${W} AND lot_no = 'LOT-A1'`);
      expect(lots.rows).toHaveLength(1);
      expect(Number(lots.rows[0].qty_remaining)).toBe(100);
      // faktur pemasok tetap dapat dicocokkan dengan penerimaan
      await post(fin, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'INV-QC-1' }).expect(201);
      await balanced();
    });

    it('barang masuk gagal: tetap di karantina sampai dibuang; kontrol memuat tingkat gagal per pemasok', async () => {
      const po = await mkPo('40');
      await post(wh1, `/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
      const insp = (await pending()).find((x) => x.sourceType === 'RECEIPT')!;
      const d = (await get(wh2, `/api/qc/inspections/${insp.id}`).expect(200)).body as { results: { id: string }[] };
      const bad = (await post(wh2, `/api/qc/inspections/${insp.id}/decide`, { results: [{ resultId: d.results[0].id, value: 18 }], note: 'Kadar air 18%, ditolak' }).expect(201)).body;
      expect(bad.status).toBe('FAILED');
      expect(await stockOf(MAT, W)).toBe(100);
      expect(await stockOf(MAT, Q)).toBe(40);
      await post(adm, `/api/qc/inspections/${insp.id}/scrap`, { qty: 40, reason: 'Kadar air tinggi, dimusnahkan' }).expect(201);
      expect(await stockOf(MAT, Q)).toBe(0);
      const ctl = (await get(acct, '/api/qc/controls').expect(200)).body;
      expect(ctl.inboundFailRateBySupplier.map((x: { supplier: string }) => x.supplier)).toContain('Pemasok Bahan');
      await balanced();
    });

    it('jalur faktur langsung (terima + tagih sekaligus) juga masuk karantina', async () => {
      const po = await mkPo('30');
      await post(owner, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'INV-QC-2' }).expect(201);
      expect(await stockOf(MAT, Q)).toBe(30);
      expect(await stockOf(MAT, W)).toBe(100);
      const insp = (await pending()).find((x) => x.sourceType === 'RECEIPT')!;
      expect(insp).toBeTruthy();
      await balanced();
    });
  });
});
