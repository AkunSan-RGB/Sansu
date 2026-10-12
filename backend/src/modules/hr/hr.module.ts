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
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  LEAVE_TYPES,
  type LeaveType,
  PTKP_STATUSES,
  type PtkpStatus,
} from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SettingsService } from '../../common/settings.service';
import { addDays, DocDate, toDocDate } from '../../common/utils/dates';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, leaveRequests, projects } from '../../db/schema';
import { IsNik, IsNpwp } from '../../common/validators/npwp';

// ---------- Kalender kerja ----------
const dow = (d: DocDate) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Minggu
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

// ---------- DTO ----------
export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-001' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'Siti Rahma' }) @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNik() nik?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) @IsNpwp() npwp?: string;
  @ApiProperty({ enum: PTKP_STATUSES }) @IsIn(PTKP_STATUSES) ptkp: PtkpStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiProperty({ example: '2025-01-02' }) @IsDateString() joinDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankAccount?: string;
  @ApiProperty({ example: '5000000' }) @IsNumberString() baseSalary: string;
  @ApiPropertyOptional({ example: '500000' }) @IsOptional() @IsNumberString() fixedAllowance?: string;
  @ApiPropertyOptional({ example: '30000' }) @IsOptional() @IsNumberString() dailyAllowance?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsKes?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsTk?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsJp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(60) annualLeave?: number;
  @ApiPropertyOptional({ description: 'Ditempatkan di proyek (gaji jadi biaya langsung proyek); null = kantor' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  projectId?: string | null;
  @ApiPropertyOptional({ description: 'Tenaga kerja langsung produksi (gaji masuk harga pokok produksi)' }) @IsOptional() @IsBoolean() isProduction?: boolean;
}
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() resignDate?: string;
}

export class AttendanceRowDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES }) @IsIn(ATTENDANCE_STATUSES) status: AttendanceStatus;
  @ApiPropertyOptional({ example: '08:00' }) @IsOptional() @Matches(/^\d{2}:\d{2}$/) checkIn?: string;
  @ApiPropertyOptional({ example: '17:00' }) @IsOptional() @Matches(/^\d{2}:\d{2}$/) checkOut?: string;
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @IsNumberString() overtimeHours?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class SaveAttendanceDto {
  @ApiProperty({ example: '2026-10-05' }) @IsDateString() date: string;
  @ApiProperty({ type: [AttendanceRowDto] })
  @ValidateNested({ each: true })
  @Type(() => AttendanceRowDto)
  @ArrayMinSize(1)
  rows: AttendanceRowDto[];
}

export class CreateLeaveDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ enum: LEAVE_TYPES }) @IsIn(LEAVE_TYPES) type: LeaveType;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() endDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}
export class DecideLeaveDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
}

// ---------- Service ----------
@Injectable()
export class HrService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  listEmployees(tenantId: string, activeOnly = false) {
    return this.db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), activeOnly ? eq(employees.isActive, true) : undefined))
      .orderBy(asc(employees.code));
  }

  async getEmployee(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)));
    if (!e) throw new NotFoundException('Karyawan tidak ditemukan');
    return { ...e, leave: await this.leaveBalance(tenantId, e.id, e.annualLeave, db) };
  }

  private async assertProject(tenantId: string, projectId?: string | null) {
    if (!projectId) return;
    const [p] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!p) throw new BadRequestException('Proyek tidak ditemukan');
  }

  async createEmployee(user: AuthUser, dto: CreateEmployeeDto) {
    await this.assertProject(user.tenantId, dto.projectId);
    const [e] = await this.db
      .insert(employees)
      .values({ ...dto, tenantId: user.tenantId, code: dto.code.trim().toUpperCase(), joinDate: toDocDate(dto.joinDate) })
      .returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Employee', entityId: e.id });
    return e;
  }

  async updateEmployee(user: AuthUser, id: string, dto: UpdateEmployeeDto) {
    await this.getEmployee(user.tenantId, id);
    await this.assertProject(user.tenantId, dto.projectId);
    const [e] = await this.db
      .update(employees)
      .set({ ...dto, code: dto.code?.trim().toUpperCase() })
      .where(eq(employees.id, id))
      .returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'Employee', entityId: id, data: dto });
    return e;
  }

  /** Absensi satu tanggal: semua karyawan aktif + catatan yang sudah ada */
  async attendanceDay(tenantId: string, date: DocDate) {
    const emps = await this.listEmployees(tenantId, true);
    const rows = await this.db.select().from(attendances).where(and(eq(attendances.tenantId, tenantId), eq(attendances.date, date)));
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
    const found = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, user.tenantId), inArray(employees.id, ids)));
    if (found.length !== ids.length) throw new BadRequestException('Ada karyawan yang tidak ditemukan');
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
    const res = await this.db.execute<{ employee_id: string; status: AttendanceStatus; n: number; ot: string }>(sql`
      SELECT employee_id, status, COUNT(*)::int AS n, COALESCE(SUM(overtime_hours), 0) AS ot
      FROM attendances WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to}
      GROUP BY employee_id, status`);
    const emps = await this.listEmployees(tenantId, true);
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
      await db.execute<{ used: number }>(sql`
      SELECT COALESCE(SUM(days), 0)::int AS used FROM leave_requests
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} AND type = 'ANNUAL' AND status = 'APPROVED'
        AND start_date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`}`)
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
    const start = toDocDate(dto.startDate);
    const end = toDocDate(dto.endDate);
    if (end < start) throw new BadRequestException('Tanggal selesai sebelum tanggal mulai');
    const s = await this.settings.payroll(this.db, user.tenantId);
    const days = workDaysBetween(start, end, s.workDaysPerWeek).length;
    if (!days) throw new BadRequestException('Rentang tanggal tidak berisi hari kerja');
    if (dto.type === 'ANNUAL' && days > emp.leave.remaining) {
      throw new BadRequestException(`Sisa cuti tahunan ${emp.leave.remaining} hari, diajukan ${days} hari`);
    }
    const [overlap] = await this.db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, emp.id),
          inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
          lte(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start),
        ),
      );
    if (overlap) throw new BadRequestException('Sudah ada pengajuan cuti di tanggal yang sama');
    const [l] = await this.db
      .insert(leaveRequests)
      .values({ tenantId: user.tenantId, employeeId: emp.id, type: dto.type, startDate: start, endDate: end, days, reason: dto.reason })
      .returning();
    return l;
  }

  /** Setujui → absensi hari kerja di rentang itu otomatis CUTI (atau ALPA untuk cuti tidak dibayar) */
  async decideLeave(user: AuthUser, id: string, dto: DecideLeaveDto) {
    return this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(leaveRequests)
        .where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, user.tenantId)));
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
          await tx.insert(attendances).values(values).onConflictDoUpdate({ target: [attendances.employeeId, attendances.date], set: values });
        }
      }
      const [updated] = await tx
        .update(leaveRequests)
        .set({ status: dto.decision, decidedById: user.sub })
        .where(eq(leaveRequests.id, id))
        .returning();
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: dto.decision, entity: 'LeaveRequest', entityId: id });
      return updated;
    });
  }
}

// ---------- Controller ----------
@ApiTags('SDM')
@ApiBearerAuth()
@RequireApp('hr')
@Roles('HR')
@Controller('hr')
export class HrController {
  constructor(private readonly svc: HrService) {}

  @Get('employees')
  @Roles('HR', 'FINANCE')
  employees(@CurrentUser() u: AuthUser, @Query('active') active?: string) {
    return this.svc.listEmployees(u.tenantId, active === '1');
  }
  @Get('employees/:id')
  @Roles('HR', 'FINANCE')
  employee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getEmployee(u.tenantId, id);
  }
  @Post('employees')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.svc.createEmployee(u, dto);
  }
  @Patch('employees/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.svc.updateEmployee(u, id, dto);
  }

  @Get('attendance')
  day(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    return this.svc.attendanceDay(u.tenantId, toDocDate(date));
  }
  @Post('attendance')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveAttendanceDto) {
    return this.svc.saveAttendance(u, dto);
  }
  @Get('attendance/month')
  month(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? period : toDocDate().slice(0, 7);
    return this.svc.attendanceMonth(u.tenantId, p);
  }

  @Get('leaves')
  leaves(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.listLeaves(u.tenantId, status);
  }
  @Post('leaves')
  createLeave(@CurrentUser() u: AuthUser, @Body() dto: CreateLeaveDto) {
    return this.svc.createLeave(u, dto);
  }
  @Post('leaves/:id/decide')
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto) {
    return this.svc.decideLeave(u, id, dto);
  }
}

@Module({
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
