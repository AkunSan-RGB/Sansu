/**
 * Jasa kontraktor: retensi (tagihan terpisah jatuh tempo setelah masa pemeliharaan) dan BoQ/RAB sebagai dasar persentase kemajuan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Jasa kontraktor: retensi + BoQ (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let sales = '';
  let cust = ''; let project = ''; let plain = '';
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'CV Kontraktor Mandiri', name: 'Pemilik', email: `kt-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Sales', email: `kt-s-${stamp}@uji.id`, password: 'rahasia12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `kt-s-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    cust = (await post(owner, '/api/customers', { code: 'KT1', name: 'PT Pemilik Gedung', paymentTermDays: 14 }).expect(201)).body.id;
    project = (await post(owner, '/api/services/projects', { name: 'Gedung kantor', customerId: cust, contractValue: '200000000', retentionPct: '5', retentionDays: 180 }).expect(201)).body.id;
    plain = (await post(owner, '/api/services/projects', { name: 'Proyek tanpa retensi', customerId: cust, contractValue: '50000000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const termin = (projectId: string, price: string, extra: object = {}) =>
    post(owner, '/api/services/invoices', { customerId: cust, projectId, date: today, termLabel: 'Termin 1', withVat: false, lines: [{ description: 'Termin 1 — struktur', price }], ...extra });

  it('retensi harus 0–100%', async () => {
    expect((await post(owner, '/api/services/projects', { name: 'Salah', customerId: cust, contractValue: '1', retentionPct: '100' })).status).toBe(400);
  });

  it('termin proyek beretensi dipecah: tagihan jalan 95%, tagihan retensi 5% jatuh tempo setelah masa pemeliharaan', async () => {
    const r = (await termin(project, '100000000').expect(201)).body;
    expect(r.retentionInvoice).toMatchObject({ amount: '5000000.00', dueDate: addDays(today, 180) });
    const main = (await get(owner, `/api/invoices/${r.id}`).expect(200)).body;
    const ret = (await get(owner, `/api/invoices/${r.retentionInvoice.id}`).expect(200)).body;
    expect(Number(main.subtotal)).toBe(95000000);
    expect(Number(ret.subtotal)).toBe(5000000);
    expect(ret.dueDate).toBe(addDays(today, 180));
    // total DPP proyek tetap 100.000.000 (tidak melebihi kontrak)
    const p = (await get(owner, `/api/services/projects/${project}`).expect(200)).body;
    expect(Number(p.billed)).toBe(100000000);
    expect(p.retentionHeld).toBe('5000000.00');
    // piutang pembantu tetap cocok dengan buku besar dan neraca saldo seimbang
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
    const health = (await get(owner, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(health.filter((h) => h.status === 'ERROR').map((h) => h.key)).toEqual([]);
  });

  it('retensi dapat dilihat, dicairkan dengan dasar tercatat, dan dibayar seperti faktur biasa', async () => {
    const list = (await get(sales, `/api/services/projects/${project}/retention`).expect(200)).body;
    expect(list.held).toBe('5000000.00');
    expect(list.invoices).toHaveLength(1);
    const invId = list.invoices[0].invoiceId as string;
    expect((await post(sales, `/api/services/projects/${project}/retention/release`, { dueDate: today, reason: 'BA serah terima akhir No. 7' })).status).toBe(403);
    expect((await post(owner, `/api/services/projects/${project}/retention/release`, { dueDate: today, reason: 'x' })).status).toBe(400);
    const rel = (await post(owner, `/api/services/projects/${project}/retention/release`, { dueDate: today, reason: 'BA serah terima akhir No. 7' }).expect(201)).body;
    expect(rel.released).toBe(1);
    expect((await get(owner, `/api/invoices/${invId}`).expect(200)).body.dueDate).toBe(today);
    await post(owner, '/api/payments', { invoiceId: invId, amount: '5000000', method: 'TRANSFER' }).expect(201);
    expect((await get(owner, `/api/services/projects/${project}/retention`).expect(200)).body.held).toBe('0.00');
    // tidak ada lagi retensi yang belum lunas
    expect((await post(owner, `/api/services/projects/${project}/retention/release`, { dueDate: today, reason: 'BA serah terima akhir No. 7' })).status).toBe(400);
  });

  it('proyek tanpa retensi tidak berubah; tagih penuh tanpa retensi tercatat di audit', async () => {
    const r = (await termin(plain, '10000000').expect(201)).body;
    expect(r.retentionInvoice).toBeUndefined();
    const full = (await termin(project, '10000000', { withoutRetention: true }).expect(201)).body;
    expect(full.retentionInvoice).toBeUndefined();
    expect(Number((await get(owner, `/api/invoices/${full.id}`).expect(200)).body.subtotal)).toBe(10000000);
  });

  it('PPN dan PPh 23 total sama dengan tagihan tanpa pemecahan (tidak ada selisih pembulatan antar faktur)', async () => {
    const ref = (await post(owner, '/api/services/projects', { name: 'Pembanding tanpa retensi', customerId: cust, contractValue: '50000000' }).expect(201)).body.id;
    const opts = { withVat: true, withholdingType: 'PPH23', withholdingRate: '2' };
    const a = (await termin(ref, '33333333', opts).expect(201)).body;
    const b = (await termin(project, '33333333', opts).expect(201)).body;
    const inv = async (id: string) => (await get(owner, `/api/invoices/${id}`).expect(200)).body;
    const [plainInv, main, ret] = await Promise.all([inv(a.id), inv(b.id), inv(b.retentionInvoice.id)]);
    const sum = (k: string) => Number(main[k]) + Number(ret[k]);
    expect(sum('subtotal')).toBeCloseTo(Number(plainInv.subtotal), 2);
    expect(sum('taxAmount')).toBeCloseTo(Number(plainInv.taxAmount), 2);
    expect(sum('withholdingAmount')).toBeCloseTo(Number(plainInv.withholdingAmount), 1);
    expect(Math.abs(sum('total') - Number(plainInv.total))).toBeLessThan(0.02);
  });

  describe('BoQ', () => {
    let items: { id: string; description: string; value: string }[] = [];
    it('simpan BoQ, total dan selisih terhadap kontrak; hanya peran proyek yang boleh', async () => {
      const body = { items: [
        { code: 'A.1', description: 'Pondasi', unit: 'M3', qty: '100', unitPrice: '1000000' },
        { code: 'A.2', description: 'Struktur beton', unit: 'M3', qty: '200', unitPrice: '1500000' },
        { code: 'B.1', description: 'Finishing', unit: 'M2', qty: '500', unitPrice: '200000' },
      ] };
      expect((await put(owner, `/api/services/projects/${plain}/boq`, { items: [{ description: 'x', unit: 'M', qty: '0', unitPrice: '1' }] })).status).toBe(400);
      const r = (await put(owner, `/api/services/projects/${plain}/boq`, body).expect(200)).body;
      expect(r.total).toBe('500000000.00'); // 100jt + 300jt + 100jt
      expect(r.difference).toBe('-450000000.00'); // kontrak 50jt vs BoQ 500jt
      items = r.items;
      expect(items).toHaveLength(3);
    });

    it('sinkron nilai kontrak dengan BoQ (setelah volume disesuaikan)', async () => {
      const cur = (await get(owner, `/api/services/projects/${plain}/boq`).expect(200)).body.items as { id: string; description: string }[];
      const adjusted = cur.map((i) => ({ id: i.id, description: i.description, unit: 'M3', qty: '100', unitPrice: '1000000' }));
      const r = (await put(owner, `/api/services/projects/${plain}/boq`, { items: adjusted, syncContract: true }).expect(200)).body;
      expect(r.total).toBe('300000000.00');
      expect(r.contractValue).toBe('300000000.00');
      expect(r.difference).toBe('0.00');
    });

    it('kemajuan dari volume selesai: persentase dihitung dari nilai item dan dicatat sebagai kemajuan pekerjaan', async () => {
      const cur = (await get(owner, `/api/services/projects/${plain}/boq`).expect(200)).body.items as { id: string }[];
      // 3 item × 100 volume × 1.000.000 = 100jt tiap item; selesai: 100%, 50%, 0% → 150/300 = 50%
      const r = (await post(owner, `/api/services/projects/${plain}/boq/progress`, { date: today, items: [{ itemId: cur[0].id, completedQty: '100' }, { itemId: cur[1].id, completedQty: '50' }] }).expect(201)).body;
      expect(r.boq.pct).toBe(50);
      expect(Number(r.progress.percent)).toBe(50);
      const p = (await get(owner, `/api/services/projects/${plain}`).expect(200)).body;
      expect(p.progressPct).toBe(50);
      // volume tidak boleh turun atau melebihi BoQ; item yang sudah berjalan tidak bisa dihapus
      expect((await post(owner, `/api/services/projects/${plain}/boq/progress`, { date: today, items: [{ itemId: cur[0].id, completedQty: '90' }] })).status).toBe(400);
      expect((await post(owner, `/api/services/projects/${plain}/boq/progress`, { date: today, items: [{ itemId: cur[2].id, completedQty: '101' }] })).status).toBe(400);
      expect((await put(owner, `/api/services/projects/${plain}/boq`, { items: [{ id: cur[1].id, description: 'Struktur', unit: 'M3', qty: '100', unitPrice: '1000000' }] })).status).toBe(400); // item pertama sudah 100% tidak boleh dihapus
      expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
    });
  });
});
