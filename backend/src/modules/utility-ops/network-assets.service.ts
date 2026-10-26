import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ASSET_CONDITION_LABELS, WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ComplaintsRepository } from './complaints.repository';
import { NetworkAssetDto, WorkOrderDto, WorkOrderStatusDto } from './network-assets.dto';
import { NetworkAssetsRepository } from './network-assets.repository';
import { StaffRepository } from './staff.repository';

const WO_NEXT: Record<WorkOrderStatus, WorkOrderStatus[]> = { DIBUAT: ['DIKERJAKAN', 'BATAL'], DIKERJAKAN: ['SELESAI', 'BATAL'], SELESAI: [], BATAL: [] };

/** Aset jaringan (sumber, pompa, reservoir, pipa, valve, hidran) dan perintah kerja perawatan/perbaikannya */
@Injectable()
export class NetworkAssetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: NetworkAssetsRepository,
    private readonly complaints: ComplaintsRepository,
    private readonly staff: StaffRepository,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  assets(tenantId: string) { return this.repo.listAssets(this.db, tenantId); }
  summary(tenantId: string) { return this.repo.summary(this.db, tenantId).then((s) => ({ open: s?.open ?? 0, done30d: s?.done_30d ?? 0, cost30d: Number(s?.cost_30d ?? 0), brokenAssets: s?.broken_assets ?? 0, needCare: s?.need_care ?? 0 })); }

  async saveAsset(u: AuthUser, dto: NetworkAssetDto, id?: string) {
    const v = { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), type: dto.type, zone: dto.zone?.trim() || null, location: dto.location?.trim() || null, installedOn: dto.installedOn ?? null, condition: dto.condition ?? 'BAIK', note: dto.note?.trim() || null };
    try {
      let assetId = id;
      if (id) {
        if (!(await this.repo.updateAsset(this.db, u.tenantId, id, { ...v, isActive: dto.isActive ?? true }))) throw new NotFoundException('Aset tidak ditemukan');
      } else assetId = await this.repo.insertAsset(this.db, { tenantId: u.tenantId, ...v });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'UtilityNetworkAsset', entityId: assetId!, data: v });
      return { id: assetId };
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new BadRequestException('Kode aset sudah dipakai');
      throw e;
    }
  }

  orders(tenantId: string, q: { status?: string; assigneeId?: string; assetId?: string }) { return this.repo.listOrders(this.db, tenantId, { status: q.status || undefined, assigneeId: q.assigneeId || undefined, assetId: q.assetId || undefined }); }

  async createOrder(u: AuthUser, dto: WorkOrderDto) {
    if (dto.assetId && !(await this.repo.assetById(this.db, u.tenantId, dto.assetId))) throw new BadRequestException('Aset tidak ditemukan');
    if (dto.assigneeId && !(await this.staff.byId(this.db, u.tenantId, dto.assigneeId))) throw new BadRequestException('Petugas tidak ditemukan atau nonaktif');
    const complaint = dto.complaintId ? await this.complaints.byId(this.db, u.tenantId, dto.complaintId) : undefined;
    if (dto.complaintId && !complaint) throw new BadRequestException('Pengaduan tidak ditemukan');
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_WORK_ORDER', toDocDate(undefined));
      const id = await this.repo.insertOrder(tx, { tenantId: u.tenantId, number, assetId: dto.assetId ?? null, complaintId: dto.complaintId ?? null, type: dto.type, title: dto.title.trim(), description: dto.description?.trim() || null, priority: dto.priority ?? complaint?.priority ?? 'NORMAL', assigneeId: dto.assigneeId ?? null, plannedOn: dto.plannedOn ?? null, createdById: u.sub });
      if (complaint) {
        await this.complaints.linkWorkOrder(tx, u.tenantId, complaint.id, id);
        if (dto.assigneeId && ['BARU', 'DITUGASKAN'].includes(complaint.status)) await this.complaints.setAssignment(tx, u.tenantId, complaint.id, dto.assigneeId);
        await this.complaints.addEvent(tx, u.tenantId, complaint.id, { userId: u.sub, kind: 'TUGAS', note: `Perintah kerja ${number} dibuat` });
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityWorkOrder', entityId: id, data: { number, type: dto.type } });
      return { id, number };
    });
  }

  async setOrderStatus(u: AuthUser, id: string, dto: WorkOrderStatusDto) {
    const w = await this.repo.orderById(this.db, u.tenantId, id);
    if (!w) throw new NotFoundException('Perintah kerja tidak ditemukan');
    const from = w.status as WorkOrderStatus;
    if (!WO_NEXT[from].includes(dto.status)) throw new BadRequestException(`Dari "${WORK_ORDER_STATUS_LABELS[from]}" tidak bisa ke "${WORK_ORDER_STATUS_LABELS[dto.status]}"`);
    if (u.role === 'WAREHOUSE' && w.assigned_to_id !== u.sub) throw new ForbiddenException('Perintah kerja ini bukan ditugaskan kepada Anda');
    if (dto.status === 'DIKERJAKAN' && !w.assigned_to_id) throw new BadRequestException('Tugaskan ke petugas lebih dulu');
    if (dto.status === 'SELESAI' && (dto.result ?? '').trim().length < 5) throw new BadRequestException('Tulis hasil pekerjaan (minimal 5 huruf)');
    for (const c of [dto.laborCost, dto.materialCost]) if (c !== undefined && money(c).isNegative()) throw new BadRequestException('Biaya tidak boleh negatif');
    await this.db.transaction(async (tx) => {
      await this.repo.setOrderStatus(tx, u.tenantId, id, { status: dto.status, result: dto.result?.trim() ?? null, laborCost: dto.laborCost, materialCost: dto.materialCost });
      if (dto.status === 'SELESAI' && w.asset_id && dto.assetCondition) await this.repo.setCondition(tx, u.tenantId, w.asset_id, dto.assetCondition);
      if (w.complaint_id) {
        const c = await this.complaints.byId(tx, u.tenantId, w.complaint_id);
        if (c && dto.status === 'DIKERJAKAN' && c.status === 'DITUGASKAN') {
          await this.complaints.setStatus(tx, u.tenantId, c.id, 'DIKERJAKAN');
          await this.complaints.addEvent(tx, u.tenantId, c.id, { userId: u.sub, kind: 'STATUS', from: 'DITUGASKAN', to: 'DIKERJAKAN', note: `Perintah kerja ${w.number} dimulai` });
        } else if (c && dto.status === 'SELESAI' && ['DITUGASKAN', 'DIKERJAKAN'].includes(c.status)) {
          await this.complaints.setStatus(tx, u.tenantId, c.id, 'SELESAI', dto.result?.trim());
          await this.complaints.addEvent(tx, u.tenantId, c.id, { userId: u.sub, kind: 'STATUS', from: c.status, to: 'SELESAI', note: `Perintah kerja ${w.number} selesai: ${dto.result?.trim()}` });
        }
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityWorkOrder', entityId: id, data: { from, to: dto.status, assetCondition: dto.assetCondition ? ASSET_CONDITION_LABELS[dto.assetCondition] : undefined } });
    });
    return this.repo.orderById(this.db, u.tenantId, id);
  }
}
