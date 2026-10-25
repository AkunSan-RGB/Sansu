import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { type Project } from '@sansu/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, invoices, projectProgress, projects } from '../../../db/schema';
import { frameworkOf } from '../../accounting/coa-sync';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { projectCostsSql } from './project-costs';
import { ProjectProgressDto, CreateProjectDto, UpdateProjectDto } from './service-billing.dto';
import { ServiceBillingService } from './service-billing.service';
import { CustomerDepositsService } from './customer-deposits.service';
import { insertOne, patchById } from '../../../db/owned';

@Injectable()
export class ServiceProjectsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly customerDeposits: CustomerDepositsService,
  ) {}

  // ================= Proyek =================

  async listProjects(tenantId: string, id?: string): Promise<Project[]> {
    const rows = (
      await this.db.execute<{
        id: string;
        code: string;
        name: string;
        customer_id: string;
        customer_code: string;
        customer_name: string;
        contract_value: string;
        start_date: string | null;
        end_date: string | null;
        status: Project['status'];
        notes: string | null;
        billed: string;
        outstanding: string;
        deposits: string;
        deposits_remaining: string;
        progress_pct: string | null;
        progress_date: string | null;
        accrual: string;
        direct_cost: string;
      }>(sql`
        SELECT p.id, p.code, p.name, p.customer_id, c.code AS customer_code, c.name AS customer_name, p.contract_value,
               p.start_date::text, p.end_date::text, p.status, p.notes,
               COALESCE((SELECT SUM(subtotal) FROM invoices i WHERE i.project_id = p.id), 0) AS billed,
               COALESCE((SELECT SUM(total - paid_amount - returned_amount) FROM invoices i WHERE i.project_id = p.id), 0) AS outstanding,
               COALESCE((SELECT SUM(amount) FROM customer_deposits d WHERE d.project_id = p.id), 0) AS deposits,
               COALESCE((SELECT SUM(amount - applied_amount) FROM customer_deposits d WHERE d.project_id = p.id), 0) AS deposits_remaining,
               (SELECT percent FROM project_progress g WHERE g.project_id = p.id ORDER BY date DESC, created_at DESC LIMIT 1) AS progress_pct,
               (SELECT date::text FROM project_progress g WHERE g.project_id = p.id ORDER BY date DESC, created_at DESC LIMIT 1) AS progress_date,
               COALESCE((SELECT SUM(adjustment) FROM project_progress g WHERE g.project_id = p.id), 0) AS accrual,
               COALESCE(pc.v, 0) AS direct_cost
        FROM projects p JOIN customers c ON c.id = p.customer_id
        LEFT JOIN (SELECT project_id, SUM(amount) AS v FROM ${projectCostsSql(tenantId)} x GROUP BY project_id) pc ON pc.project_id = p.id
        WHERE p.tenant_id = ${tenantId} ${id ? sql`AND p.id = ${id}` : sql``}
        ORDER BY (p.status = 'ACTIVE') DESC, p.created_at DESC
        LIMIT 500`)
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
    }));
  }

  // ================= Kemajuan pekerjaan (SAK EP Bab 23) =================

  listProgress(tenantId: string, projectId: string) {
    return this.db
      .select()
      .from(projectProgress)
      .where(and(eq(projectProgress.tenantId, tenantId), eq(projectProgress.projectId, projectId)))
      .orderBy(asc(projectProgress.date), asc(projectProgress.createdAt));
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
      const lock = await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${user.tenantId} FOR UPDATE`,
      );
      if (!lock.rows.length) throw new NotFoundException('Proyek tidak ditemukan');
      const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
      if (p.status === 'CANCELLED') throw new BadRequestException('Proyek dibatalkan');
      if (D(p.contractValue).lte(0)) throw new BadRequestException('Isi nilai kontrak proyek dulu');
      const prev = await tx
        .select()
        .from(projectProgress)
        .where(eq(projectProgress.projectId, projectId))
        .orderBy(desc(projectProgress.date), desc(projectProgress.createdAt));
      if (prev[0] && date < prev[0].date)
        throw new BadRequestException(`Tanggal tidak boleh sebelum kemajuan terakhir (${prev[0].date})`);
      const before = prev.reduce<Dec>((a, r) => a.plus(r.adjustment), ZERO);
      const [b] = (
        await tx.execute<{ v: string }>(sql`
          SELECT COALESCE(SUM(subtotal), 0) AS v FROM invoices WHERE project_id = ${projectId} AND date <= ${date}`)
      ).rows;
      const billed = D(b.v);
      const earned = money(D(p.contractValue).times(pct).div(100));
      const after = earned.minus(billed);
      const adjustment = after.minus(before);

      // Akun pendapatan: yang paling sering dipakai di faktur proyek ini (mis. 4-2100 konstruksi), bawaan Pendapatan Jasa
      const [acc] = (
        await tx.execute<{ account_id: string }>(sql`
          SELECT l.account_id FROM service_invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE i.project_id = ${projectId} GROUP BY l.account_id ORDER BY SUM(l.line_total) DESC LIMIT 1`)
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
      await this.db.execute<{
        source: string;
        doc_id: string;
        number: string;
        date: string;
        description: string | null;
        account: string;
        amount: string;
      }>(sql`
        SELECT x.source, x.doc_id, x.number, x.date::text, x.description, a.code || ' ' || a.name AS account, x.amount
        FROM ${projectCostsSql(tenantId)} x JOIN accounts a ON a.id = x.account_id
        WHERE x.project_id = ${id} AND x.amount <> 0
        ORDER BY x.date, x.number`)
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
    const [c] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
    if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
    if (D(dto.contractValue).lt(0)) throw new BadRequestException('Nilai kontrak tidak boleh negatif');
    const id = await this.db.transaction(async (tx) => {
      const code = dto.code?.trim() || (await this.seq.next(tx, user.tenantId, 'PROJECT', toDocDate(dto.startDate)));
      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.tenantId, user.tenantId), eq(projects.code, code)));
      if (dup) throw new BadRequestException(`Kode proyek ${code} sudah dipakai`);
      const [p] = await tx
        .insert(projects)
        .values({
          tenantId: user.tenantId,
          code,
          name: dto.name.trim(),
          customerId: dto.customerId,
          contractValue: money(dto.contractValue).toFixed(2),
          startDate: dto.startDate ? toDocDate(dto.startDate) : null,
          endDate: dto.endDate ? toDocDate(dto.endDate) : null,
          notes: dto.notes,
        })
        .returning({ id: projects.id });
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
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.contractValue !== undefined) patch.contractValue = money(dto.contractValue).toFixed(2);
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
