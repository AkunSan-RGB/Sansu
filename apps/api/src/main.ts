import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertProductionConfig, configureApp } from './bootstrap';
import { createPool } from './db/db';
import { runMigrations } from './db/run-migrations';

async function bootstrap() {
  assertProductionConfig();
  // Pastikan skema database selalu sesuai versi kode sebelum menerima permintaan
  const pool = createPool();
  await runMigrations(pool);
  await pool.end();

  const app = configureApp(await NestFactory.create(AppModule, { bodyParser: false }));
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  app.enableShutdownHooks();

  // Dokumentasi API hanya di pengembangan, kecuali diaktifkan eksplisit (SWAGGER=true)
  const swagger = process.env.NODE_ENV !== 'production' || process.env.SWAGGER === 'true';
  const config = new DocumentBuilder()
    .setTitle('SANSU API')
    .setDescription('SANSU — sistem bisnis terpadu untuk UKM dagang, ritel, jasa, produksi, dan manufaktur: penjualan, pembelian, inventori, kasir, akuntansi, pajak, SDM')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  if (swagger) SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API berjalan di http://localhost:${port}/api${swagger ? `  ·  Dokumentasi: http://localhost:${port}/api/docs` : ''}`);
}
bootstrap();
