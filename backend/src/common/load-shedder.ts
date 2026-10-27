import { Logger } from '@nestjs/common';
import { opsAlert } from './monitor/ops-alert';
import type { NextFunction, Request, Response } from 'express';

export interface ShedderOptions {
  /** permintaan yang boleh diproses bersamaan; 0 = tanpa batas */
  max: number;
  /** jalur yang tidak pernah ditolak (pemeriksaan kesehatan) */
  exempt?: (path: string) => boolean;
  retryAfterSeconds?: number;
}

export interface Shedder {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  stats: () => { inflight: number; shed: number; peak: number };
}

/**
 * Pembatas permintaan bersamaan. Di atas kapasitas, antrean tak berbatas hanya membuat SEMUA permintaan lambat (uji beban: p99 22 dtk
 * pada 1.500 pengguna). Lebih baik menolak kelebihannya dengan cepat (503 + Retry-After) agar yang sudah diterima tetap cepat dan
 * klien (peramban SANSU mengulang kueri baca otomatis dengan jeda) mencoba lagi sebentar kemudian.
 */
export function createShedder(opts: ShedderOptions): Shedder {
  const log = new Logger('Beban');
  let inflight = 0;
  let shed = 0;
  let peak = 0;
  let lastLog = 0;
  const retry = opts.retryAfterSeconds ?? 2;
  return {
    stats: () => ({ inflight, shed, peak }),
    middleware: (req, res, next) => {
      if (opts.max <= 0 || opts.exempt?.(req.path)) return next();
      if (inflight >= opts.max) {
        shed++;
        if (Date.now() - lastLog > 30_000) {
          lastLog = Date.now();
          log.warn(`Server sibuk: ${inflight} permintaan berjalan (batas ${opts.max}); ${shed} permintaan ditolak sejak start`);
          opsAlert('load-shed', `server kewalahan: ${inflight} permintaan berjalan (batas ${opts.max}), ${shed} ditolak sejak start`);
        }
        res.setHeader('Retry-After', String(retry));
        res.status(503).json({ statusCode: 503, message: 'Server sedang sibuk. Tidak ada data yang tersimpan; coba lagi sebentar lagi.', retryAfter: retry });
        return;
      }
      inflight++;
      peak = Math.max(peak, inflight);
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        inflight--;
      };
      res.once('finish', release);
      res.once('close', release);
      next();
    },
  };
}

/** Batas bawaan: ±2 detik antrean pada kapasitas terukur (±140 permintaan/dtk per proses). Nonaktif di tes kecuali diminta. */
export function maxInflightFromEnv(): number {
  const v = process.env.MAX_INFLIGHT;
  if (v !== undefined && v !== '') return Math.max(0, Number(v) || 0);
  return process.env.NODE_ENV === 'test' ? 0 : 300;
}
