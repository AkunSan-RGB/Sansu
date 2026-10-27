import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertProductionConfig, configureApp } from './bootstrap';
import { serveWeb } from './serve-web';
import { createPool } from './db/db';
import { describeDbError } from './db/db-error';
import { runMigrations } from './db/run-migrations';
import { createShedder, maxInflightFromEnv } from './common/load-shedder';

async function bootstrap() {
  assertProductionConfig();
  // Pastikan skema database selalu sesuai versi kode sebelum menerima permintaan
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    pool = createPool();
    await runMigrations(pool);
  } catch (e) {
    // Galat koneksi/migrasi ditulis jelas satu blok (tanpa password) lalu berhenti; tumpukan teknis menyusul di bawahnya
    Logger.error(`\n[X] API gagal start: database/migrasi bermasalah.\n${describeDbError(e)}`, 'Database');
    console.error(e);
    process.exit(1);
  } finally {
    await pool?.end().catch(() => undefined);
  }

  const app = configureApp(await NestFactory.create(AppModule, { bodyParser: false }));
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  // Di atas kapasitas, tolak kelebihannya dengan cepat (503 + Retry-After) daripada membuat semua permintaan lambat. Webhook masuk dan kesehatan dikecualikan.
  const shedder = createShedder({ max: maxInflightFromEnv(), exempt: (p) => p === '/api/health' || p.startsWith('/api/ingest/') });
  app.use(shedder.middleware);
  app.enableShutdownHooks();
  // Mode satu layanan: sajikan tampilan web dari frontend/dist bila ada (Railway dll.)
  const webServed = serveWeb(app);

  // Dokumentasi API hanya di pengembangan, kecuali diaktifkan eksplisit (SWAGGER=true)
  const swagger = process.env.NODE_ENV !== 'production' || process.env.SWAGGER === 'true';
  const config = new DocumentBuilder()
    .setTitle('SANSU API')
    .setDescription('SANSU — sistem bisnis terpadu untuk UKM dagang, ritel, jasa, FMCG, manufaktur, dan F&B: penjualan, pembelian, inventori, kasir, akuntansi, pajak, SDM')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  if (swagger) SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`${webServed ? 'Web + API' : 'API'} berjalan di http://localhost:${port}${webServed ? '' : '/api'}${swagger ? `  ·  Dokumentasi: http://localhost:${port}/api/docs` : ''}`);
}
// Jaring pengaman terakhir. Galat di tugas latar yang lolos dari .catch tidak boleh mematikan server yang sedang melayani pengguna:
// dicatat (terbaca di log/monitor) lalu server lanjut. Pengecualian yang tak tertangkap membuat keadaan proses tidak bisa dipercaya,
// jadi proses berhenti rapi agar dihidupkan ulang oleh pengelola proses (Railway/pm2/docker).
process.on('unhandledRejection', (reason) => {
  Logger.error(`Penolakan tak tertangani: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`, 'Proses');
});
process.on('uncaughtException', (e) => {
  Logger.error(`Pengecualian tak tertangkap, proses berhenti: ${e.stack ?? e.message}`, 'Proses');
  process.exit(1);
});

void bootstrap().catch((e) => {
  Logger.error(`API gagal start: ${(e as Error).stack ?? e}`, 'Proses');
  process.exit(1);
});
