import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ledgerCache } from '../modules/accounting/ledger-data';

/** Permintaan baca (GET) mendapat cache penjumlahan buku besar sendiri — hilang setelah respons */
@Injectable()
export class ReadCacheInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.switchToHttp().getRequest<{ method: string }>().method !== 'GET') return next.handle();
    return new Observable((sub) => ledgerCache.run(new Map(), () => next.handle().subscribe(sub)));
  }
}
