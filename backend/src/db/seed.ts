/**
 * Data demo: perusahaan distributor yang sudah beroperasi sejak 1 Januari sampai hari ini.
 * Seluruh transaksi dibuat lewat service aplikasi (bukan insert mentah) agar jurnal, kartu stok,
 * dan semua laporan konsisten. Login demo: admin@demo.id / demo12345
 *
 * Data demo versi lama otomatis diganti dengan versi baru (hanya perusahaan demo; perusahaan lain tidak disentuh).
 * Paksa buat ulang: npm run db:seed -- --reset
 */
import 'dotenv/config';
import { describeDbError } from './db-error';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { AppsService } from '../common/apps/apps.service';
import { AuthService } from '../modules/auth/auth.service';
import { DB, Db } from './db';
import { DEMO_VERSION, simulateDemoYear } from './demo/simulate';
import { removeTenant } from './remove-tenant';
import { crmActivities, crmStages, customers, leads, tenants, users } from './schema';
import { Logger } from '@nestjs/common';

const log = new Logger('Seed');

const DEMO_EMAIL = 'admin@demo.id';

async function main() {
  const force = process.argv.includes('--reset');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);

  const [exists] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (exists) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, exists.tenantId));
    const version = (t?.settings as { demo?: { version?: number } })?.demo?.version;
    if (version === DEMO_VERSION && !force) {
      log.log('Data demo sudah ada — dilewati.');
      await app.close();
      return;
    }
    log.log('Memperbarui data demo ke versi terbaru (transaksi 1 Januari s/d hari ini)…');
    await removeTenant(db, exists.tenantId);
  } else {
    log.log('Membuat data demo: transaksi 1 Januari s/d hari ini…');
  }
  log.log('Mohon tunggu, ini bisa memakan waktu beberapa menit (hanya sekali).');

  const t0 = Date.now();
  const reg = await app.get(AuthService).register({
    companyName: 'CV Demo Distribusi Nusantara',
    name: 'Admin Demo',
    email: DEMO_EMAIL,
    password: 'demo12345',
  });
  if ('verificationRequired' in reg) throw new Error('Seed demo butuh email non-aktif (kosongkan BREVO_API_KEY/SMTP_HOST) agar akun demo langsung bisa masuk');
  const { user } = reg;
  const admin = { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email };
  await ensureDemoUsers(app, db, user.tenantId);
  await simulateDemoYear(app, db, admin, (m) => log.log(m));
  await ensureCrm(db, user.tenantId, user.id);
  log.log(`Data demo dibuat dalam ${Math.round((Date.now() - t0) / 1000)} detik. Login: ${DEMO_EMAIL} / demo12345`);
  await app.close();
}


/** Aplikasi tambahan aktif + pengguna kasir & HRD demo */
async function ensureDemoUsers(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, db: Db, tenantId: string) {
  const apps = app.get(AppsService);
  for (const k of ['pos', 'crm', 'payroll'] as const) await apps.install(tenantId, k);
  for (const u of [
    { email: 'kasir@demo.id', name: 'Kasir Demo', role: 'CASHIER' as const },
    { email: 'hrd@demo.id', name: 'HRD Demo', role: 'HR' as const },
  ]) {
    await db.delete(users).where(eq(users.email, u.email));
    await db.insert(users).values({ ...u, tenantId, passwordHash: await bcrypt.hash('demo12345', 10) });
  }
}

/** Pipeline CRM demo */
async function ensureCrm(db: Db, tenantId: string, ownerId: string) {
  const stages = await db
    .insert(crmStages)
    .values([
      { tenantId, name: 'Prospek baru', sequence: 1, probability: 10 },
      { tenantId, name: 'Sudah dihubungi', sequence: 2, probability: 25 },
      { tenantId, name: 'Penawaran dikirim', sequence: 3, probability: 50 },
      { tenantId, name: 'Negosiasi', sequence: 4, probability: 75 },
    ])
    .returning();
  const [cust] = await db.select().from(customers).where(eq(customers.tenantId, tenantId)).limit(1);
  const created = await db
    .insert(leads)
    .values([
      { tenantId, title: 'Toko Berkah Jaya — pasok mi & minuman', contactName: 'Bu Ani', phone: '0812-7000-1111', companyName: 'Toko Berkah Jaya', source: 'Kunjungan sales', expectedRevenue: '12000000', stageId: stages[0].id, probability: 10, ownerId },
      { tenantId, title: 'Minimarket Lancar — sabun & minyak', contactName: 'Pak Rudi', phone: '0813-7000-2222', companyName: 'Minimarket Lancar', source: 'Referensi', expectedRevenue: '25000000', stageId: stages[1].id, probability: 25, ownerId },
      { tenantId, title: 'Koperasi Karyawan PT Sinar — paket sembako', contactName: 'Bu Lina', phone: '0815-7000-3333', companyName: 'Koperasi Sinar', source: 'Pameran', expectedRevenue: '40000000', stageId: stages[2].id, probability: 50, ownerId },
      { tenantId, title: 'Repeat order kopi sachet', customerId: cust?.id, expectedRevenue: '8000000', stageId: stages[3].id, probability: 75, ownerId },
    ])
    .returning();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  await db.insert(crmActivities).values([
    { tenantId, leadId: created[0].id, type: 'CALL', summary: 'Telepon perkenalan & kirim katalog', dueDate: today, userId: ownerId },
    { tenantId, leadId: created[1].id, type: 'MEETING', summary: 'Kunjungan ke toko, bawa sampel', dueDate: today, userId: ownerId },
    { tenantId, leadId: created[2].id, type: 'WHATSAPP', summary: 'Follow-up penawaran paket sembako', dueDate: today, userId: ownerId },
  ]);
}

main().catch((e) => {
  console.error('\n[X] Pengisian data demo gagal.\n' + describeDbError(e));
  process.exit(1);
});
