/**
 * Hak data perusahaan: ekspor seluruh data (isolasi, tanpa rahasia, utuh), penghapusan terjadwal dengan banyak pengaman,
 * penghapusan menyeluruh tanpa menyentuh perusahaan lain, dan pemeriksaan postur database.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { totp } from '../src/common/auth/totp';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { createDb, createPool, DB, Db } from '../src/db/db';
import { dbScope } from '../src/db/db-scope';
import { DeletionService, GRACE_DAYS } from '../src/modules/data-rights/deletion';
import { eraseTenant } from '../src/modules/data-rights/erase';
import { SecurityPostureService } from '../src/modules/data-rights/security-posture';

interface Unzipped { names: string[]; manifest: { tables: { name: string; rows: number; sha256: string; columns: string[]; excludedColumns: string[] }[]; totals: { rows: number; tables: number }; company: { id: string; name: string } }; files: Record<string, string>; bad: string | null }

function unzip(buf: Buffer): Unzipped {
  const dir = mkdtempSync(join(tmpdir(), 'exp-'));
  try {
    const f = join(dir, 'e.zip');
    writeFileSync(f, buf);
    const py = `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nout={'bad':z.testzip(),'names':z.namelist(),'files':{n:z.read(n).decode('utf-8') for n in z.namelist() if n.endswith('.csv')}}\nout['manifest']=json.loads(z.read('manifest.json'))\nprint(json.dumps(out))`;
    return JSON.parse(execFileSync('python3', ['-I', '-c', py, f], { maxBuffer: 256 * 1024 * 1024 }).toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Data perusahaan: ekspor, penghapusan, postur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let deletion: DeletionService;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const PASS = 'rahasia123';
  const mk = async (tag: string, company: string) => {
    const r = (await http.post('/api/auth/register').send({ companyName: company, name: `Pemilik ${tag}`, email: `dp-${tag}-${stamp}@uji.id`, password: PASS, businessModel: 'DAGANG' }).expect(201)).body;
    return { token: r.accessToken as string, tenantId: r.user.tenantId as string, email: `dp-${tag}-${stamp}@uji.id` };
  };
  const addUser = async (t: { token: string }, tag: string, role: string) => {
    await post(t.token, '/api/users', { name: tag, email: `dp-${tag}-${stamp}@uji.id`, password: 'kata12345678', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `dp-${tag}-${stamp}@uji.id`, password: 'kata12345678' }).expect(200)).body.accessToken as string;
  };
  const download = async (path: string) => {
    const r = await http.get(path).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    return r;
  };
  const exportAll = async (t: { token: string }, password = PASS, code?: string) => {
    const p = await post(t.token, '/api/company-data/export', { password, ...(code ? { code } : {}) });
    return p;
  };
  const count = async (table: string, tenantId: string) => Number((await db.execute<{ n: string }>(sql.raw(`SELECT count(*) AS n FROM "${table}" WHERE tenant_id = '${tenantId}'`))).rows[0].n);

  let A: Awaited<ReturnType<typeof mk>>;
  let B: Awaited<ReturnType<typeof mk>>;
  let PADM: Awaited<ReturnType<typeof mk>>;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = `dp-padm-${stamp}@uji.id`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    deletion = app.get(DeletionService);
    A = await mk('a', 'PT Alpha Data');
    B = await mk('b', 'PT Beta Rahasia');
    PADM = await mk('padm', 'PT Pemilik Layanan');
    await post(A.token, '/api/customers', { code: 'A1', name: '=HYPERLINK("http://jahat.example","klik")' }).expect(201);
    await post(A.token, '/api/customers', { code: 'A2', name: 'Pelanggan Alpha, "Utama"' }).expect(201);
    await post(B.token, '/api/customers', { code: 'B1', name: 'RAHASIA-MILIK-BETA' }).expect(201);
  });
  afterAll(() => app.close());

  describe('postur database', () => {
    it('semua pemeriksaan kritis lolos dan uji isolasi lintas perusahaan benar-benar dijalankan', async () => {
      const p = await app.get(SecurityPostureService).check();
      expect(p.checks.filter((c) => !c.ok && c.severity === 'critical')).toEqual([]);
      expect(p.ok).toBe(true);
      const probe = p.checks.find((c) => c.key === 'rls-probe')!;
      expect(probe.detail).toContain('hanya melihat barisnya sendiri');
      expect(p.checks.find((c) => c.key === 'rls-coverage')!.detail).toContain('auth_tokens');
    });

    it('hanya pemilik layanan yang boleh melihatnya lewat Panel', async () => {
      await get(A.token, '/api/platform-admin/security-posture').expect(403);
      const r = await get(PADM.token, '/api/platform-admin/security-posture').expect(200);
      expect(r.body.ok).toBe(true);
    });
  });

  describe('ekspor seluruh data', () => {
    let zipBuf: Buffer;
    let path: string;

    it('hanya OWNER; kata sandi salah ditolak; Admin ditolak', async () => {
      const adminToken = await addUser(A, 'admA', 'ADMIN');
      expect((await exportAll({ token: adminToken })).status).toBe(403);
      expect((await exportAll(A, 'salah-salah')).status).toBe(400);
      const ok = await exportAll(A);
      expect(ok.status).toBe(200);
      expect(ok.body.path).toMatch(/^\/api\/company-data\/export\/[A-Za-z0-9_-]{40,}$/);
      expect(ok.body.expiresInSeconds).toBe(300);
      path = ok.body.path;
    });

    it('arsip ZIP valid, memuat data perusahaan sendiri saja, tanpa rahasia, dengan checksum yang cocok', async () => {
      const r = await download(path);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/zip');
      expect(r.headers['content-disposition']).toContain('sansu-pt-alpha-data-');
      expect(r.headers['cache-control']).toBe('no-store');
      zipBuf = r.body as Buffer;
      const z = unzip(zipBuf);
      expect(z.bad).toBeNull();
      expect(z.names).toEqual(expect.arrayContaining(['manifest.json', 'README.txt', 'data/customers.csv', 'data/users.csv', 'data/tenants.csv', 'data/audit_logs.csv']));
      // isolasi: tidak ada jejak perusahaan lain di arsip mana pun
      for (const [name, text] of Object.entries(z.files)) {
        expect(text).not.toContain('RAHASIA-MILIK-BETA');
        expect(text).not.toContain(B.tenantId);
        expect(name).not.toContain('auth_tokens');
      }
      expect(z.files['data/customers.csv']).toContain('Pelanggan Alpha');
      // rumus dinetralkan dan CSV benar menyaring tanda kutip
      expect(z.files['data/customers.csv']).toContain(`'=HYPERLINK(""http://jahat.example"",""klik"")`);
      expect(z.files['data/customers.csv']).toContain('"Pelanggan Alpha, ""Utama"""');
      // tanpa rahasia
      const usersHeader = z.files['data/users.csv'].split('\r\n')[0];
      for (const bad of ['password_hash', 'totp_secret', 'totp_backup_codes', 'token_version', 'telegram_link_code']) expect(usersHeader).not.toContain(bad);
      expect(z.files['data/users.csv']).not.toMatch(/\$2[aby]\$/); // pola hash bcrypt
      const usersMeta = z.manifest.tables.find((t) => t.name === 'users')!;
      expect(usersMeta.excludedColumns).toEqual(expect.arrayContaining(['password_hash', 'totp_secret']));
      expect(z.manifest.tables.some((t) => ['auth_tokens', 'error_logs', 'data_export_tokens', 'data_erasure_log', 'idempotency_keys'].includes(t.name))).toBe(false);
      // keutuhan: sha256 dan jumlah baris sesuai manifest dan database
      for (const t of z.manifest.tables) {
        const text = z.files[`data/${t.name}.csv`];
        expect(createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')).toBe(t.sha256);
      }
      expect(z.manifest.tables.find((t) => t.name === 'customers')!.rows).toBe(await count('customers', A.tenantId));
      expect(z.manifest.tables.find((t) => t.name === 'users')!.rows).toBe(await count('users', A.tenantId));
      expect(z.manifest.company).toEqual({ id: A.tenantId, name: 'PT Alpha Data' });
      expect(z.files['data/tenants.csv']).toContain('PT Alpha Data');
    });

    it('tautan sekali pakai; token asing atau kedaluwarsa ditolak; ekspor beruntun dibatasi; tercatat di audit', async () => {
      expect((await download(path)).status).toBe(410); // sudah dipakai
      expect((await download('/api/company-data/export/token-asal-asalan-yang-tidak-ada-xyz')).status).toBe(410);
      expect((await download('/api/company-data/export/pendek')).status).toBe(404);
      expect((await exportAll(A)).status).toBe(429); // jeda antar ekspor
      const logs = await db.execute<{ action: string }>(sql`SELECT action FROM audit_logs WHERE tenant_id = ${A.tenantId} AND action LIKE 'DATA_EXPORT%' ORDER BY id`);
      expect(logs.rows.map((l) => l.action)).toEqual(['DATA_EXPORT_REQUEST', 'DATA_EXPORT']);
      const failed = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = ${A.tenantId} AND action = 'REAUTH_FAILED'`);
      expect(failed.rows[0].n).toBe(1);
    });

    it('token kedaluwarsa tidak bisa dipakai', async () => {
      await db.execute(sql`UPDATE data_export_tokens SET expires_at = now() - interval '1 minute', used_at = NULL WHERE tenant_id = ${A.tenantId}`);
      const all = (await db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM data_export_tokens WHERE tenant_id = ${A.tenantId}`)).rows;
      expect(all.length).toBeGreaterThan(0);
      // token mentah tidak tersimpan; menebak tidak mungkin: yang tersimpan hanya hash 64 heksadesimal
      expect(all.every((t) => /^[0-9a-f]{64}$/.test(t.token_hash))).toBe(true);
    });

    it('percobaan verifikasi gagal berulang mengunci sementara, bahkan untuk kata sandi benar', async () => {
      for (let i = 0; i < 5; i++) expect((await exportAll(B, `salah-${i}`)).status).toBe(400);
      expect((await exportAll(B, `salah-6`)).status).toBe(429);
      expect((await exportAll(B, PASS)).status).toBe(429);
    });

    it('verifikasi 2 langkah: kode wajib bila aktif', async () => {
      const C = await mk('c', 'PT Dua Langkah');
      const setup = (await post(C.token, '/api/auth/2fa/setup').expect(200)).body as { secret: string };
      await post(C.token, '/api/auth/2fa/enable', { code: totp(setup.secret) }).expect(200);
      const r0 = await exportAll(C);
      expect(r0.status).toBe(400);
      expect(JSON.stringify(r0.body)).toContain('verifikasi 2 langkah');
      expect((await exportAll(C, PASS, '000000')).status).toBe(400);
      expect((await exportAll(C, PASS, totp(setup.secret))).status).toBe(200);
    });
  });

  describe('penghapusan terjadwal', () => {
    let D: Awaited<ReturnType<typeof mk>>;
    let E: Awaited<ReturnType<typeof mk>>;
    const body = (name: string, extra: object = {}) => ({ password: PASS, confirmName: name, ackRetention: true, ...extra });

    beforeAll(async () => {
      D = await mk('d', 'PT Delta Hapus');
      E = await mk('e', 'PT Epsilon Tetap');
      await post(D.token, '/api/customers', { code: 'D1', name: 'Pelanggan Delta' }).expect(201);
      await post(E.token, '/api/customers', { code: 'E1', name: 'Pelanggan Epsilon' }).expect(201);
    });

    it('pengaman permintaan: peran, nama perusahaan, pernyataan retensi, kata sandi', async () => {
      const adm = await addUser(D, 'admD', 'ADMIN');
      expect((await post(adm, '/api/company-data/deletion', body('PT Delta Hapus'))).status).toBe(403);
      expect((await post(D.token, '/api/company-data/deletion', body('PT Delta Salah'))).status).toBe(400);
      expect((await post(D.token, '/api/company-data/deletion', { ...body('PT Delta Hapus'), ackRetention: false })).status).toBe(400);
      expect((await post(D.token, '/api/company-data/deletion', { ...body('PT Delta Hapus'), password: 'salah-salah' })).status).toBe(400);
      expect((await get(D.token, '/api/company-data/status').expect(200)).body.deletion).toBeNull();
    });

    it('dijadwalkan sesudah masa tenggang; permintaan ganda ditolak; perusahaan lain tidak terpengaruh', async () => {
      const r = await post(D.token, '/api/company-data/deletion', body('PT Delta Hapus', { reason: 'Berhenti usaha' })).expect(200);
      expect(r.body.deletion).toMatchObject({ status: 'SCHEDULED', scheduledFor: addDays(todayJakarta(), GRACE_DAYS()), exportWaived: false, exportDone: false });
      expect((await post(D.token, '/api/company-data/deletion', body('PT Delta Hapus'))).status).toBe(409);
      expect((await get(E.token, '/api/company-data/status').expect(200)).body.deletion).toBeNull();
      // belum jatuh tempo: penjadwal tidak menghapus apa pun
      const early = await deletion.runDue(todayJakarta());
      expect(early.executed).toBe(0);
      expect(await count('customers', D.tenantId)).toBe(1);
    });

    it('pemilik layanan dapat menahan dan melepas; yang ditahan tidak dieksekusi', async () => {
      const padm = PADM.token;
      const list = (await get(padm, '/api/platform-admin/data-deletions').expect(200)).body as { requests: { id: string; company: string; status: string }[] };
      const mine = list.requests.find((x) => x.company === 'PT Delta Hapus')!;
      expect(mine.status).toBe('SCHEDULED');
      await post(padm, `/api/platform-admin/data-deletions/${mine.id}/hold`, { reason: 'x' }).expect(400); // alasan terlalu pendek
      await post(padm, `/api/platform-admin/data-deletions/${mine.id}/hold`, { reason: 'Sengketa pembayaran' }).expect(200);
      await post(A.token, `/api/platform-admin/data-deletions/${mine.id}/hold`, { reason: 'bukan pemilik layanan' }).expect(403);
      const late = addDays(todayJakarta(), GRACE_DAYS() + 5);
      expect((await deletion.runDue(late)).executed).toBe(0);
      expect(await count('customers', D.tenantId)).toBe(1);
      expect((await get(D.token, '/api/company-data/status').expect(200)).body.deletion).toMatchObject({ status: 'ON_HOLD', holdReason: 'Sengketa pembayaran' });
      await post(padm, `/api/platform-admin/data-deletions/${mine.id}/release`, {}).expect(200);
    });

    it('jatuh tempo tanpa ekspor: data TIDAK dihapus dan pemilik diingatkan', async () => {
      await db.execute(sql`UPDATE data_deletion_requests SET scheduled_for = ${todayJakarta()} WHERE tenant_id = ${D.tenantId}`);
      const r = await deletion.runDue(todayJakarta());
      expect(r).toMatchObject({ executed: 0, waitingExport: 1, failed: 0 });
      expect(await count('customers', D.tenantId)).toBe(1);
      expect((await http.post('/api/auth/login').send({ email: D.email, password: PASS })).status).toBe(200); // masih bisa masuk
    });

    it('setelah ekspor diunduh, penghapusan dijalankan menyeluruh; perusahaan lain utuh; bukti tanpa data bisnis', async () => {
      const prep = await exportAll(D);
      expect(prep.status).toBe(200);
      expect((await download(prep.body.path)).status).toBe(200);
      const beforeE = { customers: await count('customers', E.tenantId), users: await count('users', E.tenantId), audit: await count('audit_logs', E.tenantId) };
      const r = await deletion.runDue(todayJakarta());
      expect(r).toMatchObject({ executed: 1, failed: 0 });

      expect(await count('customers', D.tenantId)).toBe(0);
      expect(await count('users', D.tenantId)).toBe(0);
      expect(await count('audit_logs', D.tenantId)).toBe(0);
      expect(Number((await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM tenants WHERE id = ${D.tenantId}`)).rows[0].n)).toBe(0);
      expect((await http.post('/api/auth/login').send({ email: D.email, password: PASS })).status).toBe(401);
      expect((await get(D.token, '/api/company-data/status')).status).toBe(401);
      // perusahaan lain tidak tersentuh
      expect({ customers: await count('customers', E.tenantId), users: await count('users', E.tenantId), audit: await count('audit_logs', E.tenantId) }).toEqual(beforeE);
      expect((await http.post('/api/auth/login').send({ email: E.email, password: PASS }).expect(200)).body.accessToken).toBeTruthy();

      const log = (await db.execute<Record<string, unknown>>(sql`SELECT * FROM data_erasure_log WHERE tenant_id = ${D.tenantId}`)).rows;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ company_name: 'PT Delta Hapus', requested_by_email: D.email, export_waived: false });
      expect(Number(log[0].rows_deleted)).toBeGreaterThan(5);
      const detail = log[0].detail as Record<string, number>;
      expect(detail.customers).toBe(1);
      expect(detail.tenants).toBe(1);
      expect(JSON.stringify(log[0])).not.toContain('Pelanggan Delta'); // bukti tidak memuat data bisnis
    });

    it('dibatalkan oleh admin: data aman dan permintaan baru boleh diajukan lagi', async () => {
      const F = await mk('f', 'PT Foxtrot Batal');
      const adm = await addUser(F, 'admF', 'ADMIN');
      await post(F.token, '/api/company-data/deletion', body('PT Foxtrot Batal', { exportWaived: true })).expect(200);
      const c = await http.delete('/api/company-data/deletion').set(as(adm)).expect(200);
      expect(c.body.deletion).toBeNull();
      expect((await deletion.runDue(addDays(todayJakarta(), 90))).executed).toBe(0);
      expect(await count('users', F.tenantId)).toBeGreaterThan(0);
      await post(F.token, '/api/company-data/deletion', body('PT Foxtrot Batal')).expect(200);
      // tanpa ekspor dengan pelepasan eksplisit: dijalankan saat jatuh tempo
      await post(adm, '/api/company-data/deletion', body('PT Foxtrot Batal')).expect(403);
    });

    it('pelepasan ekspor eksplisit: dihapus saat jatuh tempo tanpa menunggu ekspor', async () => {
      const G = await mk('g', 'PT Golf Tanpa Ekspor');
      await post(G.token, '/api/company-data/deletion', body('PT Golf Tanpa Ekspor', { exportWaived: true })).expect(200);
      expect((await deletion.runDue(addDays(todayJakarta(), GRACE_DAYS() + 1))).executed).toBe(1);
      expect(await count('users', G.tenantId)).toBe(0);
      const log = (await db.execute<{ export_waived: boolean }>(sql`SELECT export_waived FROM data_erasure_log WHERE tenant_id = ${G.tenantId}`)).rows[0];
      expect(log.export_waived).toBe(true);
    });

    it('perusahaan pemilik layanan tidak dapat dihapus', async () => {
      const r = await post(PADM.token, '/api/company-data/deletion', body('PT Pemilik Layanan'));
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('pemilik layanan');
    });
  });

  describe('penghapusan menyeluruh pada data kaya (demo)', () => {
    it('semua tabel milik perusahaan terhapus, perusahaan lain identik jumlah barisnya, dan skema yang berubah menghentikan penghapusan', async () => {
      const start = async () => (await http.post('/api/demo/start').send({ businessModel: 'FNB' }).expect(200)).body;
      await start();
      await start();
      const demos = (await db.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE settings ? 'demo' ORDER BY created_at DESC LIMIT 2`)).rows.map((r) => r.id);
      expect(demos).toHaveLength(2);
      const [victim, keeper] = demos;
      const tables = (await db.execute<{ t: string }>(sql`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY 1`)).rows.map((r) => r.t);
      const snapshot = async (tenant: string) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t, tenant)] as const)));
      const keeperBefore = await snapshot(keeper);
      const victimBefore = await snapshot(victim);
      const victimTotal = Object.values(victimBefore).reduce((a, b) => a + b, 0);
      expect(victimTotal).toBeGreaterThan(200); // data demo kaya lintas banyak tabel
      expect(Object.values(victimBefore).filter((n) => n > 0).length).toBeGreaterThan(30);

      // Skema berubah tanpa penyesuaian (tabel yatim tanpa tenant_id dan tanpa foreign key): penghapusan berhenti dan tidak ada yang terhapus
      const pool = createPool();
      await pool.query('CREATE TABLE zz_yatim (id int)');
      try {
        await expect(eraseTenant(createDb(pool), victim)).rejects.toThrow('zz_yatim');
        expect(await snapshot(victim)).toEqual(victimBefore);
      } finally {
        await pool.query('DROP TABLE zz_yatim');
      }

      try {
        const res = await eraseTenant(createDb(pool), victim);
        expect(res.rowsDeleted).toBeGreaterThanOrEqual(victimTotal);
        expect(res.perTable.tenants).toBe(1);
      } finally {
        await pool.end();
      }
      expect(Object.values(await snapshot(victim)).every((n) => n === 0)).toBe(true);
      expect(await snapshot(keeper)).toEqual(keeperBefore);
      // tidak ada baris anak yatim: setiap baris faktur/jurnal tersisa masih punya induk
      const orphans = (await db.execute<{ n: string }>(sql`SELECT (SELECT count(*) FROM journal_lines l WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = l.journal_id)) + (SELECT count(*) FROM invoice_lines l WHERE NOT EXISTS (SELECT 1 FROM invoices j WHERE j.id = l.invoice_id)) AS n`)).rows[0];
      expect(Number(orphans.n)).toBe(0);
      expect(dbScope).toBeDefined();
    }, 120_000);

    it('perusahaan yang tidak ada ditolak tanpa mengubah apa pun', async () => {
      const pool = createPool();
      try {
        await expect(eraseTenant(createDb(pool), '99999999-9999-4999-8999-999999999999')).rejects.toThrow('tidak ditemukan');
        await expect(eraseTenant(createDb(pool), "x'; DROP TABLE tenants;--")).rejects.toThrow('tidak valid');
      } finally {
        await pool.end();
      }
    });
  });
});
