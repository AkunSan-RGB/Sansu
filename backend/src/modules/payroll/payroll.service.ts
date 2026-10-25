import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, payrollRuns, payslips, tenants } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { monthRange, workDaysBetween } from '../hr/hr.service';
import { EmploymentService } from '../hr/employment.service';
import { isPerJob } from '../hr/employment.shared';
import { computePayslip, PayslipCalc } from './compute';
import { generateShiftPremiums } from '../hr/shifts.service';
import { assertServiceEntriesMatch, attachServiceEntries } from './service-work.shared';
import { decryptField } from '../../common/utils/secret';
import { CreateRunDto, UpdatePayslipDto, PayRunDto } from './payroll.dto';
import { patchById } from '../../db/owned';

const MONEY_FIELDS = [
  'baseSalary',
  'fixedAllowance',
  'dailyAllowance',
  'overtimePay',
  'otherIncome',
  'serviceIncome',
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
      await patchById(tx, payslips, id, { otherIncome: dto.otherIncome ?? slip.otherIncome, otherDeduction: dto.otherDeduction ?? slip.otherDeduction, notes: dto.notes ?? slip.notes });
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
      await assertServiceEntriesMatch(tx, user.tenantId, run.id, slips);
      const emps = await tx.select({ id: employees.id, isProduction: employees.isProduction, branchId: employees.branchId }).from(employees).where(eq(employees.tenantId, user.tenantId));
      const empById = new Map(emps.map((e) => [e.id, e]));
      const sumOf = (list: typeof slips, f: keyof (typeof slips)[number]) => list.reduce<Dec>((a, p) => a.plus(D(p[f] as string)), ZERO);
      const gross = sumOf(slips, 'grossPay');
      const employerOf = (l: typeof slips) => sumOf(l, 'bpjsKesCompany').plus(sumOf(l, 'jhtCompany')).plus(sumOf(l, 'jpCompany')).plus(sumOf(l, 'jkkCompany')).plus(sumOf(l, 'jkmCompany'));
      const employer = employerOf(slips);
      const pph = sumOf(slips, 'pph21');
      const net = sumOf(slips, 'netPay');
      // Dikelompokkan per cabang karyawan: biaya gaji & utangnya berlabel cabang tempat karyawan bekerja (tiap cabang seimbang sendiri)
      const groups = new Map<string | null, typeof slips>();
      for (const p of slips) {
        const b = empById.get(p.employeeId)?.branchId ?? null;
        groups.set(b, [...(groups.get(b) ?? []), p]);
      }
      const lines = [...groups].flatMap(([branchId, list]) => {
        const grossB = sumOf(list, 'grossPay');
        const employerB = employerOf(list);
        const employeeBpjsB = sumOf(list, 'bpjsKesEmployee').plus(sumOf(list, 'jhtEmployee')).plus(sumOf(list, 'jpEmployee'));
        const prodList = list.filter((p) => empById.get(p.employeeId)?.isProduction);
        // Tenaga kerja langsung produksi → Upah Langsung Produksi (bagian harga pokok produksi)
        const directLabor = prodList.reduce<Dec>((a, p) => a.plus(p.grossPay).plus(p.bpjsKesCompany).plus(p.jhtCompany).plus(p.jpCompany).plus(p.jkkCompany).plus(p.jkmCompany), ZERO);
        const prodGross = sumOf(prodList, 'grossPay');
        return [
          { key: SYS.SALARY_EXPENSE, debit: grossB.minus(prodGross), branchId },
          { key: SYS.BPJS_EXPENSE, debit: employerB.minus(directLabor.minus(prodGross)), branchId },
          { key: SYS.DIRECT_LABOR, debit: directLabor, branchId },
          { key: SYS.SALARY_PAYABLE, credit: sumOf(list, 'netPay'), branchId },
          { key: SYS.BPJS_PAYABLE, credit: employeeBpjsB.plus(employerB), branchId },
          { key: SYS.PPH21_PAYABLE, credit: sumOf(list, 'pph21'), branchId },
          { key: SYS.EMPLOYEE_RECEIVABLE, credit: sumOf(list, 'otherDeduction'), branchId },
        ];
      });
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: run.payDate,
        description: `Gaji periode ${run.period} (${run.number}) — ${slips.length} karyawan`,
        sourceType: 'PAYROLL',
        sourceId: run.id,
        createdById: user.sub,
        lines,
      });
      await patchById(tx, payrollRuns, id, {
          status: 'POSTED',
          journalId: journal.id,
          totalGross: gross.toFixed(2),
          totalEmployerCost: gross.plus(employer).toFixed(2),
          totalPph21: pph.toFixed(2),
          totalNet: net.toFixed(2),
        });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'POST', entity: 'PayrollRun', entityId: id, data: { journal: journal.number } });
    });
    return this.getRun(user.tenantId, id);
  }

  /** Gaji bersih per cabang karyawan (untuk jurnal pembayaran) */
  private async netByBranch(tx: Tx, runId: string): Promise<[string | null, Dec][]> {
    const rows = await tx.execute<{ b: string | null; net: string }>(sql`
      SELECT e.branch_id::text AS b, SUM(p.net_pay) AS net FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId} GROUP BY e.branch_id`);
    return rows.rows.map((r) => [r.b, D(r.net)]);
  }

  /** Transfer gaji: Dr Hutang Gaji | Cr Bank */
  async pay(user: AuthUser, id: string, dto: PayRunDto) {
    const result = await this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, user.tenantId, id, 'POSTED');
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      const date = toDocDate(dto.date ?? run.payDate);
      await this.posting.assertCashCovers(tx, user.tenantId, bank, run.totalNet);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pembayaran gaji periode ${run.period} (${run.number})`,
        sourceType: 'PAYROLL_PAYMENT',
        sourceId: run.id,
        createdById: user.sub,
        lines: [
          // utang gaji dibayar per cabang karyawan; rekening bank milik cabangnya sendiri (selisih ditutup antar cabang otomatis)
          ...(await this.netByBranch(tx, run.id)).map(([branchId, v]) => ({ key: SYS.SALARY_PAYABLE, debit: v, branchId })),
          { accountId: bank.id, credit: run.totalNet, ...(bank.branchId ? { branchId: bank.branchId } : {}) },
        ],
      });
      await patchById(tx, payrollRuns, id, { status: 'PAID', paymentJournalId: journal.id, cashAccountId: bank.id });
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
      employees: res.rows.map((r) => ({ ...r, npwp: decryptField(r.npwp), nik: decryptField(r.nik), gross: money(r.gross).toFixed(2), pension: money(r.pension).toFixed(2), pph21: money(r.pph21).toFixed(2) })),
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
      rows: res.rows.map((r) => ({ ...r, nik: decryptField(r.nik) })),
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

  /** Hitung slip untuk semua karyawan aktif di periode (atau satu karyawan) */
  private async generate(tx: Tx, tenantId: string, runId: string, period: string, onlyEmployeeId?: string) {
    const { from, to } = monthRange(period);
    const settings = await this.settings.payroll(tx, tenantId);
    const allDays = workDaysBetween(from, to, settings.workDaysPerWeek);
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));

    // masa kerja efektif: keluar atau kontrak berakhir (mana lebih dulu); karyawan jasa baru ikut setelah diverifikasi
    const eligible = (await tx.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(asc(employees.code))).filter((e) => {
      const stop = EmploymentService.endOf(e);
      return (
        (!onlyEmployeeId || e.id === onlyEmployeeId) &&
        e.verified &&
        e.joinDate <= to &&
        (!stop || stop >= from) &&
        (e.isActive || (e.resignDate && e.resignDate >= from))
      );
    });
    // premi shift dari jadwal + kehadiran dibuat otomatis (menunggu persetujuan) sebelum catatan kerja dikaitkan ke slip
    await generateShiftPremiums(tx, tenantId, to);
    // Upah jasa: catatan kerja yang disetujui (jam, sesi, borongan, komisi faktur) otomatis masuk slip
    const serviceBy = await attachServiceEntries(tx, tenantId, runId, period, onlyEmployeeId ? null : new Set(eligible.map((e) => e.id)), onlyEmployeeId);
    // tenaga lepas / mitra hanya punya slip bila ada upah jasa bulan itu
    const emps = eligible.filter((e) => !isPerJob(e.employmentType) || (serviceBy.get(e.id)?.gt(0) ?? false));
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
      const stop = EmploymentService.endOf(e);
      const end = stop && stop < to ? stop : to;
      const employedDays = allDays.filter((d) => d >= start && d <= end);
      const ratio = allDays.length ? employedDays.length / allDays.length : 1;
      // Absensi berbasis pengecualian: hari kerja tanpa catatan dianggap hadir
      const workSet = new Set(employedDays);
      const mine = att.filter((a) => a.employeeId === e.id && workSet.has(a.date));
      const notPresent = mine.filter((a) => a.status !== 'HADIR').length;
      let attendance = {
        workDays: employedDays.length,
        presentDays: employedDays.length - notPresent,
        unpaidDays: mine.filter((a) => a.status === 'ALPA' || a.status === 'IZIN').length,
        overtimeByDay: mine.filter((a) => a.status === 'HADIR').map((a) => Number(a.overtimeHours)),
      };
      let baseSalary = money(D(e.baseSalary).times(ratio)).toFixed(2);
      let fixedAllowance = money(D(e.fixedAllowance).times(ratio)).toFixed(2);
      let hourlyRate: string | undefined;
      if (e.employmentType === 'HARIAN') {
        // upah harian: hanya hari yang DICATAT hadir dibayar (tidak "dianggap hadir")
        const present = mine.filter((a) => a.status === 'HADIR').length;
        attendance = { ...attendance, presentDays: present, unpaidDays: 0 };
        baseSalary = money(D(e.dailyWage).times(present)).toFixed(2);
        fixedAllowance = '0.00';
        hourlyRate = D(e.dailyWage).div(7).toFixed(4);
      } else if (isPerJob(e.employmentType)) {
        attendance = { workDays: 0, presentDays: 0, unpaidDays: 0, overtimeByDay: [] };
      }
      const prev = existingByEmp.get(e.id);
      const y = ytdBy.get(e.id);
      const calc = computePayslip(
        {
          ptkp: e.ptkp,
          // karyawan baru / keluar / kontrak berakhir di tengah bulan: gaji pokok & tunjangan tetap prorata hari kerja
          baseSalary,
          fixedAllowance,
          hourlyRate,
          dailyAllowance: e.dailyAllowance,
          bpjsKes: e.bpjsKes,
          bpjsTk: e.bpjsTk,
          bpjsJp: e.bpjsJp,
        },
        attendance,
        settings,
        {
          month,
          isFinalPeriod: month === 12 || (!!stop && stop <= to),
          prevGross: D(y?.gross),
          prevPension: D(y?.pension),
          prevWithheld: D(y?.pph),
          prevMonths: y?.n ?? 0,
        },
        { otherIncome: prev?.otherIncome, otherDeduction: prev?.otherDeduction, serviceIncome: serviceBy.get(e.id)?.toFixed(2) },
      );
      const row = { ...toRow(calc), projectId: e.projectId ?? null };
      if (prev) await patchById(tx, payslips, prev.id, row);
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
