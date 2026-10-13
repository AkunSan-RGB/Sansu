import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response, static as serveStatic } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Folder hasil build tampilan web (frontend/dist) yang disajikan langsung oleh API — mode "satu layanan"
 * (Railway dan sejenisnya): satu alamat, tanpa nginx, tanpa CORS. Aktif bila WEB_DIST diisi, atau otomatis
 * di produksi bila ../frontend/dist ada. Tidak aktif saat pengembangan (web berjalan sendiri lewat Vite).
 */
export function webDistDir(): string | undefined {
  const candidates = [process.env.WEB_DIST, process.env.NODE_ENV === 'production' ? resolve(process.cwd(), '../frontend/dist') : undefined];
  return candidates.find((d): d is string => !!d && existsSync(join(d, 'index.html')));
}

/** Pasang penyaji berkas statis + pengalihan rute SPA ke index.html. Mengembalikan false bila tidak ada tampilan web. */
export function serveWeb(app: INestApplication, dir = webDistDir()): boolean {
  if (!dir) return false;
  const ex = app as NestExpressApplication;
  const index = join(dir, 'index.html');
  ex.use(
    serveStatic(dir, {
      index: false,
      setHeaders: (res, path) => {
        // berkas ber-hash dari Vite boleh di-cache lama; index.html jangan
        if (path.includes(`${sep}assets${sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  ex.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next(); // API (termasuk 404-nya) tidak dialihkan
    if (/\.[a-z0-9]+$/i.test(req.path) || !req.accepts('html')) return next(); // berkas yang hilang: 404 sungguhan, bukan index.html
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return true;
}
