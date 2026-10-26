import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_NEXT, COMPLAINT_STATUS_LABELS, complaintDueAt, type ComplaintStatus } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AssignDto, ComplaintDto, ComplaintStatusDto, NoteDto } from './complaints.dto';
import { ComplaintsRepository } from './complaints.repository';
import { StaffRepository } from './staff.repository';

/** Pengaduan pelanggan dan gangguan layanan: tiket berbatas waktu, ditugaskan ke petugas, ditutup oleh orang lain dari pelaksananya */
@Injectable()
export class ComplaintsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: ComplaintsRepository,
    private readonly staff: StaffRepository,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, q: { status?: string; assigneeId?: string; q?: string; open?: string }) {
    return this.repo.list(this.db, tenantId, { status: q.status || undefined, assigneeId: q.assigneeId || undefined, q: q.q, open: q.open === undefined || q.open === '' ? undefined : q.open === 'true' });
  }

  async summary(tenantId: string) {
    const s = await this.repo.summary(this.db, tenantId);
    return { open: s?.open ?? 0, baru: s?.baru ?? 0, overdue: s?.overdue ?? 0, done30d: s?.done_30d ?? 0, onTimePct30d: s && s.done_30d > 0 ? Math.round((s.on_time_30d / s.done_30d) * 100) : null, avgHours30d: s?.avg_hours_30d == null ? null : Math.round(Number(s.avg_hours_30d) * 10) / 10 };
  }

  async get(tenantId: string, id: string) {
    const c = await this.repo.byId(this.db, tenantId, id);
    if (!c) throw new NotFoundException('Pengaduan tidak ditemukan');
    return { ...c, events: await this.repo.events(this.db, tenantId, id) };
  }

  async create(u: AuthUser, dto: ComplaintDto) {
    let customerId = dto.customerId ?? null;
    if (dto.connectionId) {
      const conn = await this.staff.connection(this.db, u.tenantId, dto.connectionId);
      if (!conn) throw new BadRequestException('Sambungan tidak ditemukan');
      customerId = conn.customer_id;
    } else if (customerId && !(await this.staff.customer(this.db, u.tenantId, customerId))) {
      throw new BadRequestException('Pelanggan tidak ditemukan');
    }
    if (!customerId && !(dto.reporterName ?? '').trim()) throw new BadRequestException('Isi nama pelapor atau pilih pelanggan/sambungan');
    const priority = dto.priority ?? (dto.category === 'PIPA_BOCOR' || dto.category === 'AIR_MATI' ? 'TINGGI' : 'NORMAL');
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_COMPLAINT', toDocDate(undefined));
      const id = await this.repo.insert(tx, {
        tenantId: u.tenantId, number, connectionId: dto.connectionId ?? null, customerId, reporterName: dto.reporterName?.trim() || null, reporterPhone: dto.reporterPhone?.trim() || null,
        category: dto.category, priority, channel: dto.channel ?? 'TELEPON', description: dto.description.trim(), location: dto.location?.trim() || null, dueAt: complaintDueAt(dto.category, priority, new Date()), createdById: u.sub,
      });
      await this.repo.addEvent(tx, u.tenantId, id, { userId: u.sub, kind: 'STATUS', to: 'BARU', note: `${COMPLAINT_CATEGORY_LABELS[dto.category]} dicatat` });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityComplaint', entityId: id, data: { number, category: dto.category } });
      return { id, number };
    });
  }

  async assign(u: AuthUser, id: string, dto: AssignDto) {
    const c = await this.repo.byId(this.db, u.tenantId, id);
    if (!c) throw new NotFoundException('Pengaduan tidak ditemukan');
    if (!['BARU', 'DITUGASKAN'].includes(c.status)) throw new BadRequestException('Pengaduan yang sudah dikerjakan tidak dapat ditugaskan ulang');
    const who = await this.staff.byId(this.db, u.tenantId, dto.assigneeId);
    if (!who) throw new BadRequestException('Petugas tidak ditemukan atau nonaktif');
    await this.db.transaction(async (tx) => {
      await this.repo.setAssignment(tx, u.tenantId, id, who.id);
      await this.repo.addEvent(tx, u.tenantId, id, { userId: u.sub, kind: 'TUGAS', from: c.status, to: 'DITUGASKAN', note: `Ditugaskan ke ${who.name}${dto.note ? ` — ${dto.note}` : ''}` });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'ASSIGN', entity: 'UtilityComplaint', entityId: id, data: { assignee: who.name } });
    });
    return this.get(u.tenantId, id);
  }

  async setStatus(u: AuthUser, id: string, dto: ComplaintStatusDto) {
    const c = await this.repo.byId(this.db, u.tenantId, id);
    if (!c) throw new NotFoundException('Pengaduan tidak ditemukan');
    const from = c.status as ComplaintStatus;
    if (!COMPLAINT_NEXT[from]?.includes(dto.status)) throw new BadRequestException(`Dari "${COMPLAINT_STATUS_LABELS[from]}" tidak bisa langsung ke "${COMPLAINT_STATUS_LABELS[dto.status]}"`);
    if (dto.status === 'DITUGASKAN') throw new BadRequestException('Gunakan penugasan untuk memilih petugas');
    // petugas lapangan hanya mengerjakan tiket yang ditugaskan kepadanya
    if (u.role === 'WAREHOUSE' && ['DIKERJAKAN', 'SELESAI'].includes(dto.status) && c.assigned_to_id !== u.sub) throw new ForbiddenException('Tiket ini bukan ditugaskan kepada Anda');
    if (dto.status === 'DIKERJAKAN' && !c.assigned_to_id) throw new BadRequestException('Tugaskan ke petugas lebih dulu');
    if (dto.status === 'SELESAI' && (dto.resolution ?? '').trim().length < 5) throw new BadRequestException('Tulis apa yang sudah dikerjakan (minimal 5 huruf)');
    // pemisahan fungsi: yang menutup (menerima hasil) bukan yang mengerjakan, kecuali Pemilik
    if (dto.status === 'DITUTUP' && c.assigned_to_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Penutupan harus oleh orang lain dari petugas pelaksana (pemisahan fungsi)');
    await this.db.transaction(async (tx) => {
      await this.repo.setStatus(tx, u.tenantId, id, dto.status, dto.resolution?.trim());
      await this.repo.addEvent(tx, u.tenantId, id, { userId: u.sub, kind: 'STATUS', from, to: dto.status, note: dto.note ?? dto.resolution ?? null });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityComplaint', entityId: id, data: { from, to: dto.status } });
    });
    return this.get(u.tenantId, id);
  }

  async addNote(u: AuthUser, id: string, dto: NoteDto) {
    const c = await this.repo.byId(this.db, u.tenantId, id);
    if (!c) throw new NotFoundException('Pengaduan tidak ditemukan');
    await this.repo.addEvent(this.db, u.tenantId, id, { userId: u.sub, kind: 'CATATAN', note: dto.note.trim() });
    return this.get(u.tenantId, id);
  }
}
