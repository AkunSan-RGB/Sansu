import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WORK_UNITS_BY_MODEL } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { employees, serviceRates, shiftAssignments, shiftTemplates } from '../../db/schema';
import { CreateTemplateDto, UpdateTemplateDto, AssignDto, RosterQueryDto } from './shifts.dto';
import { findOwned, insertOne } from '../../db/owned';
import { ShiftsRepository } from './shifts.repository';

export const SHIFT_RULES = { maxPerDay: 2, minRestHours: 8, maxConsecutiveDays: 6, normalWeekHours: 40, maxWeekHours: 58, maxAheadDays: 90 } as const;

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const dayIdx = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

/** Panjang shift dalam menit (shift lewat tengah malam: jam selesai < jam mulai) */
export const shiftMinutes = (start: string, end: string) => (minutes(end) > minutes(start) ? minutes(end) - minutes(start) : minutes(end) + 1440 - minutes(start));

const interval = (date: string, start: string, end: string): [number, number] => {
  const s = dayIdx(date) * 1440 + minutes(start);
  return [s, s + shiftMinutes(start, end)];
};

const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

type Tpl = typeof shiftTemplates.$inferSelect;

/**
 * Dipanggil penggajian dan layar jadwal: buat catatan premi untuk penugasan yang sudah lewat/hari ini dan pegawainya tercatat HADIR.
 * Dibuat atas nama pembuat jadwal (menunggu keputusan orang lain), idempoten per penugasan.
 */
export async function generateShiftPremiums(db: DbOrTx, tenantId: string, upTo: string): Promise<number> {
  const r = await db.execute<{ id: string }>(sql`
    INSERT INTO service_work_entries (tenant_id, employee_id, rate_id, unit, work_date, quantity, rate, amount, description, status, created_by_id, shift_assignment_id)
    SELECT a.tenant_id, a.employee_id, sr.id, 'SHIFT', a.work_date, 1, sr.rate, sr.rate, 'Premi shift ' || t.name || ' (jadwal)', 'PENDING', a.created_by_id, a.id
    FROM shift_assignments a
    JOIN shift_templates t ON t.id = a.template_id
    JOIN service_rates sr ON sr.id = t.premium_rate_id AND sr.is_active AND sr.unit = 'SHIFT'
    JOIN employees e ON e.id = a.employee_id AND e.verified AND (e.contract_end IS NULL OR e.contract_end >= a.work_date) AND (e.resign_date IS NULL OR e.resign_date >= a.work_date)
    JOIN attendances at ON at.employee_id = a.employee_id AND at.date = a.work_date AND at.status = 'HADIR'
    WHERE a.tenant_id = ${tenantId} AND a.work_date <= ${upTo} AND a.work_date >= ${addDays(upTo, -62)}
      AND NOT EXISTS (SELECT 1 FROM service_work_entries w WHERE w.shift_assignment_id = a.id AND w.status IN ('PENDING','APPROVED'))
      AND NOT EXISTS (SELECT 1 FROM service_work_entries w2 WHERE w2.employee_id = a.employee_id AND w2.work_date = a.work_date AND w2.rate_id = sr.id AND w2.status IN ('PENDING','APPROVED') AND w2.shift_assignment_id IS NULL)
    ON CONFLICT DO NOTHING
    RETURNING id`);
  return r.rows.length;
}

@Injectable()
export class ShiftsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly repo: ShiftsRepository,
  ) {}

  private async requireShiftModel(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    if (!WORK_UNITS_BY_MODEL[model].includes('SHIFT')) throw new BadRequestException('Jadwal shift untuk Ritel, F&B, dan Manufaktur');
  }

  /** Nama pegawai aktif untuk memilih petugas shift — tanpa data gaji/rekening, jadi aman dibuka untuk Admin */
  async staff(u: AuthUser) {
    const r = await this.repo.queryEmployee(this.db, u.tenantId);
    return r.rows;
  }

  async templates(u: AuthUser) {
    await this.requireShiftModel(u.tenantId);
    const rows = await this.repo.queryShiftTemplate(this.db, u.tenantId);
    return rows.rows.map((r) => ({ ...r, hours: Number((shiftMinutes(r.startTime as string, r.endTime as string) / 60).toFixed(1)) })) as (Record<string, unknown> & { hours: number })[];
  }

  private async checkRate(tenantId: string, rateId: string | null | undefined) {
    if (!rateId) return;
    const r = await findOwned(this.db, serviceRates, tenantId, rateId);
    if (!r || r.unit !== 'SHIFT' || !r.isActive) throw new BadRequestException('Tarif premi harus kartu tarif aktif bersatuan "per shift" (diatur Keuangan di Upah)');
  }

  async createTemplate(u: AuthUser, dto: CreateTemplateDto) {
    await this.requireShiftModel(u.tenantId);
    const mins = shiftMinutes(dto.startTime, dto.endTime);
    if (dto.startTime === dto.endTime || mins < 60 || mins > 14 * 60) throw new BadRequestException('Lama shift 1–14 jam');
    await this.checkRate(u.tenantId, dto.premiumRateId);
    const [dup] = await this.repo.findShiftTemplatesByName(this.db, u.tenantId, dto.name);
    if (dup) throw new BadRequestException('Nama shift sudah dipakai');
    const row = await insertOne(this.db, shiftTemplates, { tenantId: u.tenantId, name: dto.name.trim(), startTime: dto.startTime, endTime: dto.endTime, minStaff: dto.minStaff ?? 1, premiumRateId: dto.premiumRateId ?? null, createdById: u.sub });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ShiftTemplate', entityId: row.id, data: { name: row.name, start: row.startTime, end: row.endTime } });
    return row;
  }

  async updateTemplate(u: AuthUser, id: string, dto: UpdateTemplateDto) {
    await this.requireShiftModel(u.tenantId);
    const t = await findOwned(this.db, shiftTemplates, u.tenantId, id);
    if (!t) throw new NotFoundException('Shift tidak ditemukan');
    if (dto.premiumRateId !== undefined) await this.checkRate(u.tenantId, dto.premiumRateId);
    const [row] = await this.repo.updateShiftTemplatesById(this.db, dto.minStaff, dto.premiumRateId, dto.isActive, id);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ShiftTemplate', entityId: id, data: { before: { minStaff: t.minStaff, premiumRateId: t.premiumRateId, isActive: t.isActive }, after: { minStaff: row.minStaff, premiumRateId: row.premiumRateId, isActive: row.isActive } } });
    return row;
  }

  /** Periksa dan simpan satu penugasan; mengembalikan peringatan (bukan kesalahan) bila ada */
  private async assignOne(u: AuthUser, tpl: Tpl, employeeId: string, date: string): Promise<{ id: string; warnings: string[] }> {
    const today = todayJakarta();
    if (date < today) throw new BadRequestException('Jadwal hanya untuk hari ini dan ke depan');
    if (date > addDays(today, SHIFT_RULES.maxAheadDays)) throw new BadRequestException(`Jadwal maksimal ${SHIFT_RULES.maxAheadDays} hari ke depan`);
    return this.db.transaction(async (tx) => {
      const lock = await this.repo.queryEmployeeForAssignOne(tx, employeeId, u.tenantId);
      if (!lock.rows.length) throw new NotFoundException('Pegawai tidak ditemukan');
      const [emp] = await this.repo.findEmployeesById(tx, employeeId);
      if (!emp.isActive || !emp.verified) throw new BadRequestException(`${emp.name}: pegawai tidak aktif / belum diverifikasi`);
      if (emp.userId && emp.userId === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Anda tidak dapat menjadwalkan diri sendiri (premi shift)');
      if (date < emp.joinDate || (emp.resignDate && date > emp.resignDate) || (emp.contractEnd && date > emp.contractEnd)) throw new BadRequestException(`${emp.name}: di luar masa kerja / kontrak pada ${date}`);
      const leave = await this.repo.queryLeaveRequest(tx, employeeId, date);
      if (leave.rows.length) throw new BadRequestException(`${emp.name}: cuti yang disetujui pada ${date}`);
      const near = await this.repo.queryShiftAssignment(tx, employeeId, date);
      if (near.rows.some((a) => a.work_date === date && a.template_id === tpl.id)) throw new BadRequestException(`${emp.name}: sudah dijadwalkan di shift ini`);
      if (near.rows.filter((a) => a.work_date === date).length >= SHIFT_RULES.maxPerDay) throw new BadRequestException(`${emp.name}: maksimal ${SHIFT_RULES.maxPerDay} shift per hari`);
      const [ns, ne] = interval(date, tpl.startTime, tpl.endTime);
      for (const a of near.rows) {
        const [s, e] = interval(a.work_date, a.start_time, a.end_time);
        if (ns < e && s < ne) throw new BadRequestException(`${emp.name}: bentrok dengan shift lain pada ${a.work_date}`);
        const gap = ns >= e ? ns - e : s - ne;
        if (gap < SHIFT_RULES.minRestHours * 60) throw new BadRequestException(`${emp.name}: istirahat antar shift kurang dari ${SHIFT_RULES.minRestHours} jam (shift ${a.work_date})`);
      }
      // hari berturut-turut
      const days = new Set([...near.rows.map((a) => dayIdx(a.work_date)), dayIdx(date)]);
      let run = 1;
      for (let d = dayIdx(date) - 1; days.has(d); d--) run++;
      for (let d = dayIdx(date) + 1; days.has(d); d++) run++;
      if (run > SHIFT_RULES.maxConsecutiveDays) throw new BadRequestException(`${emp.name}: lebih dari ${SHIFT_RULES.maxConsecutiveDays} hari kerja berturut-turut`);
      // jam per minggu
      const ws = weekStart(date);
      const week = await this.repo.queryShiftAssignmentForAssignOne(tx, employeeId, ws);
      const hours = (week.rows.reduce((a, r) => a + shiftMinutes(r.start_time, r.end_time), 0) + shiftMinutes(tpl.startTime, tpl.endTime)) / 60;
      if (hours > SHIFT_RULES.maxWeekHours) throw new BadRequestException(`${emp.name}: ${hours.toFixed(1)} jam dalam seminggu melebihi batas ${SHIFT_RULES.maxWeekHours} jam`);
      const warnings = hours > SHIFT_RULES.normalWeekHours ? [`${emp.name}: ${hours.toFixed(1)} jam minggu ini melebihi ${SHIFT_RULES.normalWeekHours} jam normal (selisihnya lembur)`] : [];
      const [row] = await this.repo.insertShiftAssignments(tx, u.tenantId, employeeId, tpl.id, date, u.sub);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ShiftAssignment', entityId: row.id, data: { employee: emp.code, date, shift: tpl.name } });
      return { id: row.id, warnings };
    });
  }

  async assign(u: AuthUser, dto: AssignDto) {
    await this.requireShiftModel(u.tenantId);
    const tpl = await findOwned(this.db, shiftTemplates, u.tenantId, dto.templateId);
    if (!tpl || !tpl.isActive) throw new BadRequestException('Shift tidak ditemukan / nonaktif');
    const results: { employeeId: string; date: string; ok: boolean; error?: string; warnings?: string[] }[] = [];
    for (const employeeId of dto.employeeIds) {
      for (const date of [...new Set(dto.dates)].sort()) {
        try {
          const r = await this.assignOne(u, tpl, employeeId, date);
          results.push({ employeeId, date, ok: true, warnings: r.warnings });
        } catch (e) {
          results.push({ employeeId, date, ok: false, error: (e as Error).message });
        }
      }
    }
    return { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  async unassign(u: AuthUser, id: string) {
    await this.requireShiftModel(u.tenantId);
    const a = await findOwned(this.db, shiftAssignments, u.tenantId, id);
    if (!a) throw new NotFoundException('Penugasan tidak ditemukan');
    if (a.workDate < todayJakarta()) throw new BadRequestException('Jadwal yang sudah lewat tidak bisa diubah');
    const used = await this.repo.queryServiceWorkEntry(this.db, id);
    if (used.rows.length) throw new BadRequestException('Penugasan ini sudah punya premi shift; batalkan premi dulu');
    await this.repo.deleteShiftAssignmentsById(this.db, id);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'DELETE', entity: 'ShiftAssignment', entityId: id, data: { date: a.workDate } });
    return { id };
  }

  /** Jadwal rentang tanggal + kekurangan petugas per shift */
  async roster(u: AuthUser, q: RosterQueryDto) {
    await this.requireShiftModel(u.tenantId);
    if (q.to < q.from || dayIdx(q.to) - dayIdx(q.from) > 42) throw new BadRequestException('Rentang jadwal maksimal 6 minggu');
    await generateShiftPremiums(this.db, u.tenantId, todayJakarta());
    const rows = await this.repo.queryShiftAssignmentForRoster(this.db, u.tenantId, q.from, q.to);
    const tpls = await this.templates(u);
    const gaps: { date: string; templateId: string; templateName: string; need: number; have: number }[] = [];
    for (let d = dayIdx(q.from); d <= dayIdx(q.to); d++) {
      const date = new Date(d * 86400000).toISOString().slice(0, 10);
      for (const t of tpls.filter((x) => x.isActive && Number(x.minStaff) > 0)) {
        const have = rows.rows.filter((r) => r.workDate === date && r.templateId === t.id).length;
        if (have < Number(t.minStaff)) gaps.push({ date, templateId: t.id as string, templateName: t.name as string, need: Number(t.minStaff), have });
      }
    }
    return { assignments: rows.rows, gaps };
  }
}
