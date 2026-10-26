import { BadRequestException, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { COMPLAINT_CATEGORY_LABELS, complaintDueAt } from '@sansu/shared';
import { randomBytes } from 'node:crypto';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ComplaintsRepository } from './complaints.repository';
import { PortalComplaintDto } from './portal.dto';
import { PortalRepository } from './portal.repository';
import { StaffRepository } from './staff.repository';

export interface PortalScope { tenantId: string; connectionId: string; tokenId: string }

/** Mengubah token di alamat portal menjadi lingkup (perusahaan + sambungan); tanpa login, hanya untuk satu sambungan */
@Injectable()
export class UtilityPortalGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Db, private readonly repo: PortalRepository, private readonly apps: AppsService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ params: { token?: string }; portal?: PortalScope }>();
    const token = req.params.token ?? '';
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new UnauthorizedException('Tautan tidak valid');
    const t = await this.repo.byToken(this.db, token);
    if (!t) throw new UnauthorizedException('Tautan tidak valid atau sudah dicabut');
    if (!(await this.apps.isEnabled(t.tenant_id, ['utility']))) throw new HttpException('Layanan belum aktif', HttpStatus.FORBIDDEN);
    req.portal = { tenantId: t.tenant_id, connectionId: t.connection_id, tokenId: t.id };
    return true;
  }
}

/** Portal pelanggan: tautan pribadi (tanpa kata sandi) untuk melihat tagihan, riwayat pemakaian, dan mengirim pengaduan */
@Injectable()
export class PortalService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: PortalRepository,
    private readonly complaints: ComplaintsRepository,
    private readonly staff: StaffRepository,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ---- sisi petugas ----
  async link(tenantId: string, connectionId: string) {
    const t = await this.repo.byConnection(this.db, tenantId, connectionId);
    return t ? { exists: true, revoked: t.revoked, token: t.revoked ? null : t.token, lastUsedAt: t.last_used_at, createdAt: t.created_at } : { exists: false, revoked: false, token: null, lastUsedAt: null, createdAt: null };
  }
  async issue(u: AuthUser, connectionId: string) {
    if (!(await this.staff.connection(this.db, u.tenantId, connectionId))) throw new NotFoundException('Sambungan tidak ditemukan');
    const token = randomBytes(18).toString('base64url');
    await this.repo.upsert(this.db, u.tenantId, connectionId, token);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityPortalLink', entityId: connectionId, data: {} });
    return this.link(u.tenantId, connectionId);
  }
  async revoke(u: AuthUser, connectionId: string) {
    await this.repo.revoke(this.db, u.tenantId, connectionId);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'DELETE', entity: 'UtilityPortalLink', entityId: connectionId, data: {} });
    return this.link(u.tenantId, connectionId);
  }

  // ---- sisi pelanggan ----
  async view(s: PortalScope) {
    const c = await this.repo.connectionInfo(this.db, s.tenantId, s.connectionId);
    if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
    const [bills, usage, counters, complaints] = await Promise.all([
      this.repo.openBills(this.db, s.tenantId, s.connectionId), this.repo.usage(this.db, s.tenantId, s.connectionId), this.repo.counters(this.db, s.tenantId), this.repo.complaints(this.db, s.tenantId, s.connectionId),
    ]);
    await this.repo.touch(this.db, s.tokenId);
    const outstanding = (bills as { outstanding: string }[]).reduce((a, b) => a + Number(b.outstanding), 0);
    return { connection: { number: c.number, address: c.address, status: c.status, customer: c.customer, tariff: c.tariff, meterNo: c.meter_no, zone: c.zone }, company: { name: c.company, address: c.company_address }, outstanding, bills, usage, counters, complaints };
  }
  async complain(s: PortalScope, dto: PortalComplaintDto) {
    // batas wajar agar tautan yang bocor tidak dipakai membanjiri tiket
    if ((await this.repo.openFromPortal(this.db, s.tenantId, s.connectionId)) >= 3) throw new BadRequestException('Ada 3 pengaduan Anda yang masih diproses. Mohon tunggu penanganannya.');
    const conn = await this.staff.connection(this.db, s.tenantId, s.connectionId);
    if (!conn) throw new NotFoundException('Sambungan tidak ditemukan');
    const priority = dto.category === 'PIPA_BOCOR' || dto.category === 'AIR_MATI' ? 'TINGGI' : 'NORMAL';
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, s.tenantId, 'UTILITY_COMPLAINT', toDocDate(undefined));
      const id = await this.complaints.insert(tx, {
        tenantId: s.tenantId, number, connectionId: s.connectionId, customerId: conn.customer_id, reporterName: null, reporterPhone: dto.phone?.trim() || null, category: dto.category, priority, channel: 'PORTAL',
        description: dto.description.trim(), location: conn.address, dueAt: complaintDueAt(dto.category, priority, new Date()), createdById: null,
      });
      await this.complaints.addEvent(tx, s.tenantId, id, { userId: null, kind: 'STATUS', to: 'BARU', note: `${COMPLAINT_CATEGORY_LABELS[dto.category]} dikirim lewat portal pelanggan` });
      await this.audit.log(tx, { tenantId: s.tenantId, action: 'CREATE', entity: 'UtilityComplaint', entityId: id, data: { number, channel: 'PORTAL' } });
      return { number };
    });
  }
}
