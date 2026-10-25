/** Status backup database: laporan dari pelaksana backup (token), tampilan untuk pemilik layanan, status basi/gagal, dan peringatan. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { BackupStatusService, kindState, type BackupEntry } from '../src/modules/data-rights/backup-status.service';
import { SecurityPostureService } from '../src/modules/data-rights/security-posture';

const entry = (status: 'OK' | 'FAILED', at: string): BackupEntry => ({ kind: 'DUMP', status, source: 't', at });

describe('kindState (unit)', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  it('belum pernah, baik, basi, dan gagal', () => {
    expect(kindState(null, null, 26, now).state).toBe('NEVER');
    const ok = entry('OK', '2026-10-19T01:00:00Z');
    expect(kindState(ok, ok, 26, now)).toMatchObject({ state: 'OK' });
    const old = entry('OK', '2026-10-17T12:00:00Z');
    expect(kindState(old, old, 26, now)).toMatchObject({ state: 'STALE', ageHours: 48 });
    const bad = entry('FAILED', '2026-10-19T11:00:00Z');
    expect(kindState(bad, ok, 26, now)).toMatchObject({ state: 'FAILED', lastOk: ok });
  });
});

describe('Status backup database (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const TOKEN = 'token-backup-uji-1234567890abcdef';
  const PASS = 'rahasia123';
  let admin = '';
  let owner = '';
  const report = (body: object, token: string | null = TOKEN) => {
    const r = http.post('/api/backup-report').send(body);
    return token === null ? r : r.set('x-backup-token', token);
  };
  const overview = async () => (await http.get('/api/platform-admin/backups').set({ Authorization: `Bearer ${admin}` }).expect(200)).body;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = `bk-padm-${stamp}@uji.id`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = async (tag: string) => (await http.post('/api/auth/register').send({ companyName: `PT Backup ${tag}`, name: tag, email: `bk-${tag}-${stamp}@uji.id`, password: PASS, businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    admin = await reg('padm');
    owner = await reg('own');
    await db.execute(sql`DELETE FROM platform_settings WHERE key LIKE 'backup.%'`);
  }, 60_000);
  afterAll(async () => {
    delete process.env.BACKUP_REPORT_TOKEN;
    await app.close();
  });

  it('pelaporan nonaktif bila token belum diisi; Panel menandainya belum diaktifkan', async () => {
    delete process.env.BACKUP_REPORT_TOKEN;
    expect((await report({ kind: 'DUMP', status: 'OK', source: 'x' }).expect(404)).body.message).toContain('belum diaktifkan');
    expect((await overview()).configured).toBe(false);
    process.env.BACKUP_REPORT_TOKEN = 'terlalu-pendek';
    await report({ kind: 'DUMP', status: 'OK', source: 'x' }, 'terlalu-pendek').expect(404); // token < 24 karakter dianggap tidak diisi
  });

  it('token wajib dan harus benar; isi laporan divalidasi', async () => {
    process.env.BACKUP_REPORT_TOKEN = TOKEN;
    await report({ kind: 'DUMP', status: 'OK', source: 'x' }, null).expect(401);
    await report({ kind: 'DUMP', status: 'OK', source: 'x' }, 'salah-salah-salah-salah-salah').expect(401);
    await report({ kind: 'LAIN', status: 'OK', source: 'x' }).expect(400);
    await report({ kind: 'DUMP', status: 'OK', source: 'x', sha256: 'bukan-hash' }).expect(400);
    await report({ kind: 'DUMP', status: 'OK', source: 'x', tambahan: 1 }).expect(400); // bidang tak dikenal ditolak
    expect((await overview()).dump.state).toBe('NEVER');
  });

  it('hanya pemilik layanan yang melihat status', async () => {
    await http.get('/api/platform-admin/backups').set({ Authorization: `Bearer ${owner}` }).expect(403);
    await http.get('/api/platform-admin/backups').expect(401);
  });

  it('laporan sukses tercatat: status baik, ukuran, salinan di luar penyedia, riwayat', async () => {
    await report({ kind: 'DUMP', status: 'OK', source: 'github-actions', sizeBytes: 123456, sha256: 'a'.repeat(64), offsite: true, encrypted: true, durationSec: 12 }).expect(200);
    const o = await overview();
    expect(o.configured).toBe(true);
    expect(o.dump.state).toBe('OK');
    expect(o.dump.lastOk).toMatchObject({ sizeBytes: 123456, offsite: true, encrypted: true, source: 'github-actions' });
    expect(o.dump.ageHours).toBeLessThan(1);
    expect(o.restoreTest.state).toBe('NEVER');
    expect(o.history).toHaveLength(1);
  });

  it('gagal sesudah sukses: status GAGAL tetapi sukses terakhir tetap tampil; pulih setelah sukses lagi', async () => {
    await report({ kind: 'DUMP', status: 'FAILED', source: 'github-actions', note: 'pg_dump gagal: koneksi ditolak' }).expect(200);
    let o = await overview();
    expect(o.dump.state).toBe('FAILED');
    expect(o.dump.last.note).toContain('koneksi ditolak');
    expect(o.dump.lastOk.sizeBytes).toBe(123456);
    expect(o.history[0].status).toBe('FAILED');
    await report({ kind: 'DUMP', status: 'OK', source: 'github-actions', sizeBytes: 130000, offsite: true, encrypted: true }).expect(200);
    o = await overview();
    expect(o.dump.state).toBe('OK');
    expect(o.history).toHaveLength(3);
  });

  it('uji pemulihan dilaporkan terpisah dengan ringkasan isinya', async () => {
    await report({ kind: 'RESTORE_TEST', status: 'OK', source: 'github-actions', detail: { tables: 140, tenants: 3, users: 9 } }).expect(200);
    const o = await overview();
    expect(o.restoreTest.state).toBe('OK');
    expect(o.restoreTest.lastOk.detail).toEqual({ tables: 140, tenants: 3, users: 9 });
    expect(o.dump.state).toBe('OK'); // jenis lain tidak terpengaruh
  });

  it('backup basi terdeteksi dari waktu sukses terakhir, dan peringatan tidak diulang dalam 24 jam', async () => {
    const svc = app.get(BackupStatusService);
    expect(await svc.alertIfNeeded()).toBeNull(); // sehat: tidak ada peringatan
    const old = new Date(Date.now() - 50 * 3_600_000).toISOString();
    await db.execute(sql`UPDATE platform_settings SET value = jsonb_set(value, '{at}', to_jsonb(${old}::text)) WHERE key IN ('backup.last.DUMP', 'backup.lastOk.DUMP')`);
    const o = await overview();
    expect(o.dump.state).toBe('STALE');
    expect(o.dump.ageHours).toBeGreaterThan(49);
    expect(await svc.alertIfNeeded()).toContain('jam lalu');
    expect(await svc.alertIfNeeded()).toBeNull(); // sudah diperingatkan hari ini
  });

  it('pemeriksaan postur memuat status backup sebagai peringatan, bukan kegagalan kritis', async () => {
    const p = await app.get(SecurityPostureService).check();
    const c = p.checks.find((x) => x.key === 'backup-fresh')!;
    expect(c.severity).toBe('warning');
    expect(c.ok).toBe(false); // basi dari uji sebelumnya
    expect(c.detail).toContain('jam lalu');
    expect(p.ok).toBe(true);
  });
});
