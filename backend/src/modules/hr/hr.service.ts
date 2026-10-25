import { BadRequestException, Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, DocDate, toDocDate } from '../../common/utils/dates';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, leaveRequests, projects } from '../../db/schema';
import { applyEmploymentRules, EmploymentService, type EmpShape } from './employment.service';
import { type EmploymentType, isPerJob } from './employment.shared';
import { LinkAccountDto, CreateEmployeeDto, UpdateEmployeeDto, SaveAttendanceDto, CreateLeaveDto, DecideLeaveDto } from './hr.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { findOwned, insertOne, lockOwned, patchById } from '../../db/owned';
import { HrRepository } from './hr.repository';

const dow = (d: DocDate) => new Date(`${d}T00:00:00Z`).getUTCDay();
 // 0 = Minggu
export const isWorkDay = (d: DocDate, daysPerWeek: 5 | 6) => dow(d) !== 0 && (daysPerWeek === 6 || dow(d) !== 6);

export function workDaysBetween(from: DocDate, to: DocDate, daysPerWeek: 5 | 6): DocDate[] {
  const out: DocDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkDay(d, daysPerWeek)) out.push(d);
  return out;
}

export const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
};

@Injectable()
export class HrService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly employment: EmploymentService,
    private readonly refs: ReferenceRepository,
    private readonly repo: HrRepository,
  ) {}

  listEmployees(tenantId: string, activeOnly = false) {
    return this.db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), activeOnly ? eq(employees.isActive, true) : undefined))
      .orderBy(asc(employees.code));
  }

  async getEmployee(tenantId: string, id: string, db: DbOrTx = this.db) {
    const e = await this.refs.employee(db, tenantId, id);
    if (!e) throw new NotFoundException('Karyawan tidak ditemukan');
    return { ...e, leave: await this.leaveBalance(tenantId, e.id, e.annualLeave, db) };
  }

  /** Akun pengguna yang bisa dihubungkan ke karyawan, beserta karyawan yang sudah memakainya */
  async accounts(tenantId: string) {
    const r = await this.repo.queryUser(this.db, tenantId);
    return r.rows;
  }

  /**
   * Hubungkan/lepaskan akun pengguna dari data karyawan. Hubungan ini yang membuat karyawan bisa mencatat jam kerja, melihat jadwal, dan
   * cuti atas namanya sendiri. Satu akun hanya satu karyawan; menghubungkan akun sendiri hanya boleh Pemilik (agar pencatat tidak bisa
   * menjadikan dirinya "orang lain" di pemisahan fungsi); mengganti/melepas wajib beralasan dan tercatat.
   */
  async linkAccount(u: AuthUser, id: string, dto: LinkAccountDto) {
    const userId = dto.userId ?? null;
    return this.db.transaction(async (tx) => {
      const e = await lockOwned(tx, employees, u.tenantId, id);
      if (!e) throw new NotFoundException('Karyawan tidak ditemukan');
      if (e.userId === userId) return { ok: true, userId };
      if (e.userId && (dto.reason?.trim().length ?? 0) < 5) throw new BadRequestException('Mengganti atau melepas hubungan akun wajib menyertakan alasan (minimal 5 huruf)');
      if (userId) {
        if (userId === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Anda tidak dapat menghubungkan akun Anda sendiri ke data karyawan; minta Pemilik atau pengguna lain');
        const usr = (await this.repo.queryUserForLinkAccount(tx, userId, u.tenantId)).rows[0];
        if (!usr) throw new BadRequestException('Akun pengguna tidak ditemukan atau nonaktif');
        const taken = (await this.repo.queryEmployee(tx, u.tenantId, userId, id)).rows[0];
        if (taken) throw new ConflictException(`Akun ini sudah terhubung dengan karyawan ${taken.name}`);
      }
      await patchById(tx, employees, id, { userId });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'EmployeeAccountLink', entityId: id, data: { before: e.userId, after: userId, reason: dto.reason?.trim() } });
      return { ok: true, userId };
    });
  }

  private async assertProject(tenantId: string, projectId?: string | null) {
    if (!projectId) return;
    const [p] = await this.repo.findProjectsById(this.db, projectId, tenantId);
    if (!p) throw new BadRequestException('Proyek tidak ditemukan');
  }

  private async assertBranch(tenantId: string, branchId?: string | null) {
    if (!branchId) return;
    const r = await this.repo.queryBranche(this.db, branchId, tenantId);
    if (!r.rows.length) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
  }

  private shapeOf(e: Partial<typeof employees.$inferSelect> & { joinDate: string }): EmpShape {
    return {
      joinDate: e.joinDate,
      employmentType: (e.employmentType ?? 'TETAP') as EmploymentType,
      contractStart: e.contractStart ?? null,
      contractEnd: e.contractEnd ?? null,
      baseSalary: e.baseSalary ?? '0',
      fixedAllowance: e.fixedAllowance ?? '0',
      dailyAllowance: e.dailyAllowance ?? '0',
      dailyWage: e.dailyWage ?? '0',
      bpjsKes: e.bpjsKes ?? true,
      bpjsTk: e.bpjsTk ?? true,
      bpjsJp: e.bpjsJp ?? true,
    };
  }

  async createEmployee(user: AuthUser, dto: CreateEmployeeDto) {
    await this.assertProject(user.tenantId, dto.projectId);
    await this.assertBranch(user.tenantId, dto.branchId);
    const model = await this.settings.businessModel(this.db, user.tenantId);
    const joinDate = toDocDate(dto.joinDate);
    const norm = applyEmploymentRules(model, this.shapeOf({ ...dto, joinDate }));
    const jasa = model === 'JASA';
    if (jasa) await this.employment.assertNoDuplicates(this.db, user.tenantId, null, dto);
    const e = await insertOne(this.db, employees, {
        ...dto,
        tenantId: user.tenantId,
        code: dto.code.trim().toUpperCase(),
        joinDate,
        employmentType: norm.employmentType,
        contractStart: norm.contractStart,
        contractEnd: norm.contractEnd,
        bpjsKes: norm.bpjsKes,
        bpjsTk: norm.bpjsTk,
        bpjsJp: norm.bpjsJp,
        createdById: user.sub,
        // usaha jasa: karyawan baru diverifikasi orang lain dulu (Pemilik langsung sah)
        verified: !jasa || user.role === 'OWNER',
        ...(!jasa || user.role === 'OWNER' ? { verifiedById: user.sub, verifiedAt: new Date() } : {}),
      });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Employee', entityId: e.id, data: { type: e.employmentType, verified: e.verified } });
    return e;
  }

  async updateEmployee(user: AuthUser, id: string, dto: UpdateEmployeeDto) {
    await this.getEmployee(user.tenantId, id);
    await this.assertProject(user.tenantId, dto.projectId);
    await this.assertBranch(user.tenantId, dto.branchId);
    const { reason, ...body } = dto;
    const [emp] = await this.repo.findEmployeesById(this.db, id);
    const model = await this.settings.businessModel(this.db, user.tenantId);
    const jasa = model === 'JASA';
    let direct: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    let request: { id: string; fields: string[] } | null = null;
    if (jasa) {
      ({ direct, request } = await this.employment.splitUpdate(user, emp, direct, reason));
    }
    // aturan status berlaku pada hasil akhir (data lama + perubahan yang langsung berlaku)
    const merged = { ...emp, ...direct, joinDate: toDocDate((direct.joinDate as string) ?? emp.joinDate) } as typeof emp;
    const norm = applyEmploymentRules(model, this.shapeOf(merged));
    if (jasa) {
      await this.employment.assertNoDuplicates(this.db, user.tenantId, id, { nik: merged.nik, npwp: merged.npwp, bankAccount: merged.bankAccount });
      for (const k of ['bpjsKes', 'bpjsTk', 'bpjsJp'] as const) if (norm[k] !== merged[k]) direct[k] = norm[k];
    }
    const [e] = Object.keys(direct).length
      ? await this.repo.updateEmployeesById(this.db, direct, id)
      : [emp];
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'Employee', entityId: id, data: { applied: direct, requested: request?.fields } });
    return { ...e, pendingChange: request };
  }

  /** Absensi satu tanggal: semua karyawan aktif + catatan yang sudah ada */
  async attendanceDay(tenantId: string, date: DocDate) {
    const emps = (await this.listEmployees(tenantId, true)).filter((e) => !isPerJob(e.employmentType));
    const rows = await this.repo.listAttendancesByDate(this.db, tenantId, date);
    const byEmp = new Map(rows.map((r) => [r.employeeId, r]));
    const s = await this.settings.payroll(this.db, tenantId);
    return {
      date,
      isWorkDay: isWorkDay(date, s.workDaysPerWeek),
      rows: emps.map((e) => ({ employee: { id: e.id, code: e.code, name: e.name, jobTitle: e.jobTitle }, record: byEmp.get(e.id) ?? null })),
    };
  }

  async saveAttendance(user: AuthUser, dto: SaveAttendanceDto) {
    const date = toDocDate(dto.date);
    const ids = [...new Set(dto.rows.map((r) => r.employeeId))];
    const found = await this.repo.listEmployeesById(this.db, user.tenantId, ids);
    if (found.length !== ids.length) throw new BadRequestException('Ada karyawan yang tidak ditemukan');
    if (found.some((f) => isPerJob(f.type))) throw new BadRequestException('Tenaga lepas / mitra tidak diabsen; upahnya dari catatan kerja');
    await this.db.transaction(async (tx) => {
      for (const r of dto.rows) {
        const values = {
          tenantId: user.tenantId,
          employeeId: r.employeeId,
          date,
          status: r.status,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          overtimeHours: r.status === 'HADIR' ? (r.overtimeHours ?? '0') : '0',
          notes: r.notes,
        };
        await tx
          .insert(attendances)
          .values(values)
          .onConflictDoUpdate({ target: [attendances.employeeId, attendances.date], set: values });
      }
    });
    return this.attendanceDay(user.tenantId, date);
  }

  /** Rekap absensi per karyawan dalam satu bulan */
  async attendanceMonth(tenantId: string, period: string) {
    const { from, to } = monthRange(period);
    const res = await this.repo.queryAttendance(this.db, tenantId, from, to);
    const emps = (await this.listEmployees(tenantId, true)).filter((e) => !isPerJob(e.employmentType));
    const s = await this.settings.payroll(this.db, tenantId);
    const workDays = workDaysBetween(from, to, s.workDaysPerWeek).length;
    return {
      period,
      workDays,
      rows: emps.map((e) => {
        const mine = res.rows.filter((r) => r.employee_id === e.id);
        const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((st) => [st, mine.find((r) => r.status === st)?.n ?? 0]));
        return {
          employee: { id: e.id, code: e.code, name: e.name },
          counts,
          overtimeHours: mine.reduce((a, r) => a + Number(r.ot), 0),
          recorded: mine.reduce((a, r) => a + r.n, 0),
        };
      }),
    };
  }

  /** Sisa cuti tahunan tahun berjalan */
  async leaveBalance(tenantId: string, employeeId: string, quota: number, db: DbOrTx = this.db, year = new Date().getFullYear()) {
    const [r] = (
      await this.repo.queryLeaveRequest(db, tenantId, employeeId, year)
    ).rows;
    return { year, quota, used: r.used, remaining: quota - r.used };
  }

  listLeaves(tenantId: string, status?: string) {
    return this.db.query.leaveRequests.findMany({
      where: and(
        eq(leaveRequests.tenantId, tenantId),
        status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? eq(leaveRequests.status, status) : undefined,
      ),
      with: { employee: { columns: { id: true, code: true, name: true } } },
      orderBy: desc(leaveRequests.createdAt),
      limit: 300,
    });
  }

  async createLeave(user: AuthUser, dto: CreateLeaveDto) {
    const emp = await this.getEmployee(user.tenantId, dto.employeeId);
    if (isPerJob(emp.employmentType)) throw new BadRequestException('Tenaga lepas / mitra tidak punya cuti');
    const start = toDocDate(dto.startDate);
    const end = toDocDate(dto.endDate);
    if (end < start) throw new BadRequestException('Tanggal selesai sebelum tanggal mulai');
    const s = await this.settings.payroll(this.db, user.tenantId);
    const days = workDaysBetween(start, end, s.workDaysPerWeek).length;
    if (!days) throw new BadRequestException('Rentang tanggal tidak berisi hari kerja');
    if (dto.type === 'ANNUAL' && days > emp.leave.remaining) {
      throw new BadRequestException(`Sisa cuti tahunan ${emp.leave.remaining} hari, diajukan ${days} hari`);
    }
    const [overlap] = await this.repo.findLeaveRequestsByEmployeeIdAndStatusAndStartDate(this.db, emp.id, end, start);
    if (overlap) throw new BadRequestException('Sudah ada pengajuan cuti di tanggal yang sama');
    const l = await insertOne(this.db, leaveRequests, { tenantId: user.tenantId, employeeId: emp.id, type: dto.type, startDate: start, endDate: end, days, reason: dto.reason });
    return l;
  }

  /** Setujui → absensi hari kerja di rentang itu otomatis CUTI (atau ALPA untuk cuti tidak dibayar) */
  async decideLeave(user: AuthUser, id: string, dto: DecideLeaveDto) {
    return this.db.transaction(async (tx) => {
      const l = await findOwned(tx, leaveRequests, user.tenantId, id);
      if (!l) throw new NotFoundException('Pengajuan cuti tidak ditemukan');
      if (l.status !== 'PENDING') throw new BadRequestException('Pengajuan sudah diputuskan');
      if (dto.decision === 'APPROVED') {
        const emp = await this.getEmployee(user.tenantId, l.employeeId, tx);
        if (l.type === 'ANNUAL' && l.days > emp.leave.remaining) {
          throw new BadRequestException(`Sisa cuti tahunan tinggal ${emp.leave.remaining} hari`);
        }
        const s = await this.settings.payroll(tx, user.tenantId);
        for (const date of workDaysBetween(l.startDate, l.endDate, s.workDaysPerWeek)) {
          const values = {
            tenantId: user.tenantId,
            employeeId: l.employeeId,
            date,
            status: (l.type === 'SICK' ? 'SAKIT' : l.type === 'UNPAID' ? 'IZIN' : 'CUTI') as AttendanceStatus,
            overtimeHours: '0',
            notes: l.type === 'UNPAID' ? 'Cuti tidak dibayar' : (l.reason ?? null),
          };
          await this.repo.insertAttendances(tx, values);
        }
      }
      const [updated] = await this.repo.updateLeaveRequestsById(tx, dto.decision, user.sub, id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: dto.decision, entity: 'LeaveRequest', entityId: id });
      return updated;
    });
  }
}
