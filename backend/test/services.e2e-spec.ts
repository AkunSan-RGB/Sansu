/**
 * Usaha jasa (e2e): proyek & termin, uang muka pelanggan ber-PPN, faktur jasa dengan PPh 4(2) final dan PPh 23
 * yang dipotong pelanggan, bukti potong, rekonsiliasi fiskal, dan e-Faktur Coretax (jasa = Opt B).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Usaha jasa: termin, uang muka, PPh dipotong pelanggan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let customerId: string;
  let projectId: string;
  let depositId: string;
  let termInvoiceId: string;
  let pph23InvoiceId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({
          companyName: 'CV Kontraktor Jaya',
          name: 'Pemilik',
          email: `jasa-${stamp}@uji.id`,
          password: 'rahasia123',
          businessModel: 'JASA',
        })
        .expect(201)
    ).body.accessToken;
    await http.patch('/api/settings/company').set(as()).send({ npwp: '0123456789012345' }).expect(200);
    await http.put('/api/cash/settings').set(as()).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    customerId = (
      await post('/api/customers', {
        code: 'PT-MAJU',
        name: 'PT Maju Bersama',
        npwp: '0987654321098765',
        paymentTermDays: 30,
      }).expect(201)
    ).body.id;
  });
  afterAll(() => app.close());

  it('proyek: nilai kontrak & nomor otomatis', async () => {
    const p = (
      await post('/api/services/projects', {
        name: 'Renovasi gudang',
        customerId,
        contractValue: '100000000',
        startDate: '2026-10-01',
      }).expect(201)
    ).body;
    projectId = p.id;
    expect(p.code).toMatch(/^PRJ\//);
    expect(p).toMatchObject({ contractValue: '100000000.00', billed: '0.00', billedPct: 0, status: 'ACTIVE' });
  });

  it('uang muka ber-PPN: utang ke pelanggan (DPP) + PPN keluaran terutang saat diterima', async () => {
    const d = (
      await post('/api/services/deposits', {
        customerId,
        projectId,
        date: '2026-10-02',
        amount: '33300000',
        description: 'DP 30%',
      }).expect(201)
    ).body;
    depositId = d.id;
    expect(d).toMatchObject({ dpp: '30000000.00', taxAmount: '3300000.00' });
    expect(d.number).toMatch(/^UMP\//);
    expect(await bal('2-1700')).toBe(30000000);
    expect(await bal('2-1200')).toBe(3300000);
  });

  it('faktur termin jasa konstruksi: PPh 4(2) final dipotong pelanggan, pendapatan 4-2100', async () => {
    await post('/api/services/invoices', {
      customerId,
      projectId,
      date: '2026-10-20',
      withholdingType: 'PPH4_2',
      withholdingRate: '2.65',
      lines: [{ description: 'Termin 1 — 100%', price: '101000000' }],
    }).expect(400); // melebihi nilai kontrak
    const r = (
      await post('/api/services/invoices', {
        customerId,
        projectId,
        date: '2026-10-20',
        termLabel: 'Termin 1 (40%)',
        withholdingType: 'PPH4_2',
        withholdingRate: '2.65',
        lines: [{ description: 'Pekerjaan struktur 40%', price: '40000000' }],
      }).expect(201)
    ).body;
    termInvoiceId = r.id;
    expect(r.number).toMatch(/^INV\//);
    const inv = (await get(`/api/invoices/${r.id}`).expect(200)).body;
    expect(inv).toMatchObject({
      kind: 'SERVICE',
      subtotal: '40000000.00',
      taxAmount: '4400000.00',
      total: '44400000.00',
      withholdingType: 'PPH4_2',
      withholdingAmount: '1060000.00',
      paidAmount: '1060000.00',
      status: 'UNPAID',
      termLabel: 'Termin 1 (40%)',
    });
    expect(inv.serviceLines).toHaveLength(1);
    expect(inv.serviceLines[0].account.code).toBe('4-2100');
    expect(inv.project.id).toBe(projectId);
    expect(await bal('4-2100')).toBe(40000000);
    expect(await bal('9-1300')).toBe(1060000);
    expect(await bal('1-1300')).toBe(43340000);

    const p = (await get(`/api/services/projects/${projectId}`).expect(200)).body;
    expect(p).toMatchObject({ billed: '40000000.00', billedPct: 40 });
    expect(p.invoices).toHaveLength(1);
    // retur tidak berlaku untuk faktur jasa
    await post('/api/sales-returns', { invoiceId: r.id, lines: [] }).expect(400);
  });

  it('pakai uang muka: utang ke pelanggan & PPN uang muka hilang, piutang berkurang', async () => {
    const a = (
      await post(`/api/services/deposits/${depositId}/apply`, { invoiceId: termInvoiceId, date: '2026-10-21' }).expect(
        201,
      )
    ).body;
    expect(a.amount).toBe('33300000.00');
    expect(await bal('2-1700')).toBe(0);
    expect(await bal('2-1200')).toBe(4400000); // PPN keluaran = PPN atas DPP termin, tidak dobel
    const inv = (await get(`/api/invoices/${termInvoiceId}`).expect(200)).body;
    expect(inv).toMatchObject({ depositApplied: '33300000.00', paidAmount: '34360000.00', status: 'PARTIAL' });
    await post(`/api/services/deposits/${depositId}/apply`, { invoiceId: termInvoiceId }).expect(400); // sudah habis
    await post('/api/payments', {
      invoiceId: termInvoiceId,
      amount: '10040000',
      method: 'TRANSFER',
      date: '2026-10-25',
    }).expect(201);
    expect((await get(`/api/invoices/${termInvoiceId}`).expect(200)).body.status).toBe('PAID');
    const deps = (await get('/api/services/deposits').expect(200)).body;
    expect(deps[0]).toMatchObject({ remaining: '0.00', appliedAmount: '33300000.00' });
    expect(deps[0].applications).toHaveLength(1);
  });

  it('PPh 23 dipotong pelanggan → Pajak Dibayar Dimuka, rekap & bukti potong', async () => {
    const r = (
      await post('/api/services/invoices', {
        customerId,
        date: '2026-10-22',
        withholdingType: 'PPH23',
        lines: [{ description: 'Jasa konsultasi teknik', qty: '2', unit: 'Hari', price: '5000000' }],
      }).expect(201)
    ).body;
    pph23InvoiceId = r.id;
    const inv = (await get(`/api/invoices/${r.id}`).expect(200)).body;
    expect(inv).toMatchObject({ subtotal: '10000000.00', withholdingAmount: '200000.00', withholdingRate: '2.00' });
    expect(inv.serviceLines[0].account.code).toBe('4-2000');
    expect(await bal('1-1510')).toBe(200000);

    const rep = (await get('/api/services/withheld?period=2026-10').expect(200)).body;
    expect(rep.rows).toHaveLength(2);
    expect(rep.totals.find((t: { type: string }) => t.type === 'PPH23')).toMatchObject({
      amount: '200000.00',
      missingSlips: 1,
    });
    await http
      .put(`/api/services/invoices/${pph23InvoiceId}/withholding-slip`)
      .set(as())
      .send({ slipNo: 'BP-2026-0001', slipDate: '2026-11-05' })
      .expect(200);
    const rep2 = (await get('/api/services/withheld?period=2026').expect(200)).body;
    expect(rep2.totals.find((t: { type: string }) => t.type === 'PPH23').missingSlips).toBe(0);
    expect(rep2.rows.find((x: { invoiceId: string }) => x.invoiceId === pph23InvoiceId).slipNo).toBe('BP-2026-0001');
  });

  it('cek kesehatan, rekonsiliasi fiskal, dan Coretax (jasa = Opt B)', async () => {
    const health = (await get('/api/accounting/health?asOf=2026-12-31').expect(200)).body.checks as { key: string; status: string }[];
    expect(health.find((c) => c.key === 'customer-deposits')?.status).toBe('OK');
    expect(health.find((c) => c.key === 'ar')?.status).toBe('OK');

    const f = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    const fin = f.negative.find((i: { label: string }) => i.label.startsWith('4-2100'));
    expect(Number(fin.amount)).toBe(40000000); // pendapatan PPh final dikeluarkan dari PPh tarif umum
    expect(Number(f.credits)).toBe(200000); // PPh 23 dipotong pelanggan = kredit pajak

    const xml = (await get('/api/integrations/coretax/faktur-keluaran.xml?from=2026-10-01&to=2026-10-31').expect(200))
      .text;
    expect(xml).toContain('<Opt>B</Opt>');
    expect(xml).toContain('Pekerjaan struktur 40%');
    // faktur pajak uang muka ikut diekspor; faktur pelunasan DPP-nya dikurangi DPP uang muka (40 jt − 30 jt)
    expect(xml).toContain('(uang muka)</RefDesc>');
    expect(xml).toContain('<TaxBase>10000000.00</TaxBase>');
    expect(xml).toContain('<TotalDiscount>30000000.00</TotalDiscount>');
    const pre = (await get('/api/integrations/coretax/preview?from=2026-10-01&to=2026-10-31').expect(200)).body;
    expect(pre.invoices.find((x: { kind: string }) => x.kind === 'DEPOSIT')).toMatchObject({
      subtotal: '30000000.00',
      taxAmount: '3300000.00',
    });
    expect(pre.invoices.find((x: { id: string }) => x.id === termInvoiceId)).toMatchObject({
      depositDpp: '30000000.00',
      subtotal: '10000000.00',
      taxAmount: '1100000.00',
    });
  });

  it('peringatan Coretax: uang muka ber-PPN belum dipakai pada faktur pelanggan yang sama', async () => {
    const c2 = (await post('/api/customers', { code: 'PT-B', name: 'PT Bangun', npwp: '0111222233334444' }).expect(201))
      .body.id;
    await post('/api/services/deposits', { customerId: c2, date: '2026-10-03', amount: '11100000' }).expect(201);
    await post('/api/services/invoices', {
      customerId: c2,
      date: '2026-10-28',
      lines: [{ description: 'Desain', price: '20000000' }],
    }).expect(201);
    const pre = (await get('/api/integrations/coretax/preview?from=2026-10-01&to=2026-10-31').expect(200)).body;
    expect(pre.warnings.join(' ')).toMatch(/uang muka ber-PPN yang belum dipakai/);
    expect(pre.problems.join(' ')).not.toMatch(/uang muka/); // hanya peringatan, tidak menghalangi ekspor
  });

  it('kemajuan pekerjaan: pendapatan belum ditagih / diterima dimuka (SAK EP 23)', async () => {
    const rev0 = await bal('4-2100');
    const r1 = (
      await post(`/api/services/projects/${projectId}/progress`, {
        date: '2026-10-31',
        percent: '55',
        notes: 'BA-03',
      }).expect(201)
    ).body;
    expect(r1).toMatchObject({
      earned: '55000000.00',
      billed: '40000000.00',
      accrualAfter: '15000000.00',
      adjustment: '15000000.00',
    });
    expect(r1.number).toMatch(/^KPK\//);
    expect(await bal('1-1360')).toBe(15000000);
    expect((await bal('4-2100')) - rev0).toBe(15000000);
    await post(`/api/services/projects/${projectId}/progress`, { date: '2026-10-30', percent: '56' }).expect(400);

    // termin 2 ditagih 30 jt sebelum pekerjaan mencapai 70%
    await post('/api/services/invoices', {
      customerId,
      projectId,
      date: '2026-11-15',
      termLabel: 'Termin 2 (30%)',
      withholdingType: 'PPH4_2',
      withholdingRate: '2.65',
      lines: [{ description: 'Termin 2', price: '30000000' }],
    }).expect(201);
    const r2 = (
      await post(`/api/services/projects/${projectId}/progress`, { date: '2026-11-30', percent: '60' }).expect(201)
    ).body;
    expect(r2).toMatchObject({
      billed: '70000000.00',
      accrualBefore: '15000000.00',
      accrualAfter: '-10000000.00',
      adjustment: '-25000000.00',
    });
    expect(await bal('1-1360')).toBe(0);
    expect(await bal('2-1750')).toBe(10000000);
    // pendapatan diakui = 60% × 100 jt
    expect(await bal('4-2100')).toBe(60000000);
    const p = (await get(`/api/services/projects/${projectId}`).expect(200)).body;
    expect(p).toMatchObject({ progressPct: 60, accrual: '-10000000.00' });
    expect(p.progress).toHaveLength(2);
  });

  it('biaya untuk penghasilan PPh final: langsung proyek + bersama proporsional, bisa diganti manual', async () => {
    const accounts = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const exp = accounts.find((a) => a.code === '6-7000')!.id;
    const sup = (await post('/api/suppliers', { code: 'SUB-1', name: 'CV Subkon' }).expect(201)).body.id;
    await post('/api/purchase-invoices/bills', {
      supplierId: sup,
      supplierInvoiceNo: 'SK-01',
      date: '2026-10-25',
      projectId,
      lines: [{ type: 'EXPENSE', description: 'Subkon pembesian', accountId: exp, price: '5000000' }],
    }).expect(201);
    await post('/api/purchase-invoices/bills', {
      supplierId: sup,
      supplierInvoiceNo: 'SK-02',
      date: '2026-10-26',
      lines: [{ type: 'EXPENSE', description: 'Biaya kantor', accountId: exp, price: '2000000' }],
    }).expect(201);
    expect((await get(`/api/services/projects/${projectId}`).expect(200)).body.directCost).toBe('5000000.00');

    const f = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    const fr = Number(f.finalCost.finalRevenue);
    const tr = Number(f.finalCost.totalRevenue);
    expect(fr).toBe(60000000);
    expect(Number(f.finalCost.direct)).toBe(5000000);
    expect(Number(f.finalCost.common)).toBe(2000000);
    const expected = 5000000 + (2000000 * fr) / tr;
    expect(Number(f.finalCost.auto)).toBeCloseTo(expected, 0);
    const item = f.positive.find((i: { source: string }) => i.source === 'FINAL_COST');
    expect(Number(item.amount)).toBeCloseTo(expected, 0);

    await http.put('/api/accounting/fiscal/2026').set(as()).send({ finalCostOverride: '1000000' }).expect(200);
    const f2 = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    expect(f2.positive.find((i: { source: string }) => i.source === 'FINAL_COST').amount).toBe('1000000.00');
    await http.put('/api/accounting/fiscal/2026').set(as()).send({ finalCostOverride: null }).expect(200);
    expect((await get('/api/accounting/fiscal/2026').expect(200)).body.finalCost.override).toBeNull();
  });

  it('biaya langsung proyek dari kas keluar & gaji karyawan yang ditempatkan di proyek', async () => {
    const accounts = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const exp = accounts.find((a) => a.code === '6-7000')!.id;
    const kas = accounts.find((a) => a.code === '1-1100')!.id;
    await post('/api/cash/transactions', {
      type: 'OUT',
      cashAccountId: kas,
      date: '2026-10-27',
      description: 'Sewa scaffolding',
      lines: [{ accountId: exp, amount: '1000000', projectId }],
    }).expect(201);
    // proyek hanya untuk kas keluar
    await post('/api/cash/transactions', {
      type: 'IN',
      cashAccountId: kas,
      date: '2026-10-27',
      description: 'x',
      lines: [{ accountId: accounts.find((a) => a.code === '4-9000')!.id, amount: '1000', projectId }],
    }).expect(400);

    await post('/api/apps/payroll/install').expect(201);
    const emp = (
      await post('/api/hr/employees', {
        code: 'TK-01',
        name: 'Mandor Budi',
        ptkp: 'TK/0',
        joinDate: '2026-10-01',
        baseSalary: '6000000',
        projectId,
      }).expect(201)
    ).body;
    expect(emp.projectId).toBe(projectId);
    const run = (await post('/api/payroll/runs', { period: '2026-10' }).expect(201)).body;
    await post(`/api/payroll/runs/${run.id}/post`).expect(201);
    const posted = (await get(`/api/payroll/runs/${run.id}`).expect(200)).body;
    const payroll = Number(posted.totalEmployerCost); // gaji bruto + iuran BPJS perusahaan

    const p = (await get(`/api/services/projects/${projectId}`).expect(200)).body;
    const bySource = (s: string) =>
      p.costs
        .filter((c: { source: string }) => c.source === s)
        .reduce((a: number, c: { amount: string }) => a + Number(c.amount), 0);
    expect(bySource('BILL')).toBe(5000000);
    expect(bySource('CASH')).toBe(1000000);
    expect(bySource('PAYROLL')).toBeCloseTo(payroll, 2);
    expect(Number(p.directCost)).toBeCloseTo(6000000 + payroll, 2);

    const f = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    expect(Number(f.finalCost.direct)).toBeCloseTo(6000000 + payroll, 2);
    expect(Number(f.finalCost.common)).toBe(2000000); // gaji proyek tidak ikut biaya bersama
  });

  it('jurnal umum: baris beban bisa ditandai proyek; jurnal yang dibalik tidak dihitung', async () => {
    const accounts = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const acc = (c: string) => accounts.find((a) => a.code === c)!.id;
    const before = Number((await get(`/api/services/projects/${projectId}`).expect(200)).body.directCost);
    await post('/api/accounting/journals', {
      date: '2026-10-28',
      description: 'Alokasi sewa alat berat',
      lines: [
        { accountId: acc('6-7000'), debit: '500000', projectId },
        { accountId: acc('1-1100'), credit: '500000' },
      ],
    }).expect(201);
    const j2 = (
      await post('/api/accounting/journals', {
        date: '2026-10-28',
        description: 'Salah catat',
        lines: [
          { accountId: acc('6-7000'), debit: '300000', projectId },
          { accountId: acc('1-1100'), credit: '300000' },
        ],
      }).expect(201)
    ).body;
    await post(`/api/accounting/journals/${j2.id}/reverse`).expect(201);
    await post('/api/accounting/journals', {
      date: '2026-10-28',
      description: 'x',
      lines: [
        { accountId: acc('6-7000'), debit: '1', projectId: '00000000-0000-4000-8000-000000000000' },
        { accountId: acc('1-1100'), credit: '1' },
      ],
    }).expect(400);
    const p = (await get(`/api/services/projects/${projectId}`).expect(200)).body;
    expect(Number(p.directCost) - before).toBe(500000);
    expect(p.costs.filter((c: { source: string }) => c.source === 'JOURNAL')).toHaveLength(1);
    const f = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    expect(Number(f.finalCost.direct)).toBeCloseTo(before + 500000, 2);
  });
});
