/**
 * Platform modular + aplikasi baru (e2e, PostgreSQL sungguhan):
 * aktif/nonaktif aplikasi · pengguna & peran · Kasir (POS) · CRM & penawaran · SDM & penggajian.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Platform & aplikasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let customerId: string;
  let accounts: { id: string; code: string; systemKey: string | null }[];
  const stamp = Date.now();

  const as = (t: string) => ({
    get: (url: string) => http.get(url).set({ Authorization: `Bearer ${t}` }),
    post: (url: string, body: object = {}) => http.post(url).set({ Authorization: `Bearer ${t}` }).send(body),
    patch: (url: string, body: object = {}) => http.patch(url).set({ Authorization: `Bearer ${t}` }).send(body),
  });
  const get = (url: string) => as(token).get(url);
  const post = (url: string, body: object = {}) => as(token).post(url, body);
  const patch = (url: string, body: object = {}) => as(token).patch(url, body);
  const balance = async (code: string) => {
    const tb = await get('/api/accounting/reports/trial-balance').expect(200);
    const r = tb.body.rows.find((x: { code: string }) => x.code === code);
    return Number(r?.debit ?? 0) - Number(r?.credit ?? 0);
  };
  const expectBalanced = async () => {
    expect((await get('/api/accounting/reports/trial-balance')).body.balanced).toBe(true);
    expect((await get('/api/accounting/reports/balance-sheet')).body.balanced).toBe(true);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Serba Aplikasi', name: 'Pemilik', email: `apps-${stamp}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;
    await http.put('/api/cash/settings').set({ Authorization: `Bearer ${token}` }).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    warehouseId = (await get('/api/warehouses')).body[0].id;
    accounts = (await get('/api/accounting/accounts')).body;
    productId = (await post('/api/products', { sku: 'POS-01', name: 'Kopi Botol', sellPrice: '10000', barcode: "5901234123457" }).expect(201)).body.id;
    customerId = (await post('/api/customers', { code: 'TK-01', name: 'Toko Satu' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId, reason: 'OPENING', lines: [{ productId, qty: '100', unitCost: '7000' }] }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- Platform ----------
  describe('Aplikasi', () => {
    it('perusahaan baru: aplikasi bawaan aktif, POS/CRM/SDM belum', async () => {
      const me = await get('/api/auth/me').expect(200);
      expect(me.body.apps).toEqual(expect.arrayContaining(['sales', 'purchase', 'inventory', 'accounting', 'cash']));
      expect(me.body.apps).not.toContain('pos');
      const res = await get('/api/pos/sessions/current').expect(403);
      expect(res.body.message).toMatch(/belum diaktifkan/);
    });

    it('aktifkan Penggajian ikut mengaktifkan Karyawan', async () => {
      const r = await post('/api/apps/payroll/install').expect(201);
      expect(r.body.installed).toEqual(expect.arrayContaining(['payroll', 'hr', 'accounting']));
      await post('/api/apps/pos/install').expect(201);
      await post('/api/apps/crm/install').expect(201);
    });

    it('tidak bisa menonaktifkan aplikasi inti / yang dibutuhkan aplikasi lain', async () => {
      expect((await post('/api/apps/accounting/uninstall').expect(400)).body.message).toMatch(/inti/);
      expect((await post('/api/apps/hr/uninstall').expect(400)).body.message).toMatch(/Penggajian/);
      expect((await post('/api/apps/inventory/uninstall').expect(400)).body.message).toMatch(/Penjualan|Kasir|Pembelian/);
      await post('/api/apps/nope/install').expect(400);
    });
  });

  // ---------- Pengguna ----------
  let cashierToken: string;
  let cashierId: string;
  describe('Pengguna & peran', () => {
    it('buat kasir, login, akses dibatasi peran', async () => {
      const u = await post('/api/users', { name: 'Kasir Satu', email: `kasir-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
      cashierId = u.body.id;
      cashierToken = (await http.post('/api/auth/login').send({ email: `kasir-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
      await as(cashierToken).get('/api/pos/products').expect(200);
      await as(cashierToken).get('/api/accounting/reports/trial-balance').expect(403);
      await as(cashierToken).patch(`/api/users/${cashierId}`, { role: 'ADMIN' }).expect(403);
    });

    it('pemilik tidak bisa menonaktifkan diri sendiri; kasir bisa dinonaktifkan', async () => {
      const me = await get('/api/auth/me');
      await patch(`/api/users/${me.body.id}`, { isActive: false }).expect(400);
      await patch(`/api/users/${cashierId}`, { isActive: false }).expect(200);
      await http.post('/api/auth/login').send({ email: `kasir-${stamp}@uji.id`, password: 'kasir12345' }).expect(401);
      await patch(`/api/users/${cashierId}`, { isActive: true }).expect(200);
      // sesi lama dicabut saat dinonaktifkan — harus masuk ulang
      await as(cashierToken).get('/api/pos/products').expect(401);
      cashierToken = (await http.post('/api/auth/login').send({ email: `kasir-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
    });
  });

  // ---------- POS ----------
  describe('Kasir (POS)', () => {
    let sessionId: string;
    it('buka sesi kasir; tidak boleh dua sesi terbuka', async () => {
      const s = await as(cashierToken).post('/api/pos/sessions', { warehouseId, openingCash: '200000' }).expect(201);
      sessionId = s.body.id;
      expect(s.body.number).toMatch(/^KSR\//);
      await as(cashierToken).post('/api/pos/sessions', { warehouseId, openingCash: '0' }).expect(400);
      const cur = await as(cashierToken).get('/api/pos/sessions/current').expect(200);
      expect(cur.body.id).toBe(sessionId);
    });

    it('cari produk lewat barcode beserta stok', async () => {
      const r = await as(cashierToken).get(`/api/pos/products?q=5901234123457&warehouseId=${warehouseId}`).expect(200);
      expect(r.body).toHaveLength(1);
      expect(Number(r.body[0].stock)).toBe(100);
    });

    it('jual tunai dengan kembalian, lalu QRIS', async () => {
      const o = await as(cashierToken)
        .post('/api/pos/orders', { sessionId, lines: [{ productId, qty: '3' }], payments: [{ method: 'CASH', amount: '50000' }] })
        .expect(201);
      expect(o.body.total).toBe('33300.00');
      expect(o.body.change).toBe('16700.00');
      expect(o.body.payments.map((x: { method: string; amount: string }) => [x.method, Number(x.amount)])).toEqual([['CASH', 33300]]);

      await as(cashierToken)
        .post('/api/pos/orders', { sessionId, lines: [{ productId, qty: '1' }], payments: [{ method: 'CASH', amount: '1000' }] })
        .expect(400); // kurang bayar
      await as(cashierToken)
        .post('/api/pos/orders', { sessionId, lines: [{ productId, qty: '1' }], payments: [{ method: 'QRIS', amount: '99999' }] })
        .expect(400); // non-tunai lebih
      await as(cashierToken)
        .post('/api/pos/orders', { sessionId, lines: [{ productId, qty: '2' }], payments: [{ method: 'QRIS', amount: '22200' }] })
        .expect(201);
      const stock = await get(`/api/inventory/balances?productId=${productId}`);
      expect(Number(stock.body[0].qty)).toBe(95);
      await expectBalanced();
    });

    it('tutup kasir: selisih kurang Rp300 dijurnal ke Selisih Kas', async () => {
      const kasBefore = await balance('1-1100');
      const c = await as(cashierToken).post(`/api/pos/sessions/${sessionId}/close`, { countedCash: '233000' }).expect(201);
      expect(c.body.summary.expectedCash).toBe('233300.00');
      expect(c.body.summary.byMethod.QRIS).toBe('22200.00');
      expect(c.body.difference).toBe('-300.00');
      expect(c.body.journalNumber).toBeTruthy();
      expect(await balance('1-1100')).toBe(kasBefore - 300);
      expect(await balance('6-9100')).toBe(300);
      expect(await balance('1-1200')).toBe(22200);
      await as(cashierToken).post('/api/pos/orders', { sessionId, lines: [{ productId, qty: '1' }], payments: [{ method: 'CASH', amount: '20000' }] }).expect(400);
      await expectBalanced();
    });
  });

  // ---------- CRM ----------
  describe('CRM & penawaran', () => {
    let leadId: string;
    let quotationId: string;
    it('pipeline otomatis punya 4 tahap; buat prospek & aktivitas', async () => {
      const p = await get('/api/crm/pipeline').expect(200);
      expect(p.body.stages).toHaveLength(4);
      const l = await post('/api/crm/leads', { title: 'Toko Makmur pasok bulanan', contactName: 'Pak Budi', phone: '0812', expectedRevenue: '15000000' }).expect(201);
      leadId = l.body.id;
      expect(l.body.probability).toBe(10);
      await patch(`/api/crm/leads/${leadId}`, { stageId: p.body.stages[2].id }).expect(200);
      expect((await get(`/api/crm/leads/${leadId}`)).body.probability).toBe(50);
      const a = await post('/api/crm/activities', { leadId, type: 'CALL', summary: 'Tanya kebutuhan', dueDate: '2026-01-01' }).expect(201);
      expect((await get('/api/crm/agenda')).body.map((x: { id: string }) => x.id)).toContain(a.body.id);
      await post(`/api/crm/activities/${a.body.id}/done`, { result: 'Minta penawaran' }).expect(201);
      const s = await get('/api/crm/summary').expect(200);
      expect(s.body.stages[2]).toMatchObject({ count: 1, value: '15000000.00', weighted: '7500000.00' });
    });

    it('kalah wajib alasan', async () => {
      const l = await post('/api/crm/leads', { title: 'Prospek gagal' }).expect(201);
      await post(`/api/crm/leads/${l.body.id}/mark`, { status: 'LOST' }).expect(400);
      await post(`/api/crm/leads/${l.body.id}/mark`, { status: 'LOST', lostReason: 'Harga kompetitor lebih murah' }).expect(201);
    });

    it('penawaran → kirim → jadi Sales Order dengan harga sama; prospek menang', async () => {
      const q = await post('/api/crm/quotations', {
        customerId,
        warehouseId,
        leadId,
        validDays: 7,
        lines: [{ productId, qty: '10', price: '9500', discountPct: '5' }],
      }).expect(201);
      quotationId = q.body.id;
      expect(q.body.number).toMatch(/^SQ\//);
      expect(q.body.subtotal).toBe('90250.00');
      await post(`/api/crm/quotations/${quotationId}/send`).expect(201);
      const c = await post(`/api/crm/quotations/${quotationId}/convert`).expect(201);
      expect(c.body.quotation.status).toBe('ACCEPTED');
      expect(c.body.salesOrder.status).toBe('DRAFT');
      expect(c.body.salesOrder.total).toBe(q.body.total);
      await post(`/api/crm/quotations/${quotationId}/convert`).expect(400);
      expect((await get(`/api/crm/leads/${leadId}`)).body.status).toBe('WON');
    });
  });

  // ---------- SDM & penggajian ----------
  describe('SDM & penggajian', () => {
    let empId: string;
    let runId: string;
    it('karyawan, absensi pengecualian, cuti tahunan', async () => {
      const e = await post('/api/hr/employees', {
        code: 'emp-001',
        name: 'Siti Rahma',
        ptkp: 'TK/0',
        joinDate: '2025-01-02',
        baseSalary: '8000000',
        fixedAllowance: '1000000',
        dailyAllowance: '50000',
      }).expect(201);
      empId = e.body.id;
      expect(e.body.code).toBe('EMP-001');
      await post('/api/hr/attendance', { date: '2026-10-05', rows: [{ employeeId: empId, status: 'ALPA' }] }).expect(201);
      await post('/api/hr/attendance', { date: '2026-10-06', rows: [{ employeeId: empId, status: 'HADIR', checkIn: '08:00', checkOut: '19:00', overtimeHours: '2' }] }).expect(201);
      const lv = await post('/api/hr/leaves', { employeeId: empId, type: 'ANNUAL', startDate: '2026-10-07', endDate: '2026-10-08' }).expect(201);
      expect(lv.body.days).toBe(2);
      await post('/api/hr/leaves', { employeeId: empId, type: 'ANNUAL', startDate: '2026-10-08', endDate: '2026-10-09' }).expect(400); // tumpang tindih
      await post(`/api/hr/leaves/${lv.body.id}/decide`, { decision: 'APPROVED' }).expect(201);
      const day = await get('/api/hr/attendance?date=2026-10-07').expect(200);
      expect(day.body.rows[0].record.status).toBe('CUTI');
      const month = await get('/api/hr/attendance/month?period=2026-10').expect(200);
      expect(month.body.workDays).toBe(27);
      expect(month.body.rows[0].counts).toMatchObject({ ALPA: 1, CUTI: 2, HADIR: 1 });
    });

    it('slip gaji Oktober 2026: BPJS, lembur, potongan alpa, PPh 21 TER', async () => {
      const r = await post('/api/payroll/runs', { period: '2026-10' }).expect(201);
      runId = r.body.id;
      expect(r.body.number).toMatch(/^GJ\//);
      await post('/api/payroll/runs', { period: '2026-10' }).expect(400);
      const raw = r.body.payslips[0];
      // relasi bertingkat Drizzle mengembalikan NUMERIC tanpa skala → bandingkan sebagai angka
      const p = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
      expect(p).toMatchObject({
        workDays: 27,
        presentDays: 24,
        absentDays: 1,
        dailyAllowance: 1200000,
        absenceDeduction: 296296.3,
        overtimePay: 182080.92,
        grossPay: 10085784.62,
        bpjsKesEmployee: 90000,
        jhtEmployee: 180000,
        jpEmployee: 90000,
        taxableGross: 10494384.62,
        terCategory: 'A',
        pph21: 262359,
        netPay: 9463425.62,
      });
      expect(Number(p.terRate)).toBe(2.5);
    });

    it('bonus & kasbon di draft, posting jurnal, bayar gaji', async () => {
      const slipId = (await get(`/api/payroll/runs/${runId}`)).body.payslips[0].id;
      const u = await patch(`/api/payroll/payslips/${slipId}`, { otherIncome: '500000', otherDeduction: '100000' }).expect(200);
      const slip = u.body.payslips[0];
      expect(Number(slip.grossPay)).toBe(10585784.62);
      await post(`/api/payroll/runs/${runId}/pay`).expect(400); // belum diposting
      const posted = await post(`/api/payroll/runs/${runId}/post`).expect(201);
      expect(posted.body.status).toBe('POSTED');
      await patch(`/api/payroll/payslips/${slipId}`, { otherIncome: '0' }).expect(400);
      expect(await balance('6-1000')).toBe(Number(slip.grossPay));
      expect(-(await balance('2-1400'))).toBe(Number(slip.netPay));
      expect(-(await balance('2-1310'))).toBe(Number(slip.pph21));
      expect(await balance('1-1600')).toBe(-100000);
      await expectBalanced();

      const bankBefore = await balance('1-1200');
      const paid = await post(`/api/payroll/runs/${runId}/pay`, { date: '2026-10-31' }).expect(201);
      expect(paid.body.status).toBe('PAID');
      expect(await balance('2-1400')).toBe(0);
      expect(await balance('1-1200')).toBeCloseTo(bankBefore - Number(slip.netPay), 2);
      await expectBalanced();

      const rep = await get('/api/payroll/reports/pph21?year=2026').expect(200);
      expect(rep.body.employees[0]).toMatchObject({ code: 'EMP-001', months: 1 });
      expect(Number(rep.body.employees[0].pph21)).toBe(Number(slip.pph21));
      // filter per bulan: masa yang ada penggajiannya sama dengan setahun, masa lain kosong; bulan tak sah ditolak
      const [py, pm] = (rep.body.monthly[0].period as string).split('-').map(Number);
      const same = await get(`/api/payroll/reports/pph21?year=${py}&month=${pm}`).expect(200);
      expect(same.body).toMatchObject({ month: pm });
      expect(same.body.employees[0]).toMatchObject({ code: 'EMP-001', months: 1 });
      expect(same.body.monthly.map((m: { period: string }) => m.period)).toEqual([rep.body.monthly[0].period]);
      const other = await get(`/api/payroll/reports/pph21?year=${py}&month=${pm === 1 ? 2 : pm - 1}`).expect(200);
      expect(other.body.employees).toEqual([]);
      expect(other.body.monthly).toEqual([]);
      for (const bad of ['0', '13', 'x', '1.5']) await get(`/api/payroll/reports/pph21?year=${py}&month=${bad}`).expect(400);
      const ps = await get(`/api/payroll/payslips/${slipId}`).expect(200);
      expect(ps.body.company.name).toBe('PT Serba Aplikasi');
    });

    it('akun sistem penggajian memakai kode bagan akun standar', () => {
      const codes = accounts.filter((a) => a.systemKey).map((a) => a.code);
      expect(codes).toEqual(expect.arrayContaining(['1-1600', '2-1310', '2-1400', '2-1500', '6-1000', '6-1100', '6-9100']));
    });
  });
});
