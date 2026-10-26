import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AssignRouteDto, RouteDto } from './routes.dto';
import { RoutesRepository } from './routes.repository';
import { StaffRepository } from './staff.repository';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rute baca dan penagihan: membagi sambungan ke petugas baca meter dan kolektor, dengan progres pencatatan tiap rute */
@Injectable()
export class RoutesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: RoutesRepository,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, period?: string) {
    const p = period && PERIOD.test(period) ? period : todayJakarta().slice(0, 7);
    return this.repo.list(this.db, tenantId, p).then((rows) => ({ period: p, routes: rows.map((r) => ({ ...r, pct: r.metered ? Math.round((r.read / r.metered) * 100) : 100 })) }));
  }
  async stops(tenantId: string, routeId: string, period?: string) {
    const p = period && PERIOD.test(period) ? period : todayJakarta().slice(0, 7);
    if (!(await this.repo.byId(this.db, tenantId, routeId))) throw new NotFoundException('Rute tidak ditemukan');
    return { period: p, stops: await this.repo.stops(this.db, tenantId, routeId, p) };
  }
  unassigned(tenantId: string, q = '') { return this.repo.unassigned(this.db, tenantId, q); }

  async save(u: AuthUser, dto: RouteDto, id?: string) {
    for (const who of [dto.readerId, dto.collectorId]) if (who && !(await this.staff.byId(this.db, u.tenantId, who))) throw new BadRequestException('Petugas tidak ditemukan atau nonaktif');
    const v = { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), readerId: dto.readerId ?? null, collectorId: dto.collectorId ?? null, zone: dto.zone?.trim() || null };
    try {
      let rid = id;
      if (id) {
        if (!(await this.repo.update(this.db, u.tenantId, id, { ...v, isActive: dto.isActive ?? true }))) throw new NotFoundException('Rute tidak ditemukan');
      } else rid = await this.repo.insert(this.db, { tenantId: u.tenantId, ...v });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'UtilityRoute', entityId: rid!, data: v });
      return { id: rid };
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new BadRequestException('Kode rute sudah dipakai');
      throw e;
    }
  }

  async assign(u: AuthUser, dto: AssignRouteDto) {
    if (dto.routeId && !(await this.repo.byId(this.db, u.tenantId, dto.routeId))) throw new BadRequestException('Rute tidak ditemukan');
    await this.repo.assign(this.db, u.tenantId, dto.routeId ?? null, dto.connectionIds);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityRoute', entityId: dto.routeId ?? u.tenantId, data: { assigned: dto.connectionIds.length } });
    return { ok: true, count: dto.connectionIds.length };
  }
}
