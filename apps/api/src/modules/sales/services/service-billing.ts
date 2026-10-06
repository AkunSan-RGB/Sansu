/**
 * Usaha jasa:
 *  - Faktur jasa (tanpa stok) dengan PPh yang dipotong pelanggan:
 *      PPh 23  → Pajak Dibayar Dimuka (kredit pajak PPh Badan; wajib minta bukti potong)
 *      PPh 4(2) final (jasa konstruksi, sewa bangunan) → Beban PPh Final; pendapatannya bukan objek PPh tarif umum
 *  - Proyek / kontrak: nilai kontrak dan penagihan per termin (pendapatan diakui sebesar kemajuan yang ditagih)
 *  - Uang muka pelanggan (DP): liabilitas sampai dipakai melunasi faktur. PPN uang muka terutang saat diterima.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { PAYMENT_METHODS, type CustomerDeposit, type Project, type WithheldByCustomerReport } from '@sansu/shared';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { outputVatRate } from '../../../common/settings.service';
import { addDays, toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import {
  accounts,
  customerDeposits,
  customers,
  depositApplications,
  invoices,
  projectProgress,
  projects,
  serviceInvoiceLines,
  tenants,
} from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { documentTotals, inclusiveDocument } from '../pricing';
import { projectCostsSql } from './project-costs';

// ---------- DTO ----------
export class ServiceLineDto {
  @ApiProperty({ example: 'Termin 1 — pekerjaan struktur 30%' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  description: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsNumberString() qty?: string;
  @ApiPropertyOptional({ example: 'Paket' }) @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @ApiProperty({ example: '30000000' }) @IsNumberString() price: string;
  @ApiPropertyOptional({
    description: 'Akun pendapatan; kosong = Pendapatan Jasa (atau Konstruksi/Sewa untuk PPh 4(2))',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CreateServiceInvoiceDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = termin pembayaran pelanggan' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ example: 'Termin 1 (30%)' }) @IsOptional() @IsString() @MaxLength(80) termLabel?: string;
  @ApiPropertyOptional({ description: 'Dikenai PPN (bawaan ya bila PKP)' })
  @IsOptional()
  @IsBoolean()
  withVat?: boolean;
  @ApiPropertyOptional({ description: 'Harga diinput sudah termasuk PPN' })
  @IsOptional()
  @IsBoolean()
  pricesIncludeVat?: boolean;
  @ApiPropertyOptional({ enum: ['PPH23', 'PPH4_2'], description: 'PPh yang dipotong pelanggan' })
  @IsOptional()
  @IsIn(['PPH23', 'PPH4_2'])
  withholdingType?: 'PPH23' | 'PPH4_2';
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @IsNumberString() withholdingRate?: string;
  @ApiProperty({ type: [ServiceLineDto] })
  @ValidateNested({ each: true })
  @Type(() => ServiceLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  lines: ServiceLineDto[];
}

export class WithholdingSlipDto {
  @ApiProperty({ example: '2600123456' }) @IsString() @MinLength(3) @MaxLength(60) slipNo: string;
  @ApiProperty({ example: '2026-11-10' }) @IsDateString() slipDate: string;
}

export class CreateProjectDto {
  @ApiPropertyOptional({ description: 'Kosong = nomor otomatis' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;
  @ApiProperty({ example: 'Renovasi Gudang PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: '150000000', description: 'Nilai kontrak (DPP)' }) @IsNumberString() contractValue: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(160) name?: string;
  @ApiPropertyOptional({ description: 'Nilai kontrak (DPP) — mis. setelah addendum' })
  @IsOptional()
  @IsNumberString()
  contractValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DONE', 'CANCELLED'])
  status?: 'ACTIVE' | 'DONE' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ProjectProgressDto {
  @ApiProperty({ example: '2026-10-31' }) @IsDateString() date: string;
  @ApiProperty({ example: '55', description: 'Persentase pekerjaan selesai (berita acara / taksiran teknis)' })
  @IsNumberString()
  percent: string;
  @ApiPropertyOptional({ example: 'BA kemajuan No. 03 — opname lapangan' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class CreateDepositDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: '33300000', description: 'Jumlah diterima (termasuk PPN bila dikenai PPN)' })
  @IsNumberString()
  amount: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'TRANSFER' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Uang muka dikenai PPN (bawaan ya bila PKP)' })
  @IsOptional()
  @IsBoolean()
  withVat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class ApplyDepositDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ description: 'Kosong = sebanyak mungkin (min. sisa uang muka, sisa tagihan)' })
  @IsOptional()
  @IsNumberString()
  amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

const outstandingOf = (i: { total: string; paidAmount: string; returnedAmount: string }) =>
  D(i.total).minus(i.paidAmount).minus(i.returnedAmount);

@Injectable()
export class ServiceBillingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  private async keyAccount(tx: Tx | Db, tenantId: string, key: string) {
    const [a] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, key)));
    if (!a)
      throw new BadRequestException(`Akun ${key} belum tersedia — jalankan ulang aplikasi agar bagan akun diperbarui`);
    return a.id;
  }

  // ================= Faktur jasa =================

  async createInvoice(user: AuthUser, dto: CreateServiceInvoiceDto) {
    const date = toDocDate(dto.date);
    const result = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
      if (!customer || !customer.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');

      // PPh dipotong pelanggan
      let whRate = ZERO;
      if (dto.withholdingType) {
        whRate = D(dto.withholdingRate ?? (dto.withholdingType === 'PPH23' ? '2' : '0'));
        if (whRate.lte(0) || whRate.gt(30))
          throw new BadRequestException('Tarif PPh yang dipotong harus di antara 0 dan 30%');
      }
      const defaultKey =
        dto.withholdingType === 'PPH4_2'
          ? whRate.eq(10)
            ? SYS.RENTAL_REVENUE
            : SYS.CONSTRUCTION_REVENUE
          : SYS.SERVICE_REVENUE;
      const defaultAccount = await this.keyAccount(tx, user.tenantId, defaultKey);

      const ids = [...new Set(dto.lines.map((l) => l.accountId).filter((x): x is string => !!x))];
      const accs = ids.length
        ? await tx
            .select()
            .from(accounts)
            .where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, ids)))
        : [];
      for (const a of accs)
        if (a.type !== 'REVENUE' || !a.isPostable)
          throw new BadRequestException(`Akun ${a.code} bukan akun pendapatan`);
      if (accs.length !== ids.length) throw new BadRequestException('Ada akun pendapatan yang tidak ditemukan');

      const raw = dto.lines.map((l) => {
        const qty = D(l.qty ?? '1');
        const price = money(l.price);
        if (qty.lte(0) || price.lte(0)) throw new BadRequestException(`Jumlah & harga "${l.description}" harus > 0`);
        return { ...l, qty: qty.toString(), price, discountPct: '0', accountId: l.accountId ?? defaultAccount };
      });
      const rate = dto.withVat === false ? '0' : outputVatRate(tenant);
      const inclusive = !!dto.pricesIncludeVat && D(rate).gt(0);
      const doc = inclusive
        ? inclusiveDocument(raw, rate)
        : {
            lines: raw.map((l) => ({ ...l, lineTotal: money(D(l.qty).times(l.price)) })),
            ...documentTotals(raw, rate),
          };

      // Proyek: tagihan tidak boleh melebihi nilai kontrak
      if (dto.projectId) {
        const [p] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, dto.projectId), eq(projects.tenantId, user.tenantId)));
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
        if (p.customerId !== customer.id) throw new BadRequestException('Proyek ini milik pelanggan lain');
        if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
        const [b] = (
          await tx.execute<{ v: string }>(sql`
            SELECT COALESCE(SUM(subtotal), 0) AS v FROM invoices WHERE project_id = ${p.id} AND tenant_id = ${user.tenantId}`)
        ).rows;
        const after = D(b.v).plus(doc.subtotal);
        if (D(p.contractValue).gt(0) && after.gt(p.contractValue)) {
          throw new BadRequestException(
            `Total tagihan proyek (${after.toFixed(2)}) melebihi nilai kontrak ${D(p.contractValue).toFixed(2)}. Ubah nilai kontrak bila ada addendum.`,
          );
        }
      }

      const withholding = money(doc.subtotal.times(whRate).div(100));
      const number = await this.seq.next(tx, user.tenantId, 'INVOICE', date);
      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId: user.tenantId,
          number,
          kind: 'SERVICE',
          date,
          dueDate: dto.dueDate ? toDocDate(dto.dueDate) : addDays(date, customer.paymentTermDays),
          customerId: customer.id,
          description: dto.description,
          projectId: dto.projectId,
          termLabel: dto.termLabel,
          subtotal: doc.subtotal.toFixed(2),
          taxAmount: doc.taxAmount.toFixed(2),
          total: doc.total.toFixed(2),
          withholdingType: withholding.gt(0) ? dto.withholdingType : null,
          withholdingRate: withholding.gt(0) ? whRate.toFixed(2) : null,
          withholdingBase: withholding.gt(0) ? doc.subtotal.toFixed(2) : '0',
          withholdingAmount: withholding.toFixed(2),
          // PPh yang dipotong pelanggan mengurangi piutang sejak faktur terbit
          paidAmount: withholding.toFixed(2),
        })
        .returning();
      await tx.insert(serviceInvoiceLines).values(
        doc.lines.map((l) => ({
          invoiceId: invoice.id,
          description: l.description.trim(),
          qty: D(l.qty).toFixed(4),
          unit: l.unit?.trim() || 'Paket',
          price: l.price.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          accountId: l.accountId,
        })),
      );

      const byAccount = new Map<string, Dec>();
      for (const l of doc.lines) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? ZERO).plus(l.lineTotal));
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description:
          `Faktur jasa ${number} - ${customer.name}${dto.termLabel ? ` · ${dto.termLabel}` : ''}${dto.description ? ` · ${dto.description}` : ''}`.slice(
            0,
            500,
          ),
        sourceType: 'INVOICE',
        sourceId: invoice.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AR, debit: doc.total.minus(withholding) },
          {
            key: dto.withholdingType === 'PPH4_2' ? SYS.FINAL_TAX_WITHHELD : SYS.PREPAID_TAX,
            debit: withholding,
            memo: withholding.gt(0)
              ? `PPh ${dto.withholdingType === 'PPH23' ? '23' : '4(2) final'} ${whRate.toString()}% dipotong pelanggan`
              : undefined,
          },
          ...[...byAccount].map(([accountId, v]) => ({ accountId, credit: v })),
          { key: SYS.VAT_OUT, credit: doc.taxAmount },
        ],
      });
      await tx.update(invoices).set({ journalId: journal.id }).where(eq(invoices.id, invoice.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'ServiceInvoice',
        entityId: invoice.id,
        data: { number, total: doc.total.toFixed(2), withholding: withholding.toFixed(2), journal: journal.number },
      });
      return { id: invoice.id, number, journalNumber: journal.number };
    });
    return result;
  }

  async setSlip(user: AuthUser, id: string, dto: WithholdingSlipDto) {
    const [inv] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, user.tenantId)));
    if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
    if (!inv.withholdingType) throw new BadRequestException('Faktur ini tidak dipotong PPh oleh pelanggan');
    const slipDate = toDocDate(dto.slipDate);
    if (slipDate < inv.date) throw new BadRequestException('Tanggal bukti potong tidak boleh sebelum tanggal faktur');
    await this.db
      .update(invoices)
      .set({ withholdingSlipNo: dto.slipNo.trim(), withholdingSlipDate: slipDate })
      .where(eq(invoices.id, id));
    await this.audit.log(this.db, {
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'UPDATE',
      entity: 'WithholdingSlip',
      entityId: id,
      data: dto,
    });
    return { ok: true };
  }

  /** Rekap PPh yang dipotong pelanggan (bahan kredit pajak & pencocokan bukti potong di Coretax) */
  async withheld(tenantId: string, period: string): Promise<WithheldByCustomerReport> {
    if (!/^\d{4}(-\d{2})?$/.test(period)) throw new BadRequestException('Periode harus YYYY atau YYYY-MM');
    const from = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const to = period.length === 4 ? `${period}-12-31` : addDays(`${addDays(`${period}-01`, 32).slice(0, 7)}-01`, -1);
    const rows = (
      await this.db.execute<{
        id: string;
        number: string;
        date: string;
        customer: string;
        npwp: string | null;
        type: 'PPH23' | 'PPH4_2';
        rate: string;
        base: string;
        amount: string;
        slip_no: string | null;
        slip_date: string | null;
      }>(sql`
        SELECT i.id, i.number, i.date::text, c.name AS customer, c.npwp, i.withholding_type AS type, i.withholding_rate AS rate,
               i.withholding_base AS base, i.withholding_amount AS amount, i.withholding_slip_no AS slip_no, i.withholding_slip_date::text AS slip_date
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.withholding_amount > 0 AND i.date BETWEEN ${from} AND ${to}
        ORDER BY i.date, i.number`)
    ).rows;
    const totals = (['PPH23', 'PPH4_2'] as const)
      .map((type) => {
        const rs = rows.filter((r) => r.type === type);
        return {
          type,
          base: rs.reduce<Dec>((a, r) => a.plus(r.base), ZERO).toFixed(2),
          amount: rs.reduce<Dec>((a, r) => a.plus(r.amount), ZERO).toFixed(2),
          missingSlips: rs.filter((r) => !r.slip_no).length,
        };
      })
      .filter((t) => Number(t.amount) > 0);
    return {
      period,
      rows: rows.map((r) => ({
        invoiceId: r.id,
        number: r.number,
        date: r.date,
        customer: r.customer,
        customerNpwp: r.npwp,
        type: r.type,
        rate: D(r.rate).toFixed(2),
        base: D(r.base).toFixed(2),
        amount: D(r.amount).toFixed(2),
        slipNo: r.slip_no,
        slipDate: r.slip_date,
      })),
      totals,
    };
  }

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
      const revenueAccountId = acc?.account_id ?? (await this.keyAccount(tx, user.tenantId, SYS.SERVICE_REVENUE));

      const number = await this.seq.next(tx, user.tenantId, 'PROJECT_PROGRESS', date);
      const [row] = await tx
        .insert(projectProgress)
        .values({
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
        })
        .returning();
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
        await tx.update(projectProgress).set({ journalId: journal.id }).where(eq(projectProgress.id, row.id));
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
    const deps = await this.listDeposits(tenantId, { projectId: id });
    const progress = await this.listProgress(tenantId, id);
    const costs = (
      await this.db.execute<{ source: string; doc_id: string; number: string; date: string; description: string | null; account: string; amount: string }>(sql`
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
    if (Object.keys(patch).length) await this.db.update(projects).set(patch).where(eq(projects.id, id));
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

  // ================= Uang muka pelanggan =================

  async listDeposits(
    tenantId: string,
    q: { customerId?: string; projectId?: string; open?: boolean } = {},
  ): Promise<CustomerDeposit[]> {
    const rows = await this.db.query.customerDeposits.findMany({
      where: and(
        eq(customerDeposits.tenantId, tenantId),
        q.customerId ? eq(customerDeposits.customerId, q.customerId) : undefined,
        q.projectId ? eq(customerDeposits.projectId, q.projectId) : undefined,
        q.open ? sql`${customerDeposits.amount} > ${customerDeposits.appliedAmount}` : undefined,
      ),
      orderBy: [desc(customerDeposits.date), desc(customerDeposits.number)],
      limit: 500,
    });
    if (!rows.length) return [];
    const custs = await this.db
      .select({ id: customers.id, code: customers.code, name: customers.name })
      .from(customers)
      .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
    const projIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const projs = projIds.length
      ? await this.db
          .select({ id: projects.id, code: projects.code, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projIds))
      : [];
    const apps = await this.db
      .select({
        id: depositApplications.id,
        depositId: depositApplications.depositId,
        date: depositApplications.date,
        amount: depositApplications.amount,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
      })
      .from(depositApplications)
      .innerJoin(invoices, eq(invoices.id, depositApplications.invoiceId))
      .where(
        inArray(
          depositApplications.depositId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => {
      const c = custs.find((x) => x.id === r.customerId)!;
      const p = projs.find((x) => x.id === r.projectId);
      return {
        id: r.id,
        number: r.number,
        date: r.date,
        customerId: r.customerId,
        customer: { code: c.code, name: c.name },
        projectId: r.projectId,
        project: p ? { code: p.code, name: p.name } : null,
        method: r.method,
        amount: r.amount,
        dpp: r.dpp,
        taxAmount: r.taxAmount,
        appliedAmount: r.appliedAmount,
        remaining: D(r.amount).minus(r.appliedAmount).toFixed(2),
        description: r.description,
        applications: apps
          .filter((a) => a.depositId === r.id)
          .map((a) => ({
            id: a.id,
            date: a.date,
            amount: a.amount,
            invoice: { id: a.invoiceId, number: a.invoiceNumber },
          })),
      };
    });
  }

  /** Terima uang muka: Dr Kas/Bank | Cr Uang Muka Pelanggan (DPP), Cr PPN Keluaran (PPN uang muka) */
  async createDeposit(user: AuthUser, dto: CreateDepositDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah uang muka harus > 0');
    return this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const [customer] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
      if (!customer) throw new BadRequestException('Pelanggan tidak ditemukan');
      if (dto.projectId) {
        const [p] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, dto.projectId), eq(projects.tenantId, user.tenantId)));
        if (!p || p.customerId !== customer.id)
          throw new BadRequestException('Proyek tidak ditemukan untuk pelanggan ini');
      }
      const rate = D(dto.withVat === false ? '0' : outputVatRate(tenant));
      const dpp = rate.gt(0) ? money(amount.times(100).div(D(100).plus(rate))) : amount;
      const tax = amount.minus(dpp);
      const method = dto.method ?? 'TRANSFER';
      const cash = await this.posting.resolveCashAccount(
        tx,
        user.tenantId,
        dto.cashAccountId,
        method === 'CASH' ? 'CASH' : 'BANK',
      );
      const number = await this.seq.next(tx, user.tenantId, 'CUSTOMER_DEPOSIT', date);
      const [d] = await tx
        .insert(customerDeposits)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          customerId: customer.id,
          projectId: dto.projectId,
          method,
          cashAccountId: cash.id,
          amount: amount.toFixed(2),
          dpp: dpp.toFixed(2),
          taxAmount: tax.toFixed(2),
          description: dto.description,
          createdById: user.sub,
        })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Uang muka ${number} - ${customer.name}${dto.description ? ` · ${dto.description}` : ''}`.slice(
          0,
          500,
        ),
        sourceType: 'CUSTOMER_DEPOSIT',
        sourceId: d.id,
        createdById: user.sub,
        lines: [
          { accountId: cash.id, debit: amount },
          { key: SYS.CUSTOMER_DEPOSIT, credit: dpp },
          { key: SYS.VAT_OUT, credit: tax, memo: tax.gt(0) ? 'PPN atas uang muka' : undefined },
        ],
      });
      await tx.update(customerDeposits).set({ journalId: journal.id }).where(eq(customerDeposits.id, d.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'CustomerDeposit',
        entityId: d.id,
        data: { number, amount: amount.toFixed(2) },
      });
      return { ...d, journalNumber: journal.number };
    });
  }

  /** Pakai uang muka untuk melunasi faktur: Dr Uang Muka Pelanggan (DPP), Dr PPN Keluaran (PPN uang muka) | Cr Piutang */
  async applyDeposit(user: AuthUser, id: string, dto: ApplyDepositDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const lockD = await tx.execute(
        sql`SELECT id FROM customer_deposits WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`,
      );
      if (!lockD.rows.length) throw new NotFoundException('Uang muka tidak ditemukan');
      const lockI = await tx.execute(
        sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`,
      );
      if (!lockI.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      const [d] = await tx.select().from(customerDeposits).where(eq(customerDeposits.id, id));
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, dto.invoiceId));
      if (inv.customerId !== d.customerId)
        throw new BadRequestException('Uang muka dan faktur harus dari pelanggan yang sama');
      if (inv.isOpening) throw new BadRequestException('Uang muka tidak bisa dipakai untuk faktur saldo awal');
      if (D(d.taxAmount).gt(0) && D(inv.taxAmount).lte(0))
        throw new BadRequestException('Uang muka ber-PPN hanya bisa dipakai untuk faktur ber-PPN');
      if (date < d.date || date < inv.date)
        throw new BadRequestException('Tanggal pemakaian tidak boleh sebelum tanggal uang muka / faktur');

      const remaining = D(d.amount).minus(d.appliedAmount);
      const outstanding = outstandingOf(inv);
      const max = remaining.lt(outstanding) ? remaining : outstanding;
      if (max.lte(0))
        throw new BadRequestException(remaining.lte(0) ? 'Uang muka sudah habis dipakai' : 'Faktur sudah lunas');
      const amount = dto.amount ? money(dto.amount) : max;
      if (amount.lte(0)) throw new BadRequestException('Jumlah harus > 0');
      if (amount.gt(max))
        throw new BadRequestException(
          `Paling banyak ${max.toFixed(2)} (sisa uang muka ${remaining.toFixed(2)}, sisa tagihan ${outstanding.toFixed(2)})`,
        );

      // Bagian DPP & PPN dari uang muka; pemakaian terakhir mengambil sisanya agar tidak ada sisa pembulatan
      const [used] = (
        await tx.execute<{ dpp: string; tax: string }>(sql`
          SELECT COALESCE(SUM(dpp), 0) AS dpp, COALESCE(SUM(tax_amount), 0) AS tax FROM deposit_applications WHERE deposit_id = ${id}`)
      ).rows;
      const dppShare = amount.eq(remaining) ? D(d.dpp).minus(used.dpp) : money(amount.times(d.dpp).div(d.amount));
      const taxShare = amount.minus(dppShare);

      const number = await this.seq.next(tx, user.tenantId, 'DEPOSIT_APPLICATION', date);
      const [app] = await tx
        .insert(depositApplications)
        .values({
          tenantId: user.tenantId,
          number,
          depositId: d.id,
          invoiceId: inv.id,
          date,
          amount: amount.toFixed(2),
          dpp: dppShare.toFixed(2),
          taxAmount: taxShare.toFixed(2),
        })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pemakaian uang muka ${d.number} untuk ${inv.number}`,
        sourceType: 'DEPOSIT_APPLICATION',
        sourceId: app.id,
        createdById: user.sub,
        lines: [
          { key: SYS.CUSTOMER_DEPOSIT, debit: dppShare },
          {
            key: SYS.VAT_OUT,
            debit: taxShare,
            memo: taxShare.gt(0) ? 'PPN uang muka sudah dipungut saat DP diterima' : undefined,
          },
          { key: SYS.AR, credit: amount },
        ],
      });
      await tx.update(depositApplications).set({ journalId: journal.id }).where(eq(depositApplications.id, app.id));
      await tx
        .update(customerDeposits)
        .set({ appliedAmount: D(d.appliedAmount).plus(amount).toFixed(2) })
        .where(eq(customerDeposits.id, d.id));
      const paid = D(inv.paidAmount).plus(amount);
      await tx
        .update(invoices)
        .set({
          paidAmount: paid.toFixed(2),
          depositApplied: D(inv.depositApplied).plus(amount).toFixed(2),
          status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        })
        .where(eq(invoices.id, inv.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'APPLY',
        entity: 'CustomerDeposit',
        entityId: d.id,
        data: { invoice: inv.number, amount: amount.toFixed(2) },
      });
      return { id: app.id, number, amount: amount.toFixed(2), journalNumber: journal.number };
    });
  }
}

// ---------- Controller ----------
@ApiTags('Penjualan — jasa')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('services')
export class ServiceBillingController {
  constructor(private readonly svc: ServiceBillingService) {}

  @Post('invoices')
  @Roles('ADMIN', 'FINANCE')
  createInvoice(@CurrentUser() u: AuthUser, @Body() dto: CreateServiceInvoiceDto) {
    return this.svc.createInvoice(u, dto);
  }

  @Put('invoices/:id/withholding-slip')
  @Roles('ADMIN', 'FINANCE')
  setSlip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WithholdingSlipDto) {
    return this.svc.setSlip(u, id, dto);
  }

  @Get('withheld')
  @Roles('ADMIN', 'FINANCE')
  withheld(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    return this.svc.withheld(u.tenantId, period || new Date().getFullYear().toString());
  }

  @Get('projects')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  projects(@CurrentUser() u: AuthUser) {
    return this.svc.listProjects(u.tenantId);
  }

  @Get('projects/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  project(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getProject(u.tenantId, id);
  }

  @Post('projects')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  createProject(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) {
    return this.svc.createProject(u, dto);
  }

  @Post('projects/:id/progress')
  @Roles('ADMIN', 'FINANCE')
  progress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProjectProgressDto) {
    return this.svc.recordProgress(u, id, dto);
  }

  @Patch('projects/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  updateProject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.updateProject(u, id, dto);
  }

  @Get('deposits')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  deposits(@CurrentUser() u: AuthUser, @Query('customerId') customerId?: string, @Query('open') open?: string) {
    return this.svc.listDeposits(u.tenantId, {
      customerId: customerId || undefined,
      open: open === '1' || open === 'true',
    });
  }

  @Post('deposits')
  @Roles('ADMIN', 'FINANCE')
  createDeposit(@CurrentUser() u: AuthUser, @Body() dto: CreateDepositDto) {
    return this.svc.createDeposit(u, dto);
  }

  @Post('deposits/:id/apply')
  @Roles('ADMIN', 'FINANCE')
  apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyDepositDto) {
    return this.svc.applyDeposit(u, id, dto);
  }
}
