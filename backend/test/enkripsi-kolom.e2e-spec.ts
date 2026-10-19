/**
 * Enkripsi per kolom untuk NIK, NPWP, dan nomor rekening: tersimpan terenkripsi di database, tetap terbaca lewat API/laporan,
 * tidak bocor ke jejak audit, ikut terbuka di ekspor milik klien, dan data lama diisi ulang dengan aman.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { decryptField, encryptField, maskField } from '../src/common/utils/secret';
import { maskIdentity } from '../src/common/audit/mask';
import { createDb, createPool, DB, Db } from '../src/db/db';
import { EmploymentService } from '../src/modules/hr/employment';
import { FieldEncryptionService } from '../src/modules/data-rights/field-encryption';
import { SecurityPostureService } from '../src/modules/data-rights/security-posture';

describe('Enkripsi kolom identitas/rekening (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const PASS = 'rahasia123';
  const NIK = '3201010101010001';
  const NPWP = '0123456789012345';
  const REK = '1234509876';
  let token = '';
  let tenantId = '';
  const as = () => ({ Authorization: `Bearer ${token}` });
  const raw = async (q: string) => (await db.execute<Record<string, string | null>>(sql.raw(q))).rows;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const r = (await http.post('/api/auth/register').send({ companyName: 'PT Sandi Kolom', name: 'Pemilik', email: `ek-${stamp}@uji.id`, password: PASS, businessModel: 'DAGANG' }).expect(201)).body;
    token = r.accessToken;
    tenantId = r.user.tenantId;
    await http.post('/api/apps/payroll/install').set(as()).expect(201);
  }, 60_000);
  afterAll(async () => app.close());

  it('fungsi enkripsi: bolak-balik, acak, kosong tidak dienkripsi, nilai lama teks biasa tetap terbaca, penyamaran 4 digit', () => {
    const a = encryptField(REK)!;
    const b = encryptField(REK)!;
    expect(a.startsWith('enc1:')).toBe(true);
    expect(a).not.toContain(REK);
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(REK);
    expect(encryptField(a)).toBe(a); // tidak dienkripsi dua kali
    expect(encryptField('')).toBe('');
    expect(encryptField('   ')).toBe('   ');
    expect(encryptField(null)).toBeNull();
    expect(decryptField('1234')).toBe('1234');
    expect(maskField(a)).toBe('••••9876');
    expect(maskIdentity({ nik: NIK, name: 'Siti', changes: { bankAccount: { from: REK, to: encryptField('99887766') } } })).toEqual({ nik: '••••0001', name: 'Siti', changes: { bankAccount: { from: '••••9876', to: '••••7766' } } });
  });

  it('data tersimpan terenkripsi di database tetapi terbaca normal lewat API', async () => {
    const c = (await http.post('/api/customers').set(as()).send({ code: 'C-ENK', name: 'Toko Sandi', npwp: NPWP }).expect(201)).body;
    const s = (await http.post('/api/suppliers').set(as()).send({ code: 'S-ENK', name: 'PT Pemasok Sandi', npwp: NPWP, bankName: 'BCA', bankAccountNo: REK, bankAccountName: 'PT Pemasok Sandi' }).expect(201)).body;
    const e = (await http.post('/api/hr/employees').set(as()).send({ code: 'E-ENK', name: 'Siti Sandi', nik: NIK, npwp: NPWP, ptkp: 'TK/0', joinDate: '2025-01-02', bankName: 'BCA', bankAccount: REK, baseSalary: '5000000' }).expect(201)).body;
    expect(c.npwp).toBe(NPWP);
    expect(s.bankAccountNo).toBe(REK);
    expect(e.nik).toBe(NIK);

    const [rc] = await raw(`SELECT npwp FROM customers WHERE id = '${c.id}'`);
    const [rs] = await raw(`SELECT npwp, bank_account_no FROM suppliers WHERE id = '${s.id}'`);
    const [re] = await raw(`SELECT nik, npwp, bank_account FROM employees WHERE id = '${e.id}'`);
    for (const v of [rc.npwp, rs.npwp, rs.bank_account_no, re.nik, re.npwp, re.bank_account]) {
      expect(v).toMatch(/^enc1:v1\./);
      expect(v).not.toMatch(/\d{9,}/);
    }
    expect((await http.get(`/api/hr/employees/${e.id}`).set(as()).expect(200)).body.nik).toBe(NIK);
    expect((await http.get('/api/suppliers').set(as()).expect(200)).body.some((x: { bankAccountNo: string }) => x.bankAccountNo === REK)).toBe(true);
  });

  it('pemeriksaan NIK/NPWP/rekening ganda (usaha jasa) tetap bekerja walau nilainya terenkripsi', async () => {
    const [emp] = await raw(`SELECT id FROM employees WHERE tenant_id = '${tenantId}' AND code = 'E-ENK'`);
    const svc = app.get(EmploymentService);
    await expect(svc.assertNoDuplicates(db, tenantId, null, { bankAccount: ` ${REK.slice(0, 5)}-${REK.slice(5)} ` })).rejects.toThrow('Nomor rekening sudah dipakai');
    await expect(svc.assertNoDuplicates(db, tenantId, null, { nik: NIK })).rejects.toThrow('NIK sudah dipakai');
    await expect(svc.assertNoDuplicates(db, tenantId, emp.id, { nik: NIK, npwp: NPWP, bankAccount: REK })).resolves.toBeUndefined(); // diri sendiri boleh
    await expect(svc.assertNoDuplicates(db, tenantId, null, { nik: '3201010101010099' })).resolves.toBeUndefined();
  });

  it('jejak audit tidak menyimpan nilai utuh', async () => {
    const e = (await http.get('/api/hr/employees').set(as()).expect(200)).body.find((x: { code: string }) => x.code === 'E-ENK');
    await http.patch(`/api/hr/employees/${e.id}`).set(as()).send({ bankAccount: '5550001111' }).expect(200);
    await new Promise((r) => setTimeout(r, 400));
    const logs = await raw(`SELECT data::text AS d FROM audit_logs WHERE tenant_id = '${tenantId}'`);
    const all = logs.map((l) => l.d).join('\n');
    for (const secret of [NIK, NPWP, REK, '5550001111']) expect(all).not.toContain(secret);
    expect(all).toContain('••••');
  });

  it('data lama berteks biasa diisi ulang menjadi terenkripsi, termasuk salinan di jsonb, dan pemeriksaan postur mencerminkannya', async () => {
    const [emp] = await raw(`SELECT id FROM employees WHERE tenant_id = '${tenantId}' AND code = 'E-ENK'`);
    const [usr] = await raw(`SELECT id FROM users WHERE tenant_id = '${tenantId}' LIMIT 1`);
    const [sup] = await raw(`SELECT id FROM suppliers WHERE tenant_id = '${tenantId}' AND code = 'S-ENK'`);
    const pool = createPool();
    try {
      const admin = createDb(pool);
      // simulasi data sebelum fitur ini: teks biasa
      await admin.execute(sql.raw(`UPDATE employees SET nik = '${NIK}', npwp = '${NPWP}', bank_account = '${REK}' WHERE id = '${emp.id}'`));
      await admin.execute(sql.raw(`UPDATE suppliers SET bank_account_no = '${REK}' WHERE id = '${sup.id}'`));
      await admin.execute(sql.raw(`INSERT INTO employee_change_requests (tenant_id, employee_id, changes, requested_by_id) VALUES ('${tenantId}', '${emp.id}', '{"bankAccount":{"from":"${REK}","to":"7770001234"},"baseSalary":{"from":"1","to":"2"}}'::jsonb, '${usr.id}')`));
      await admin.execute(sql.raw(`INSERT INTO approval_requests (tenant_id, kind, ref_id, title, amount, payload, requested_by_id) VALUES ('${tenantId}', 'SUPPLIER_BANK', '${sup.id}', 'uji', 0, '{"supplierId":"${sup.id}","bankAccountNo":"7770001234"}'::jsonb, '${usr.id}')`));
    } finally {
      await pool.end();
    }
    const fields = app.get(FieldEncryptionService);
    expect(await fields.plaintextCount()).toBeGreaterThanOrEqual(6);
    const posture = await app.get(SecurityPostureService).check();
    expect(posture.checks.find((c) => c.key === 'field-encryption')!.ok).toBe(false);

    const done = await fields.backfill();
    expect(done).toBeGreaterThanOrEqual(6);
    expect(await fields.plaintextCount()).toBe(0);
    expect(await fields.backfill()).toBe(0); // idempotent

    const [re] = await raw(`SELECT nik, npwp, bank_account FROM employees WHERE id = '${emp.id}'`);
    expect(re.nik).toMatch(/^enc1:/);
    const [cr] = await raw(`SELECT changes::text AS c FROM employee_change_requests WHERE tenant_id = '${tenantId}'`);
    expect(cr.c).not.toContain(REK);
    expect(cr.c).not.toContain('7770001234');
    expect(cr.c).toContain('enc1:');
    expect(cr.c).toContain('"baseSalary"'); // bidang lain tidak berubah
    const [ap] = await raw(`SELECT payload::text AS p FROM approval_requests WHERE tenant_id = '${tenantId}' AND kind = 'SUPPLIER_BANK'`);
    expect(ap.p).not.toContain('7770001234');
    // nilai tetap terbaca benar
    const e = (await http.get(`/api/hr/employees/${emp.id}`).set(as()).expect(200)).body;
    expect(e.nik).toBe(NIK);
    expect(e.bankAccount).toBe(REK);
    expect((await app.get(SecurityPostureService).check()).checks.find((c) => c.key === 'field-encryption')!.ok).toBe(true);
  });

  it('ekspor milik klien memuat nilai asli, bukan teks terenkripsi', async () => {
    const p = (await http.post('/api/company-data/export').set(as()).send({ password: PASS }).expect(200)).body as { path: string };
    const r = await http.get(p.path).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const zip = (r.body as Buffer).toString('latin1');
    expect(r.status).toBe(200);
    expect(zip.length).toBeGreaterThan(1000);
    // isi di dalam ZIP terkompresi; verifikasi lewat unzip python
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'enk-'));
    try {
      writeFileSync(join(dir, 'e.zip'), r.body as Buffer);
      const out = execFileSync('python3', ['-I', '-c', "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read('data/employees.csv').decode()+z.read('data/suppliers.csv').decode()+z.read('data/employee_change_requests.csv').decode())", join(dir, 'e.zip')], { maxBuffer: 64 * 1024 * 1024 }).toString();
      expect(out).toContain(NIK);
      expect(out).toContain(REK);
      expect(out).toContain('7770001234');
      expect(out).not.toContain('enc1:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('layar penghapusan menyebut lama retensi cadangan sesuai BACKUP_RETENTION_DAYS', async () => {
    const was = process.env.BACKUP_RETENTION_DAYS;
    try {
      delete process.env.BACKUP_RETENTION_DAYS;
      const a = (await http.get('/api/company-data/status').set(as()).expect(200)).body;
      expect(a.backupRetentionDays).toBeNull();
      expect(a.backupNote).toContain('siklus penyimpanan cadangan penyedia');
      process.env.BACKUP_RETENTION_DAYS = '30';
      const b = (await http.get('/api/company-data/status').set(as()).expect(200)).body;
      expect(b.backupRetentionDays).toBe(30);
      expect(b.backupNote).toContain('paling lama 30 hari');
      process.env.BACKUP_RETENTION_DAYS = 'abc';
      expect((await http.get('/api/company-data/status').set(as()).expect(200)).body.backupRetentionDays).toBeNull();
    } finally {
      if (was === undefined) delete process.env.BACKUP_RETENTION_DAYS;
      else process.env.BACKUP_RETENTION_DAYS = was;
    }
  });
});
