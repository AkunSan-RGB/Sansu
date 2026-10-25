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
  // Header keamanan. CSP sama dengan yang dipasang Caddy pada instalasi VPS, sehingga mode satu layanan (Railway) mendapat perlindungan yang sama.
  // Dokumentasi API (Swagger, hanya bila diaktifkan) memakai skrip sebaris sehingga dikecualikan dari CSP.
  const withCsp = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], // gaya sebaris diperlukan Ant Design
        'font-src': ["'self'", 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
  });
  const withoutCsp = helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  // helmet bertipe Express sedangkan app.use menerima tipe Nest generik; tipenya sama saat jalan
  app.use((req: { path: string }, res: unknown, next: () => void) => (req.path.startsWith('/api/docs') ? withoutCsp : withCsp)(req as never, res as never, next));
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

const WEAK = /ganti|changeme|secret|rahasia|password|contoh|example|sansu-dev-key/i;

/** Masalah konfigurasi produksi yang membuat data pelanggan tidak aman (kosong = aman). Dipisah agar bisa diuji. */
export function productionConfigProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32 || /ganti|changeme|secret|rahasia/i.test(secret)) problems.push('JWT_SECRET harus acak dan minimal 32 karakter');
  const dek = env.DATA_ENCRYPTION_KEY ?? '';
  if (!dek) problems.push('DATA_ENCRYPTION_KEY wajib diisi (kunci enkripsi token pihak ketiga). Buat dengan: openssl rand -base64 48');
  else if (dek.length < 32 || WEAK.test(dek)) problems.push('DATA_ENCRYPTION_KEY harus acak dan minimal 32 karakter');
  else if (dek === secret) problems.push('DATA_ENCRYPTION_KEY harus berbeda dari JWT_SECRET');
  if (/ganti|akurata:akurata@|sansu:sansu@/i.test(env.DATABASE_URL ?? '')) problems.push('Password database masih bawaan contoh');
  return problems;
}

/** Tolak berjalan di produksi dengan rahasia lemah / bawaan contoh. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems = productionConfigProblems(process.env);
  if (problems.length) {
    for (const p of problems) Logger.error(p, 'Konfigurasi');
    throw new Error('Konfigurasi produksi tidak aman — perbaiki file .env lalu jalankan ulang.');
  }
}
