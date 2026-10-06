import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/** Konfigurasi aplikasi yang dipakai bersama oleh main.ts dan test e2e. */
export function configureApp(app: INestApplication) {
  const ex = app as NestExpressApplication;
  // Di balik proxy (Caddy → nginx → API): percayai proxy di jaringan privat agar IP klien asli terbaca
  ex.set('trust proxy', 'loopback, linklocal, uniquelocal');
  ex.disable('x-powered-by');
  // Impor mutasi bank / pesanan marketplace bisa besar
  ex.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '20mb' });
  ex.useBodyParser('urlencoded', { limit: process.env.BODY_LIMIT ?? '20mb', extended: true });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  return app;
}

/** Tolak berjalan di produksi dengan rahasia lemah / bawaan contoh. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32 || /ganti|changeme|secret|rahasia/i.test(secret)) problems.push('JWT_SECRET harus acak dan minimal 32 karakter');
  if (/ganti|akurata:akurata@|sansu:sansu@/i.test(process.env.DATABASE_URL ?? '')) problems.push('Password database masih bawaan contoh');
  if (problems.length) {
    for (const p of problems) Logger.error(p, 'Konfigurasi');
    throw new Error('Konfigurasi produksi tidak aman — perbaiki file .env lalu jalankan ulang.');
  }
}
