/**
 * CRM per jenis usaha: tahap bawaan, sumber prospek, dan alasan kalah mengikuti jenis usaha; semua pilihan berupa daftar tertutup.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BUSINESS_MODEL_KEYS, CRM_PROFILES } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('CRM per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('profil: tiap jenis usaha punya tahap, sumber, dan alasan kalah sendiri', () => {
    const names = new Set<string>();
    for (const m of BUSINESS_MODEL_KEYS) {
      const p = CRM_PROFILES[m];
      expect(p.stages.length).toBeGreaterThanOrEqual(3);
      expect(p.sources.length).toBeGreaterThanOrEqual(3);
      expect(p.lostReasons.length).toBeGreaterThanOrEqual(3);
      names.add(p.stages.map((s) => s.name).join('|'));
    }
    expect(names.size).toBe(BUSINESS_MODEL_KEYS.length); // tidak ada dua jenis usaha dengan pipeline yang sama
  });

  describe.each(['DAGANG', 'JASA', 'FMCG', 'MANUFAKTUR'] as const)('%s', (model) => {
    it('tahap bawaan, sumber, dan alasan kalah mengikuti jenis usaha', async () => {
      const t = (await http.post('/api/auth/register').send({ companyName: `PT ${model}`, name: 'P', email: `crm-${model}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
      const prof = CRM_PROFILES[model];
      const stages = (await http.get('/api/crm/stages').set(as(t)).expect(200)).body as { name: string }[];
      expect(stages.map((s) => s.name)).toEqual(prof.stages.map((s) => s.name));
      expect((await http.get('/api/crm/profile').set(as(t)).expect(200)).body.sources).toEqual(prof.sources);
      // sumber di luar daftar ditolak
      expect((await http.post('/api/crm/leads').set(as(t)).send({ title: 'Uji sumber', source: 'Ramalan bintang' })).status).toBe(400);
      const lead = (await http.post('/api/crm/leads').set(as(t)).send({ title: 'Uji prospek', source: prof.sources[0] }).expect(201)).body;
      expect((await http.patch(`/api/crm/leads/${lead.id}`).set(as(t)).send({ source: 'Sumber karangan' })).status).toBe(400);
      // alasan kalah: dari daftar, atau "Lainnya: …"
      const mark = (lostReason: string) => http.post(`/api/crm/leads/${lead.id}/mark`).set(as(t)).send({ status: 'LOST', lostReason });
      expect((await mark('Alasan bebas ketik')).status).toBe(400);
      expect((await mark('Lainnya: ')).status).toBe(400);
      await mark('Lainnya: pemilik pindah kota').expect(201);
      await http.post(`/api/crm/leads/${lead.id}/mark`).set(as(t)).send({ status: 'OPEN' }).expect(201);
      await mark(prof.lostReasons[0]).expect(201);
    });
  });

  it('aplikasi CRM menyala bawaan untuk Dagang, Jasa, FMCG, Manufaktur', async () => {
    for (const m of ['DAGANG', 'JASA', 'FMCG', 'MANUFAKTUR']) {
      const t = (await http.post('/api/auth/register').send({ companyName: `PT apps ${m}`, name: 'P', email: `crm-apps-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken as string;
      const me = (await http.get('/api/auth/me').set(as(t)).expect(200)).body;
      expect(me.apps).toContain('crm');
    }
  });
});
