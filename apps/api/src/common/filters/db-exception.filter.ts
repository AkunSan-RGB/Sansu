import { ArgumentsHost, Catch, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { ErrorMonitor } from '../monitor/error-monitor';

interface PgError {
  code: string;
  detail?: string;
  constraint?: string;
}

/** Cari error PostgreSQL asli (Drizzle membungkusnya di `cause`). */
function pgError(e: unknown): PgError | undefined {
  let cur: any = e;
  for (let i = 0; i < 3 && cur; i++) {
    if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur;
    cur = cur.cause;
  }
  return undefined;
}

/** Ubah error database menjadi respons HTTP yang jelas; selain itu serahkan ke filter bawaan Nest. */
@Catch()
export class DbExceptionFilter extends BaseExceptionFilter {
  constructor(@Optional() private readonly monitor?: ErrorMonitor) {
    super();
  }

  /** Catat error 5xx ke monitor (tabel error_logs + peringatan) */
  private report(exception: unknown, host: ArgumentsHost, status: number) {
    if (!this.monitor || status < 500 || host.getType() !== 'http') return;
    const req = host.switchToHttp().getRequest<Request & { user?: { sub?: string; tenantId?: string } }>();
    this.monitor.record({
      status,
      method: req.method,
      path: req.originalUrl ?? req.url,
      error: exception,
      tenantId: req.user?.tenantId,
      userId: req.user?.sub,
    });
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      this.report(exception, host, exception.getStatus());
      return super.catch(exception, host);
    }
    const res = host.switchToHttp().getResponse<Response>();
    const msg = exception instanceof Error ? exception.message : '';
    // Kesalahan input yang terdeteksi di lapisan bawah → 400, bukan 500
    if (msg === 'No values to set')
      return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Tidak ada data yang diubah' });
    if (msg.startsWith('Tanggal tidak valid'))
      return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: msg });

    const pg = pgError(exception);
    if (!pg) {
      this.report(exception, host, 500);
      return super.catch(exception, host);
    }

    switch (pg.code) {
      case '23505':
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          message: `Data duplikat (${pg.constraint ?? 'unik'})`,
          // detail berisi nilai mentah dari database — jangan dikirim ke klien di produksi
          ...(process.env.NODE_ENV === 'production' ? {} : { detail: pg.detail }),
        });
      case '23503':
        return res
          .status(HttpStatus.BAD_REQUEST)
          .json({ statusCode: 400, message: 'Data masih dipakai atau referensi tidak valid' });
      case '22P02':
        return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Format data tidak valid' });
      default:
        this.report(exception, host, 500);
        return super.catch(exception, host);
    }
  }
}
