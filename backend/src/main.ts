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
bootstrap();
