import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { type Project } from '@sansu/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { invoices, projectProgress, projects } from '../../../db/schema';
import { frameworkOf } from '../../accounting/coa-sync';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { ProjectProgressDto, CreateProjectDto, UpdateProjectDto } from './service-billing.dto';
import { ServiceBillingService } from './service-billing.service';
import { CustomerDepositsService } from './customer-deposits.service';
import { insertOne, patchById } from '../../../db/owned';
import { ServiceProjectsRepository } from './service-projects.repository';
import { budgetUsage } from './service-limits';

@Injectable()
export class ServiceProjectsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly customerDeposits: CustomerDepositsService,
    private readonly repo: ServiceProjectsRepository,
  ) {}

  // ================= Proyek =================

  async listProjects(tenantId: string, id?: string): Promise<Project[]> {
    const rows = (
      await this.repo.queryProject(this.db, tenantId, id)
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      customerId: r.customer_id,
      customer: { code: r.customer_code, name: r.customer_name },
      contractValue: D(r.contract_value).toFixed(2),
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      notes: r.notes,
      billed: D(r.billed).toFixed(2),
      billedPct: D(r.contract_value).gt(0)
        ? Math.round(D(r.billed).div(r.contract_value).times(1000).toNumber()) / 10
        : 0,
      deposits: D(r.deposits).toFixed(2),
      depositsRemaining: D(r.deposits_remaining).toFixed(2),
      outstanding: D(r.outstanding).toFixed(2),
      progressPct: r.progress_pct == null ? null : Number(r.progress_pct),
      progressDate: r.progress_date,
      accrual: D(r.accrual).toFixed(2),
      directCost: D(r.direct_cost).toFixed(2),
      costBudget: D(r.cost_budget).toFixed(2),
      retentionPct: D(r.retention_pct).toFixed(2),
      retentionDays: r.retention_days,
      retentionHeld: D(r.retention_held).toFixed(2),
      budget: budgetUsage(r.direct_cost, r.cost_budget),
    }));
  }

  // ================= Kemajuan pekerjaan (SAK EP Bab 23) =================

  listProgress(tenantId: string, projectId: string) {
    return this.repo.listProjectProgressByProjectIdAndDateAndCreatedAtForListProgress(this.db, tenantId, projectId);
  }

  /**
   * Catat kemajuan pekerjaan per tanggal:
   *  pendapatan dihasilkan = nilai kontrak × % selesai; dibandingkan dengan DPP yang sudah ditagih s.d. tanggal itu.
   *  Lebih besar → Pendapatan Belum Ditagih (aset kontrak); lebih kecil → Pendapatan Diterima Dimuka (liabilitas kontrak).
   *  Jurnal hanya selisih terhadap posisi akrual sebelumnya.
   */
  async recordProgress(user: AuthUser, projectId: string, dto: ProjectProgressDto) {
    const date = toDocDate(dto.date);
    const pct = D(dto.percent);
    if (pct.lt(0) || pct.gt(100)) throw new BadRequestException('Persentase selesai harus 0–100');
    // ED SAK EMKM 14.5: pendapatan jasa/konstruksi diakui sebesar tagihan, bukan persentase penyelesaian
    if ((await frameworkOf(this.db, user.tenantId)) === 'SAK_EMKM')
      throw new BadRequestException(
        'SAK EMKM mengakui pendapatan sebesar jumlah tagihan; pengakuan berdasarkan persentase penyelesaian hanya untuk SAK EP. Tagih per termin.',
      );
    return this.db.transaction(async (tx) => {
      const lock = await this.repo.queryProjectForRecordProgress(tx, projectId, user.tenantId);
      if (!lock.rows.length) throw new NotFoundException('Proyek tidak ditemukan');
      const [p] = await this.repo.findProjectsById(tx, projectId);
      if (p.status === 'CANCELLED') throw new BadRequestException('Proyek dibatalkan');
      if (D(p.contractValue).lte(0)) throw new BadRequestException('Isi nilai kontrak proyek dulu');
      const prev = await this.repo.listProjectProgressByProjectIdAndDateAndCreatedAt(tx, projectId);
      if (prev[0] && date < prev[0].date)
        throw new BadRequestException(`Tanggal tidak boleh sebelum kemajuan terakhir (${prev[0].date})`);
      const before = prev.reduce<Dec>((a, r) => a.plus(r.adjustment), ZERO);
      const [b] = (
        await this.repo.queryInvoice(tx, projectId, date)
      ).rows;
      const billed = D(b.v);
      const earned = money(D(p.contractValue).times(pct).div(100));
      const after = earned.minus(billed);
      const adjustment = after.minus(before);

      // Akun pendapatan: yang paling sering dipakai di faktur proyek ini (mis. 4-2100 konstruksi), bawaan Pendapatan Jasa
      const [acc] = (
        await this.repo.queryServiceInvoiceLine(tx, projectId)
      ).rows;
      const revenueAccountId =
        acc?.account_id ?? (await this.billing.keyAccount(tx, user.tenantId, SYS.SERVICE_REVENUE));

      const number = await this.seq.next(tx, user.tenantId, 'PROJECT_PROGRESS', date);
      const row = await insertOne(tx, projectProgress, {
          tenantId: user.tenantId,
          number,
          projectId,
          date,
          percent: pct.toFixed(2),
          earned: earned.toFixed(2),
          billed: billed.toFixed(2),
          accrualBefore: before.toFixed(2),
          accrualAfter: after.toFixed(2),
          adjustment: adjustment.toFixed(2),
          revenueAccountId,
          notes: dto.notes,
          createdById: user.sub,
        });
      let journalNumber: string | null = null;
      if (!adjustment.isZero()) {
        const pos = (v: Dec) => (v.gt(0) ? v : ZERO);
        const dAsset = pos(after).minus(pos(before));
        const dLiab = pos(after.negated()).minus(pos(before.negated()));
        const journal = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description:
            `Kemajuan ${p.code} ${p.name}: ${pct.toString()}% (dihasilkan ${earned.toFixed(0)}, ditagih ${billed.toFixed(0)})`.slice(
              0,
              500,
            ),
          sourceType: 'PROJECT_PROGRESS',
          sourceId: row.id,
          createdById: user.sub,
          lines: [
            { key: SYS.UNBILLED_REVENUE, debit: pos(dAsset), credit: pos(dAsset.negated()) },
            { key: SYS.CONTRACT_LIABILITY, credit: pos(dLiab), debit: pos(dLiab.negated()) },
            { accountId: revenueAccountId, credit: pos(adjustment), debit: pos(adjustment.negated()) },
          ],
        });
        await patchById(tx, projectProgress, row.id, { journalId: journal.id });
        journalNumber = journal.number;
      }
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'ProjectProgress',
        entityId: row.id,
        data: { project: p.code, percent: pct.toString(), adjustment: adjustment.toFixed(2) },
      });
      return { ...row, journalNumber };
    });
  }

  /** Dipakai kontraktor: DPP yang sudah ditagih pada proyek */
  billedOf(tx: Tx, projectId: string) {
    return this.repo.queryInvoice(tx, projectId, '9999-12-31');
  }

  /** Dipakai kontraktor: samakan nilai kontrak dengan total BoQ */
  setContractValue(tx: Tx, projectId: string, value: Dec) {
    return patchById(tx, projects, projectId, { contractValue: money(value).toFixed(2) });
  }

  async getProject(tenantId: string, id: string) {
    const [p] = await this.listProjects(tenantId, id);
    if (!p) throw new NotFoundException('Proyek tidak ditemukan');
    const invs = await this.db.query.invoices.findMany({
      where: and(eq(invoices.tenantId, tenantId), eq(invoices.projectId, id)),
      with: { customer: { columns: { code: true, name: true } } },
      orderBy: [asc(invoices.date), asc(invoices.number)],
    });
    const deps = await this.customerDeposits.listDeposits(tenantId, { projectId: id });
    const progress = await this.listProgress(tenantId, id);
    const costs = (
      await this.repo.queryAccount(this.db, tenantId, id)
    ).rows.map((r) => ({
      source: r.source as 'BILL' | 'CASH' | 'PAYROLL' | 'JOURNAL',
      docId: r.doc_id,
      number: r.number,
      date: r.date,
      description: r.description,
      account: r.account,
      amount: D(r.amount).toFixed(2),
    }));
    return { ...p, invoices: invs, depositList: deps, progress, costs };
  }

  async createProject(user: AuthUser, dto: CreateProjectDto) {
    const [c] = await this.repo.findCustomersById(this.db, dto.customerId, user.tenantId);
    if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
    if (D(dto.contractValue).lt(0)) throw new BadRequestException('Nilai kontrak tidak boleh negatif');
    if (D(dto.costBudget ?? 0).lt(0)) throw new BadRequestException('Anggaran biaya tidak boleh negatif');
    if (D(dto.retentionPct ?? 0).lt(0) || D(dto.retentionPct ?? 0).gte(100)) throw new BadRequestException('Retensi harus di antara 0 dan 100%');
    const id = await this.db.transaction(async (tx) => {
      const code = dto.code?.trim() || (await this.seq.next(tx, user.tenantId, 'PROJECT', toDocDate(dto.startDate)));
      const [dup] = await this.repo.findProjectsByCode(tx, user.tenantId, code);
      if (dup) throw new BadRequestException(`Kode proyek ${code} sudah dipakai`);
      const [p] = await this.repo.insertProjects(tx, user.tenantId, code, dto);
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'Project',
        entityId: p.id,
        data: { code },
      });
      return p.id;
    });
    return this.getProject(user.tenantId, id);
  }

  async updateProject(user: AuthUser, id: string, dto: UpdateProjectDto) {
    const p = await this.getProject(user.tenantId, id);
    if (dto.contractValue !== undefined && D(dto.contractValue).gt(0) && D(dto.contractValue).lt(p.billed)) {
      throw new BadRequestException(`Nilai kontrak tidak boleh di bawah yang sudah ditagih (${p.billed})`);
    }
    if (dto.costBudget !== undefined && D(dto.costBudget).lt(0)) throw new BadRequestException('Anggaran biaya tidak boleh negatif');
    if (dto.retentionPct !== undefined && (D(dto.retentionPct).lt(0) || D(dto.retentionPct).gte(100))) throw new BadRequestException('Retensi harus di antara 0 dan 100%');
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.contractValue !== undefined) patch.contractValue = money(dto.contractValue).toFixed(2);
    if (dto.costBudget !== undefined) patch.costBudget = money(dto.costBudget).toFixed(2);
    if (dto.retentionPct !== undefined) patch.retentionPct = D(dto.retentionPct).toFixed(2);
    if (dto.retentionDays !== undefined) patch.retentionDays = dto.retentionDays;
    if (dto.endDate !== undefined) patch.endDate = toDocDate(dto.endDate);
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (Object.keys(patch).length) await patchById(this.db, projects, id, patch);
    await this.audit.log(this.db, {
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'UPDATE',
      entity: 'Project',
      entityId: id,
      data: dto,
    });
    return this.getProject(user.tenantId, id);
  }
}
