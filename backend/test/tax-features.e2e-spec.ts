/** Fitur pajak mengikuti jenis usaha, status PKP, dan skema PPh (me.taxFeatures dan baris kewajiban PPN) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Fitur pajak per usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const tokens: Record<string, string> = {};
  const as = (m: string) => ({ Authorization: `Bearer ${tokens[m]}` });
  const me = async (m: string) => (await http.get('/api/auth/me').set(as(m)).expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    for (const m of ['DAGANG', 'JASA']) tokens[m] = (await http.post('/api/auth/register').send({ companyName: `PT ${m}`, name: 'P', email: `tf-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  it('dagang PKP: PPN tampil, PPh dipotong pelanggan disembunyikan; jasa: sebaliknya tampil', async () => {
    const d = (await me('DAGANG')).taxFeatures;
    expect(d.vat).toBe(true);
    expect(d.withheldByCustomers).toBe(false);
    expect((await me('JASA')).taxFeatures.withheldByCustomers).toBe(true);
  });

  it('non-PKP menyembunyikan PPN dan Coretax, dan kewajiban PPN tidak ditampilkan', async () => {
    await http.patch('/api/settings/company').set(as('DAGANG')).send({ pkp: false }).expect(200);
    const f = (await me('DAGANG')).taxFeatures;
    expect(f.vat).toBe(false);
    expect(f.coretax).toBe(false);
    const ob = (await http.get('/api/tax/obligations').set(as('DAGANG')).expect(200)).body as { type: string }[];
    expect(ob.some((o) => o.type === 'PPN')).toBe(false);
  });

  it('PPh final UMKM menyembunyikan rekonsiliasi fiskal; kembali ke umum menampilkannya', async () => {
    await http.patch('/api/settings/reporting').set(as('JASA')).send({ taxScheme: 'FINAL_UMKM' }).expect(200);
    expect((await me('JASA')).taxFeatures.fiscalReconciliation).toBe(false);
    await http.patch('/api/settings/reporting').set(as('JASA')).send({ taxScheme: 'GENERAL' }).expect(200);
    expect((await me('JASA')).taxFeatures.fiscalReconciliation).toBe(true);
  });
});
