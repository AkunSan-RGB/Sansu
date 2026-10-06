import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { DocDate, toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, payrollRuns, payslips, tenants } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { monthRange, workDaysBetween } from '../hr/hr.module';
import { computePayslip, PayslipCalc } from './compute';

// ---------- DTO ----------
export class CreateRunDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional({ example: '2026-10-28' }) @IsOptional() @IsDateString() payDate?: string;
}
export class UpdatePayslipDto {
  @ApiPropertyOptional({ example: '250000', description: 'Bonus / insentif / THR bulan ini' }) @IsOptional() @IsNumberString() otherIncome?: string;
  @ApiPropertyOptional({ example: '100000', description: 'Potongan kasbon / lainnya' }) @IsOptional() @IsNumberString() otherDeduction?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class PayRunDto {
  @ApiPropertyOptional({ description: 'Rekening pembayar; kosong = Bank' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

const MONEY_FIELDS = [
  'baseSalary',
  'fixedAllowance',
  'dailyAllowance',
  'overtimePay',
  'otherIncome',
  'absenceDeduction',
  'grossPay',
  'bpjsKesEmployee',
  'jhtEmployee',
  'jpEmployee',
  'bpjsKesCompany',
  'jhtCompany',
  'jpCompany',
  'jkkCompany',
  'jkmCompany',
  'taxableGross',
  'pph21',
  'otherDeduction',
  'netPay',
] as const;

const toRow = (c: PayslipCalc) => ({
  ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, (c[f] as Dec).toFixed(2)])),
  workDays: c.workDays,
  presentDays: c.presentDays,
  absentDays: c.absentDays,
  overtimeHours: String(c.overtimeHours),
  terCategory: c.terCategory,
  terRate: String(c.terRate),
}) as Omit<typeof payslips.$inferInsert, 'runId' | 'employeeId'>;

// ---------- Service ----------
@Injectable()
export class PayrollService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  listRuns(tenantId: string) {
    return this.db.query.payrollRuns.findMany({
      where: eq(payrollRuns.tenantId, tenantId),
      orderBy: desc(payrollRuns.period),
      with: { payslips: { columns: { id: true } } },
    });
  }

  async getRun(tenantId: string, id: string, db: Db | Tx = this.db) {
    const r = await db.query.payrollRuns.findFirst({
      where: and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)),
      with: {
        payslips: { with: { employee: { columns: { id: true, code: true, name: true, jobTitle: true, ptkp: true } } } },
        cashAccount: { columns: { code: true, name: true } },
      },
    });
    if (!r) throw new NotFoundException('Penggajian tidak ditemukan');
    r.payslips.sort((a, b) => a.employee.code.localeCompare(b.employee.code));
    return r;
  }

  /** Slip gaji lengkap untuk dicetak */
  async getPayslip(tenantId: string, id: string) {
    const p = await this.db.query.payslips.findFirst({
      where: eq(payslips.id, id),
      with: { run: true, employee: true },
    });
    if (!p || p.run.tenantId !== tenantId) throw new NotFoundException('Slip gaji tidak ditemukan');
    const [company] = await this.db.select({ name: tenants.name, address: tenants.address, npwp: tenants.npwp }).from(tenants).where(eq(tenants.id, tenantId));
    return { ...p, company };
  }

  async createRun(user: AuthUser, dto: CreateRunDto) {
    const { to } = monthRange(dto.period);
    const id = await this.db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ number: payrollRuns.number })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, user.tenantId), eq(payrollRuns.period, dto.period)));
      if (exists) throw new BadRequestException(`Penggajian periode ${dto.period} sudah ada (${exists.number})`);
      const payDate = toDocDate(dto.payDate ?? to);
      const number = await this.seq.next(tx, user.tenantId, 'PAYROLL', payDate);
      const [run] = await tx.insert(payrollRuns).values({ tenantId: user.tenantId, number, period: dto.period, payDate }).returning();
      await this.generate(tx, user.tenantId, run.id, dto.period);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PayrollRun', entityId: run.id });
      return run.id;
    });
    return this.getRun(user.tenantId, id);
  }

  /** Hitung ulang semua slip (draft) — dipakai setelah absensi / data karyawan berubah */
  async recompute(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, user.tenantId, id, 'DRAFT');
      await this.generate(tx, user.tenantId, run.id, run.period);
    });
    return this.getRun(user.tenantId, id);
  }

  async updatePayslip(user: AuthUser, id: string, dto: UpdatePayslipDto) {
    const [slip] = await this.db.select().from(payslips).where(eq(payslips.id, id));
    if (!slip) throw new NotFoundException('Slip tidak ditemukan');
    await this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, user.tenantId, slip.runId, 'DRAFT');
      await tx
        .update(payslips)
        .set({ otherIncome: dto.otherIncome ?? slip.otherIncome, otherDeduction: dto.otherDeduction ?? slip.otherDeduction, notes: dto.notes ?? slip.notes })
        .where(eq(payslips.id, id));
      await this.generate(tx, user.tenantId, run.id, run.period, slip.employeeId);
    });
    return this.getRun(user.tenantId, slip.runId);
  }

  async deleteRun(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      await this.lockRun(tx, user.tenantId, id, 'DRAFT');
      await tx.delete(payrollRuns).where(eq(payrollRuns.id, id));
    });
    return { ok: true };
  }

  /**
   * Posting gaji (akrual):
   *  Dr Beban Gaji (penghasilan tunai) · Dr Beban BPJS Perusahaan
   *  Cr Hutang Gaji (gaji bersih) · Cr Hutang BPJS (iuran pegawai + perusahaan) · Cr Hutang PPh 21 · Cr Piutang Karyawan (potongan kasbon)
   */
  async post(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, user.tenantId, id, 'DRAFT');
      const slips = await tx.select().from(payslips).where(eq(payslips.runId, id));
      if (!slips.length) throw new BadRequestException('Tidak ada slip gaji untuk diposting');
      const s = (f: keyof (typeof slips)[number]) => slips.reduce<Dec>((a, p) => a.plus(D(p[f] as string)), ZERO);
      const gross = s('grossPay');
      const employer = s('bpjsKesCompany').plus(s('jhtCompany')).plus(s('jpCompany')).plus(s('jkkCompany')).plus(s('jkmCompany'));
      const employeeBpjs = s('bpjsKesEmployee').plus(s('jhtEmployee')).plus(s('jpEmployee'));
      const pph = s('pph21');
      const other = s('otherDeduction');
      const net = s('netPay');
      // Tenaga kerja langsung produksi → Upah Langsung Produksi (bagian harga pokok produksi)
      const prodIds = new Set(
        (
          await tx
            .select({ id: employees.id })
            .from(employees)
            .where(and(eq(employees.tenantId, user.tenantId), eq(employees.isProduction, true)))
        ).map((e) => e.id),
      );
      const directLabor = slips
        .filter((p) => prodIds.has(p.employeeId))
        .reduce<Dec>(
          (a, p) => a.plus(p.grossPay).plus(p.bpjsKesCompany).plus(p.jhtCompany).plus(p.jpCompany).plus(p.jkkCompany).plus(p.jkmCompany),
          ZERO,
        );
      const prodGross = slips.filter((p) => prodIds.has(p.employeeId)).reduce<Dec>((a, p) => a.plus(p.grossPay), ZERO);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: run.payDate,
        description: `Gaji periode ${run.period} (${run.number}) — ${slips.length} karyawan`,
        sourceType: 'PAYROLL',
        sourceId: run.id,
        createdById: user.sub,
        lines: [
          { key: SYS.SALARY_EXPENSE, debit: gross.minus(prodGross) },
          { key: SYS.BPJS_EXPENSE, debit: employer.minus(directLabor.minus(prodGross)) },
          { key: SYS.DIRECT_LABOR, debit: directLabor },
          { key: SYS.SALARY_PAYABLE, credit: net },
          { key: SYS.BPJS_PAYABLE, credit: employeeBpjs.plus(employer) },
          { key: SYS.PPH21_PAYABLE, credit: pph },
          { key: SYS.EMPLOYEE_RECEIVABLE, credit: other },
        ],
      });
      await tx
        .update(payrollRuns)
        .set({
          status: 'POSTED',
          journalId: journal.id,
          totalGross: gross.toFixed(2),
          totalEmployerCost: gross.plus(employer).toFixed(2),
          totalPph21: pph.toFixed(2),
          totalNet: net.toFixed(2),
        })
        .where(eq(payrollRuns.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'POST', entity: 'PayrollRun', entityId: id, data: { journal: journal.number } });
    });
    return this.getRun(user.tenantId, id);
  }

  /** Transfer gaji: Dr Hutang Gaji | Cr Bank */
  async pay(user: AuthUser, id: string, dto: PayRunDto) {
    const result = await this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, user.tenantId, id, 'POSTED');
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      const date = toDocDate(dto.date ?? run.payDate);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pembayaran gaji periode ${run.period} (${run.number})`,
        sourceType: 'PAYROLL_PAYMENT',
        sourceId: run.id,
        createdById: user.sub,
        lines: [
          { key: SYS.SALARY_PAYABLE, debit: run.totalNet },
          { accountId: bank.id, credit: run.totalNet },
        ],
      });
      await tx.update(payrollRuns).set({ status: 'PAID', paymentJournalId: journal.id, cashAccountId: bank.id }).where(eq(payrollRuns.id, id));
      return journal.number;
    });
    return { ...(await this.getRun(user.tenantId, id)), paymentJournalNumber: result };
  }

  /** Rekap PPh 21 per karyawan setahun (bahan bukti potong 1721-A1 & SPT Masa) */
  async pph21Report(tenantId: string, year: number) {
    const res = await this.db.execute<{
      employee_id: string;
      code: string;
      name: string;
      npwp: string | null;
      nik: string | null;
      ptkp: string;
      months: number;
      gross: string;
      pension: string;
      pph21: string;
    }>(sql`
      SELECT e.id AS employee_id, e.code, e.name, e.npwp, e.nik, e.ptkp, COUNT(*)::int AS months,
             SUM(p.taxable_gross) AS gross, SUM(p.jht_employee + p.jp_employee) AS pension, SUM(p.pph21) AS pph21
      FROM payslips p
      JOIN payroll_runs r ON r.id = p.run_id
      JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period LIKE ${`${year}-%`}
      GROUP BY e.id ORDER BY e.code`);
    const monthly = await this.db.execute<{ period: string; gross: string; pph21: string; n: number }>(sql`
      SELECT r.period, SUM(p.taxable_gross) AS gross, SUM(p.pph21) AS pph21, COUNT(*)::int AS n
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period LIKE ${`${year}-%`}
      GROUP BY r.period ORDER BY r.period`);
    return {
      year,
      employees: res.rows.map((r) => ({ ...r, gross: money(r.gross).toFixed(2), pension: money(r.pension).toFixed(2), pph21: money(r.pph21).toFixed(2) })),
      monthly: monthly.rows.map((m) => ({ ...m, gross: money(m.gross).toFixed(2), pph21: money(m.pph21).toFixed(2) })),
    };
  }

  /**
   * Rekap iuran BPJS satu masa per karyawan: dasar upah, bagian perusahaan & karyawan per program.
   * Dipakai mencocokkan tagihan BPJS (SIPP Ketenagakerjaan & e-Dabu Kesehatan) sebelum membayar.
   */
  async bpjsReport(tenantId: string, period: string) {
    const res = await this.db.execute<Record<string, string | null>>(sql`
      SELECT e.id, e.code, e.name, e.nik, e.join_date::text AS "joinDate", e.resign_date::text AS "resignDate",
             (p.base_salary + p.fixed_allowance)::text AS wage,
             p.bpjs_kes_company AS "kesCompany", p.bpjs_kes_employee AS "kesEmployee",
             p.jht_company AS "jhtCompany", p.jht_employee AS "jhtEmployee",
             p.jkk_company AS "jkkCompany", p.jkm_company AS "jkmCompany",
             p.jp_company AS "jpCompany", p.jp_employee AS "jpEmployee"
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period = ${period}
      ORDER BY e.code`);
    const [run] = await this.db
      .select({ number: payrollRuns.number, status: payrollRuns.status })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.period, period)));
    const keys = ['kesCompany', 'kesEmployee', 'jhtCompany', 'jhtEmployee', 'jkkCompany', 'jkmCompany', 'jpCompany', 'jpEmployee'] as const;
    const totals = Object.fromEntries(keys.map((k) => [k, res.rows.reduce<Dec>((s, r) => s.plus(r[k] ?? 0), ZERO).toFixed(2)])) as Record<(typeof keys)[number], string>;
    const kes = D(totals.kesCompany).plus(totals.kesEmployee);
    const tk = D(totals.jhtCompany).plus(totals.jhtEmployee).plus(totals.jkkCompany).plus(totals.jkmCompany).plus(totals.jpCompany).plus(totals.jpEmployee);
    const { from, to } = monthRange(period);
    const moves = await this.db.execute<{ code: string; name: string; kind: string; date: string }>(sql`
      SELECT code, name, 'MASUK' AS kind, join_date::text AS date FROM employees WHERE tenant_id = ${tenantId} AND join_date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT code, name, 'KELUAR' AS kind, resign_date::text AS date FROM employees WHERE tenant_id = ${tenantId} AND resign_date BETWEEN ${from} AND ${to}
      ORDER BY date`);
    const paid = await this.db.execute<{ amount: string; date: string | null; ntpn: string | null }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS amount, MAX(date)::text AS date, STRING_AGG(NULLIF(ntpn, ''), ', ') AS ntpn
      FROM tax_payments WHERE tenant_id = ${tenantId} AND type = 'BPJS' AND period = ${period}`);
    const settings = await this.settings.payroll(this.db, tenantId);
    const [y, m] = period.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return {
      period,
      run: run ?? null,
      rows: res.rows,
      totals,
      kesehatan: kes.toFixed(2),
      ketenagakerjaan: tk.toFixed(2),
      total: kes.plus(tk).toFixed(2),
      dueKesehatan: `${next}-10`,
      dueKetenagakerjaan: `${next}-15`,
      paid: paid.rows[0],
      changes: moves.rows,
      caps: { kesehatan: settings.bpjsKesCap, jp: settings.jpCap, jkkRate: settings.jkkRate, jkmRate: settings.jkmRate },
    };
  }

  // ---------- internal ----------

  /** Hitung slip untuk semua karyawan aktif di periode (atau satu karyawan) */
  private async generate(tx: Tx, tenantId: string, runId: string, period: string, onlyEmployeeId?: string) {
    const { from, to } = monthRange(period);
    const settings = await this.settings.payroll(tx, tenantId);
    const allDays = workDaysBetween(from, to, settings.workDaysPerWeek);
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));

    const emps = (await tx.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(asc(employees.code))).filter(
      (e) =>
        (!onlyEmployeeId || e.id === onlyEmployeeId) &&
        e.joinDate <= to &&
        (!e.resignDate || e.resignDate >= from) &&
        (e.isActive || (e.resignDate && e.resignDate >= from)),
    );
    const existing = await tx.select().from(payslips).where(eq(payslips.runId, runId));
    const existingByEmp = new Map(existing.map((p) => [p.employeeId, p]));
    if (!onlyEmployeeId) {
      // karyawan yang tidak lagi memenuhi syarat dihapus dari draft
      const keep = new Set(emps.map((e) => e.id));
      for (const p of existing) if (!keep.has(p.employeeId)) await tx.delete(payslips).where(eq(payslips.id, p.id));
    }

    const att = await tx
      .select()
      .from(attendances)
      .where(and(eq(attendances.tenantId, tenantId), sql`${attendances.date} BETWEEN ${from} AND ${to}`));

    // Akumulasi tahun berjalan dari penggajian sebelumnya yang sudah diposting
    const ytdRows = await tx.execute<{ employee_id: string; gross: string; pension: string; pph: string; n: number }>(sql`
      SELECT p.employee_id, SUM(p.taxable_gross) AS gross, SUM(p.jht_employee + p.jp_employee) AS pension,
             SUM(p.pph21) AS pph, COUNT(*)::int AS n
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period >= ${`${year}-01`} AND r.period < ${period}
      GROUP BY p.employee_id`);
    const ytdBy = new Map(ytdRows.rows.map((r) => [r.employee_id, r]));

    for (const e of emps) {
      const start = e.joinDate > from ? e.joinDate : from;
      const end = e.resignDate && e.resignDate < to ? e.resignDate : to;
      const employedDays = allDays.filter((d) => d >= start && d <= end);
      const ratio = allDays.length ? employedDays.length / allDays.length : 1;
      // Absensi berbasis pengecualian: hari kerja tanpa catatan dianggap hadir
      const workSet = new Set(employedDays);
      const mine = att.filter((a) => a.employeeId === e.id && workSet.has(a.date));
      const notPresent = mine.filter((a) => a.status !== 'HADIR').length;
      const attendance = {
        workDays: employedDays.length,
        presentDays: employedDays.length - notPresent,
        unpaidDays: mine.filter((a) => a.status === 'ALPA' || a.status === 'IZIN').length,
        overtimeByDay: mine.filter((a) => a.status === 'HADIR').map((a) => Number(a.overtimeHours)),
      };
      const prev = existingByEmp.get(e.id);
      const y = ytdBy.get(e.id);
      const calc = computePayslip(
        {
          ptkp: e.ptkp,
          // karyawan baru / keluar di tengah bulan: gaji pokok & tunjangan tetap prorata hari kerja
          baseSalary: money(D(e.baseSalary).times(ratio)).toFixed(2),
          fixedAllowance: money(D(e.fixedAllowance).times(ratio)).toFixed(2),
          dailyAllowance: e.dailyAllowance,
          bpjsKes: e.bpjsKes,
          bpjsTk: e.bpjsTk,
          bpjsJp: e.bpjsJp,
        },
        attendance,
        settings,
        {
          month,
          isFinalPeriod: month === 12 || (!!e.resignDate && e.resignDate <= to),
          prevGross: D(y?.gross),
          prevPension: D(y?.pension),
          prevWithheld: D(y?.pph),
          prevMonths: y?.n ?? 0,
        },
        { otherIncome: prev?.otherIncome, otherDeduction: prev?.otherDeduction },
      );
      const row = { ...toRow(calc), projectId: e.projectId ?? null };
      if (prev) await tx.update(payslips).set(row).where(eq(payslips.id, prev.id));
      else await tx.insert(payslips).values({ ...row, runId, employeeId: e.id });
    }
  }

  private async lockRun(tx: Tx, tenantId: string, id: string, status: 'DRAFT' | 'POSTED') {
    const res = await tx.execute<{ id: string }>(sql`SELECT id FROM payroll_runs WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!res.rows.length) throw new NotFoundException('Penggajian tidak ditemukan');
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (run.status !== status) {
      const msg: Record<string, string> = {
        DRAFT: 'Penggajian sudah diposting; tidak bisa diubah',
        POSTED: run.status === 'DRAFT' ? 'Posting penggajian dulu sebelum dibayar' : 'Penggajian sudah dibayar',
      };
      throw new BadRequestException(msg[status]);
    }
    return run;
  }
}

// ---------- Controller ----------
@ApiTags('Penggajian')
@ApiBearerAuth()
@RequireApp('payroll')
@Roles('HR', 'FINANCE')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly svc: PayrollService) {}

  @Get('runs')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.listRuns(u.tenantId);
  }
  @Get('runs/:id')
  run(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRun(u.tenantId, id);
  }
  @Roles('HR')
  @Post('runs')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateRunDto) {
    return this.svc.createRun(u, dto);
  }
  @Roles('HR')
  @Post('runs/:id/recompute')
  recompute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recompute(u, id);
  }
  @Roles('HR')
  @Post('runs/:id/delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRun(u, id);
  }
  @Roles('FINANCE')
  @Post('runs/:id/post')
  post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.post(u, id);
  }
  @Roles('FINANCE')
  @Post('runs/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayRunDto) {
    return this.svc.pay(u, id, dto);
  }
  @Get('payslips/:id')
  payslip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPayslip(u.tenantId, id);
  }
  @Roles('HR')
  @Patch('payslips/:id')
  updatePayslip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayslipDto) {
    return this.svc.updatePayslip(u, id, dto);
  }
  @Get('reports/bpjs')
  bpjs(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);
    return this.svc.bpjsReport(u.tenantId, p);
  }
  @Get('reports/pph21')
  pph21(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.pph21Report(u.tenantId, Number(year) || new Date().getFullYear());
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
