import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { VISIT_OUTCOME_LABELS, whatsappLink } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { VisitDto } from './collection.dto';
import { CollectionRepository } from './collection.repository';

/** Penagihan lapangan: daftar kunjungan kolektor per rute, hasil kunjungan, dan janji bayar yang dipantau */
@Injectable()
export class CollectionService {
  constructor(@InjectDb() private readonly db: Db, private readonly repo: CollectionRepository, private readonly audit: AuditService) {}

  /** Petugas lapangan hanya melihat rutenya sendiri; peran lain boleh menyaring per petugas */
  private scope(u: AuthUser, collectorId?: string) { return u.role === 'WAREHOUSE' ? u.sub : collectorId || undefined; }

  async worklist(u: AuthUser, f: { collectorId?: string; routeId?: string; q?: string }) {
    const today = todayJakarta();
    const rows = await this.repo.worklist(this.db, u.tenantId, today, { ...f, collectorId: this.scope(u, f.collectorId), routeId: f.routeId || undefined });
    return rows.map((r) => {
      const promise = r.last_outcome === 'JANJI_BAYAR' && r.promised_on ? (r.promised_on < today ? 'INGKAR' : 'MENUNGGU') : null;
      const msg = `Yth. ${r.customer}, tagihan air sambungan ${r.number} sebesar Rp${Math.round(Number(r.outstanding)).toLocaleString('id-ID')} sudah lewat jatuh tempo ${r.days_late} hari. Mohon segera dilunasi di loket atau kolektor kami.`;
      return { ...r, promise, whatsapp: whatsappLink(r.phone, msg) };
    });
  }
  async summary(u: AuthUser, collectorId?: string) {
    const s = await this.repo.summary(this.db, u.tenantId, todayJakarta(), this.scope(u, collectorId));
    return { visitsToday: s?.visits_today ?? 0, promisesToday: s?.promises_today ?? 0, broken: s?.broken ?? 0, overdueConnections: s?.overdue_connections ?? 0, overdueAmount: Number(s?.overdue_amount ?? 0) };
  }
  visits(u: AuthUser, connectionId?: string) { return this.repo.visits(this.db, u.tenantId, { connectionId: connectionId || undefined, collectorId: u.role === 'WAREHOUSE' ? u.sub : undefined }); }

  async record(u: AuthUser, dto: VisitDto) {
    const c = await this.repo.connectionWithCollector(this.db, u.tenantId, dto.connectionId);
    if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
    if (u.role === 'WAREHOUSE' && c.collector_id !== u.sub) throw new ForbiddenException('Sambungan ini bukan di rute penagihan Anda');
    const today = todayJakarta();
    let promisedOn: string | null = null;
    if (dto.outcome === 'JANJI_BAYAR') {
      if (!dto.promisedOn) throw new BadRequestException('Isi tanggal janji bayar');
      if (dto.promisedOn < today) throw new BadRequestException('Tanggal janji bayar tidak boleh sudah lewat');
      if (dto.promisedOn > addDays(today, 30)) throw new BadRequestException('Janji bayar paling lama 30 hari ke depan; untuk waktu lebih panjang buat angsuran tunggakan');
      promisedOn = dto.promisedOn;
    }
    if (dto.outcome === 'LAINNYA' && !(dto.note ?? '').trim()) throw new BadRequestException('Tulis catatan untuk hasil "Lainnya"');
    if (dto.promisedAmount && dto.promisedAmount > Number(c.outstanding) + 0.5) throw new BadRequestException('Jumlah janji melebihi tunggakan');
    const id = await this.repo.insert(this.db, { tenantId: u.tenantId, connectionId: dto.connectionId, collectorId: u.sub, outcome: dto.outcome, promisedOn, promisedAmount: promisedOn ? dto.promisedAmount ?? null : null, note: dto.note?.trim() || null, lat: dto.lat ?? null, lng: dto.lng ?? null });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityCollectionVisit', entityId: id, data: { connection: c.number, outcome: VISIT_OUTCOME_LABELS[dto.outcome] } });
    return { id };
  }
}
