import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { INSTALLMENT_DEFAULT_DAYS, buildInstallments, installmentProgress } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { CancelPlanDto, DecidePlanDto, InstallmentPlanDto } from './installments.dto';
import { InstallmentsRepository, PlanRow } from './installments.repository';

/**
 * Angsuran tunggakan: tagihan yang sudah lewat jatuh tempo dicicil dalam beberapa kali. Diajukan satu orang, disetujui orang lain.
 * Selama angsuran terpenuhi usulan pemutusan ditahan; angsuran terlambat lebih dari beberapa hari membuat rencana macet.
 */
@Injectable()
export class InstallmentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: InstallmentsRepository,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  /** Tampilan satu rencana: jadwal dengan status tiap angsuran, dan status rencana yang dihitung dari pembayaran sebenarnya */
  private async view(tenantId: string, p: PlanRow) {
    const today = todayJakarta();
    const items = (await this.repo.items(this.db, p.id)).map((i) => ({ seq: i.seq, dueDate: i.due_date, amount: Number(i.amount) }));
    const progress = installmentProgress(items, Number(p.paid_since), today);
    let status = p.status;
    if (['AKTIF', 'MACET'].includes(p.status)) {
      const done = Number(p.paid_since) >= Number(p.total) - 0.5;
      const late = progress.some((x) => x.status === 'TERLAMBAT' && daysBetween(x.dueDate, today) > INSTALLMENT_DEFAULT_DAYS);
      status = done ? 'LUNAS' : late ? 'MACET' : 'AKTIF';
      if (status !== p.status) await this.repo.setStatus(this.db, tenantId, p.id, status);
    }
    return { ...p, status, items: progress, invoices: await this.repo.invoices(this.db, p.id), remaining: Math.max(0, Number(p.total) - Number(p.paid_since)) };
  }

  async list(tenantId: string, status?: string) {
    const rows = await this.repo.list(this.db, tenantId, status || undefined);
    const out = [];
    for (const r of rows) out.push(await this.view(tenantId, r));
    return status ? out.filter((x) => x.status === status) : out;
  }
  async get(tenantId: string, id: string) {
    const p = await this.repo.byId(this.db, tenantId, id);
    if (!p) throw new NotFoundException('Rencana angsuran tidak ditemukan');
    return this.view(tenantId, p);
  }
  coverable(tenantId: string, connectionId: string) { return this.repo.coverable(this.db, tenantId, connectionId); }

  async request(u: AuthUser, dto: InstallmentPlanDto) {
    const conn = await this.repo.connection(this.db, u.tenantId, dto.connectionId);
    if (!conn) throw new BadRequestException('Sambungan tidak ditemukan');
    if (dto.firstDue < todayJakarta()) throw new BadRequestException('Angsuran pertama tidak boleh di masa lalu');
    const coverable = await this.repo.coverable(this.db, u.tenantId, conn.id);
    const picked = dto.invoiceIds.map((id) => coverable.find((c) => c.id === id));
    if (picked.some((p) => !p)) throw new BadRequestException('Ada tagihan yang bukan tunggakan sambungan ini, sudah lunas, atau sudah masuk rencana angsuran lain');
    const chosen = picked as NonNullable<(typeof picked)[number]>[];
    const total = Math.round(chosen.reduce((a, c) => a + Number(c.open), 0) * 100) / 100;
    if (total < 1) throw new BadRequestException('Total tunggakan terlalu kecil untuk dicicil');
    const schedule = buildInstallments(total, dto.count, dto.firstDue, dto.intervalDays ?? 30);
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_INSTALLMENT', toDocDate(undefined));
      const id = await this.repo.insert(tx, { tenantId: u.tenantId, number, customerId: conn.customer_id, connectionId: conn.id, total: total.toFixed(2), note: dto.note?.trim() || null, requestedById: u.sub });
      await this.repo.addItems(tx, u.tenantId, id, schedule);
      for (const c of chosen) await this.repo.addInvoice(tx, u.tenantId, id, c.id, c.paid_at_start);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityInstallmentPlan', entityId: id, data: { number, total, count: dto.count } });
      return { id, number, total, schedule };
    });
  }

  async approve(u: AuthUser, id: string, dto: DecidePlanDto) {
    const p = await this.repo.byId(this.db, u.tenantId, id);
    if (!p) throw new NotFoundException('Rencana angsuran tidak ditemukan');
    if (p.status !== 'DIAJUKAN') throw new BadRequestException('Rencana ini sudah diputuskan');
    if (p.requested_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Rencana harus disetujui orang lain dari pengaju (pemisahan fungsi)');
    await this.repo.setStatus(this.db, u.tenantId, id, 'AKTIF', u.sub);
    if (dto.note?.trim()) await this.repo.setNote(this.db, u.tenantId, id, `${p.note ? `${p.note} · ` : ''}Persetujuan: ${dto.note.trim()}`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityInstallmentPlan', entityId: id, data: { number: p.number } });
    return this.get(u.tenantId, id);
  }

  async cancel(u: AuthUser, id: string, dto: CancelPlanDto) {
    const p = await this.repo.byId(this.db, u.tenantId, id);
    if (!p) throw new NotFoundException('Rencana angsuran tidak ditemukan');
    if (['LUNAS', 'BATAL'].includes(p.status)) throw new BadRequestException('Rencana ini sudah selesai');
    await this.repo.setStatus(this.db, u.tenantId, id, 'BATAL', u.sub);
    await this.repo.setNote(this.db, u.tenantId, id, `${p.note ? `${p.note} · ` : ''}Dibatalkan: ${dto.reason.trim()}`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'UtilityInstallmentPlan', entityId: id, data: { number: p.number, reason: dto.reason } });
    return this.get(u.tenantId, id);
  }
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
