import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DbScope, dbScope } from '../../db/db-scope';
import { AuthUser } from '../auth/auth-user';

/**
 * Menjalankan penanganan setiap permintaan dalam lingkup database perusahaan penggunanya:
 * seluruh query di dalamnya dibatasi row-level security ke `tenantId` pengguna.
 * Permintaan tanpa pengguna (login, pendaftaran, tautan persetujuan, webhook) dan panel pemilik layanan
 * (`req.rlsBypass`, diset PlatformAdminGuard) berjalan tanpa penyaringan perusahaan.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; rlsBypass?: boolean }>();
    const scope: DbScope = req.user?.tenantId && !req.rlsBypass ? { tenantId: req.user.tenantId, bypass: false } : { bypass: true };
    return new Observable((sub) => dbScope.run(scope, () => next.handle().subscribe(sub)));
  }
}
