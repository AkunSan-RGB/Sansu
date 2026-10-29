/**
 * Rekap pajak & BPJS (e2e): rekap PPh 23/4(2) per supplier (bahan e-Bupot), rekap BPJS per karyawan,
 * dan rekap tahunan semua pajak per masa dengan status ketepatan setor.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { txScope } from '../src/db/db-scope';
import { FiscalService } from '../src/modules/insights/fiscal.service';

describe('Rekap pajak & BPJS (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let accounts: { id: string; code: string }[];
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const post = (url: string, body: unknown = {}) =>
    http
      .post(url)
      .set(as())
      .send(body as object);
  const get = (url: string) => http.get(url).set(as());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({
          companyName: 'PT Rekap Pajak',
          name: 'Pemilik',
          email: `rekap-${stamp}@uji.id`,
          password: 'rahasia123',
        })
        .expect(201)
    ).body.accessToken;
    await http.put('/api/cash/settings').set({ Authorization: `Bearer ${token}` }).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    accounts = (await get('/api/accounting/accounts')).body;
  });
  afterAll(() => app.close());

  it('rekap PPh 23 & 4(2): DPP, tarif, potongan per supplier dan cocok dengan buku besar', async () => {
    const jasa = (
      await post('/api/suppliers', { code: 'SUP-JS', name: 'CV Jasa Teknik', npwp: '0123456789012345' }).expect(201)
    ).body.id;
    const sewa = (await post('/api/suppliers', { code: 'SUP-GD', name: 'Pak Budi (sewa gudang)' }).expect(201)).body.id;
    await post('/api/purchase-invoices/bills', {
      supplierId: jasa,
      supplierInvoiceNo: 'JT-01',
      date: '2026-02-10',
      withholdingType: 'PPH23',
      lines: [{ type: 'EXPENSE', description: 'Servis AC', accountId: acc('6-7000'), price: '2000000' }],
    }).expect(201);
    await post('/api/purchase-invoices/bills', {
      supplierId: sewa,
      supplierInvoiceNo: 'SW-01',
      date: '2026-02-01',
      withVat: false,
      withholdingType: 'PPH4_2',
      lines: [{ type: 'EXPENSE', description: 'Sewa gudang Februari', accountId: acc('6-7000'), price: '10000000' }],
    }).expect(201);
    const r = (await get('/api/tax/reports/withholding?period=2026-02').expect(200)).body;
    expect(r.rows).toHaveLength(2);
    const s23 = r.summary.find((x: { type: string }) => x.type === 'PPH23');
    const s42 = r.summary.find((x: { type: string }) => x.type === 'PPH4_2');
    expect(s23).toMatchObject({
      count: 1,
      base: '2000000.00',
      amount: '40000.00',
      ledger: '40000.00',
      unexplained: '0.00',
      dueDate: '2026-03-10', // PPh 23 disetor paling lambat tanggal 10 bulan berikutnya
      reportDue: '2026-03-20',
    });
    expect(s42).toMatchObject({ base: '10000000.00', amount: '1000000.00', unexplained: '0.00' });
    expect(r.rows.find((x: { type: string }) => x.type === 'PPH23')).toMatchObject({
      rate: '2.00',
      supplierNpwp: '0123456789012345',
    });
    expect(r.missingNpwp).toEqual(['Pak Budi (sewa gudang)']);
    expect((await get('/api/tax/reports/withholding?period=2026').expect(200)).body.rows).toHaveLength(2);
  });

  it('rekap tahunan: terutang per masa, setoran tepat/terlambat, masa mendatang', async () => {
    await post('/api/tax/payments', { type: 'PPH23', period: '2026-02', date: '2026-03-10', ntpn: 'NTPN23FEB' }).expect(
      201,
    );
    await post('/api/tax/payments', {
      type: 'PPH4_2',
      period: '2026-02',
      date: '2026-03-18',
      ntpn: 'NTPN42FEB',
    }).expect(201);
    const y = (await get('/api/tax/reports/annual?year=2026').expect(200)).body;
    const t = (k: string) => y.types.find((x: { type: string }) => x.type === k);
    expect(y.types.map((x: { type: string }) => x.type)).toEqual(['PPN', 'PPH21', 'PPH23', 'PPH4_2', 'PPH25', 'BPJS']);
    expect(t('PPH23').months).toHaveLength(12);
    expect(t('PPH23').months[1]).toMatchObject({
      payable: '40000.00',
      paid: '40000.00',
      diff: '0.00',
      status: 'TEPAT',
      ntpn: 'NTPN23FEB',
      paidDate: '2026-03-10',
    });
    expect(t('PPH4_2').months[1]).toMatchObject({ status: 'TERLAMBAT', dueDate: '2026-03-10' }); // dibayar tanggal 18, lewat tanggal 10
    expect(t('PPH23').months[0].status).toBe('NIHIL');
    expect(t('PPH23').total).toMatchObject({ payable: '40000.00', paid: '40000.00' });
    // PPN masukan Februari (jasa 2 jt × 11%) → lebih bayar, dikompensasikan ke masa berikutnya
    expect(t('PPN').months[1]).toMatchObject({ status: 'LEBIH_BAYAR', detail: { masukan: '220000.00' } });
    // masa yang hanya punya PPN masukan: tidak ada yang disetor atau dikompensasikan; pesannya harus jelas, bukan error jurnal
    const noOut = await post('/api/tax/payments', { type: 'PPN', period: '2026-02', date: '2026-03-20' }).expect(400);
    expect(noOut.body.message).toMatch(/tidak punya PPN keluaran/);
    expect(noOut.body.message).toMatch(/dibawa ke masa berikutnya/);
    expect(noOut.body.message).not.toMatch(/Jurnal minimal/);
    expect(t('PPN').months[2].detail.kompensasi).toBe('220000.00');
    expect(t('PPN').months[11].status).toBe('BELUM_MASA');
    expect(y.corporate).toHaveProperty('pkp');
  });

  it('rekap BPJS per karyawan: per program, perusahaan & karyawan, jatuh tempo', async () => {
    await post('/api/apps/payroll/install').expect(201);
    await post('/api/hr/employees', {
      code: 'emp-01',
      name: 'Siti',
      ptkp: 'TK/0',
      joinDate: '2026-09-01',
      baseSalary: '8000000',
      fixedAllowance: '1000000',
    }).expect(201);
    const run = (await post('/api/payroll/runs', { period: '2026-09' }).expect(201)).body;
    await post(`/api/payroll/runs/${run.id}/post`).expect(201);
    const r = (await get('/api/payroll/reports/bpjs?period=2026-09').expect(200)).body;
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(Number(row.wage)).toBe(9_000_000);
    // Kesehatan 4% + 1% dari 9 jt; JHT 3,7% + 2%; JKM 0,3%
    expect(Number(row.kesCompany)).toBe(360_000);
    expect(Number(row.kesEmployee)).toBe(90_000);
    expect(Number(row.jhtCompany)).toBe(333_000);
    expect(Number(row.jhtEmployee)).toBe(180_000);
    expect(Number(row.jkmCompany)).toBe(27_000);
    expect(Number(r.kesehatan)).toBe(450_000);
    expect(Number(r.total)).toBe(Number(r.kesehatan) + Number(r.ketenagakerjaan));
    expect(r).toMatchObject({ dueKesehatan: '2026-10-10', dueKetenagakerjaan: '2026-10-15' });
    expect(r.changes).toEqual([expect.objectContaining({ kind: 'MASUK', date: '2026-09-01' })]);
    // nilai rekap = utang BPJS yang dijurnal saat gaji diposting
    const y = (await get('/api/tax/reports/annual?year=2026').expect(200)).body;
    const bpjs = y.types.find((x: { type: string }) => x.type === 'BPJS').months[8];
    expect(Number(bpjs.payable)).toBe(Number(r.total));
  });

  it('setoran pajak: angsuran PPh 25 (rekonsiliasi fiskal) dihitung di luar transaksi, bukan koneksi kedua di dalamnya', async () => {
    // Di mode tes koneksi kedua di dalam transaksi melempar galat yang tertelan try/catch angsuran, jadi periksa lewat lingkup transaksi saat reconcile dipanggil
    const fiscal = app.get(FiscalService);
    const original = fiscal.reconcile.bind(fiscal);
    const inTx: boolean[] = [];
    const spy = jest.spyOn(fiscal, 'reconcile').mockImplementation((...a: Parameters<FiscalService['reconcile']>) => {
      inTx.push(!!txScope.getStore()?.inTx);
      return original(...a);
    });
    try {
      for (const type of ['PPH21', 'PPH23', 'BPJS', 'PPH25']) {
        const r = await post('/api/tax/payments', { type, period: '2026-03', date: '2026-04-10' }); // tak ada terutang → 400, tetapi kewajiban sudah dihitung
        expect([201, 400]).toContain(r.status);
      }
      expect(inTx.length).toBeGreaterThanOrEqual(4);
      expect(inTx.every((x) => x === false)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
