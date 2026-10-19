/**
 * Karyawan usaha jasa. Usaha jasa mempekerjakan orang dengan status berbeda-beda: tetap, kontrak (PKWT), harian, tenaga lepas
 * (dibayar per catatan kerja), magang, dan mitra. Status menentukan cara bayar, BPJS, dan batas waktu; berubahnya status/gaji/rekening
 * adalah titik kecurangan gaji yang klasik (karyawan fiktif, rekening dialihkan, kontrak habis tetap digaji), jadi:
 *  - karyawan baru baru ikut penggajian setelah diverifikasi orang lain (Keuangan/Admin)
 *  - perubahan data sensitif oleh HR menjadi permintaan yang harus disetujui orang lain; nilai lama-baru tersimpan
 *  - NIK / NPWP / rekening yang sama dengan karyawan aktif lain ditolak
 *  - kontrak/magang wajib punya tanggal akhir; gaji dan catatan kerja otomatis berhenti di tanggal itu; perpanjangan lewat persetujuan
 *  - upah harian hanya dibayar untuk hari yang dicatat HADIR (tidak "dianggap hadir")
 */
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, eq, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { decryptField, encryptField } from '../../common/utils/secret';
import { employeeChangeRequests, employees } from '../../db/schema';

export const EMPLOYMENT_TYPES = ['TETAP', 'KONTRAK', 'HARIAN', 'TENAGA_LEPAS', 'MAGANG', 'MITRA'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  TETAP: 'Karyawan tetap',
  KONTRAK: 'Kontrak (PKWT)',
  HARIAN: 'Harian',
  TENAGA_LEPAS: 'Tenaga lepas (per pekerjaan)',
  MAGANG: 'Magang',
  MITRA: 'Mitra / konsultan',
};
/** Dibayar lewat catatan kerja, bukan gaji tetap; tidak absen harian */
export const isPerJob = (t: string) => t === 'TENAGA_LEPAS' || t === 'MITRA';

/** Kolom yang perubahannya oleh HR harus disetujui orang lain (usaha jasa) */
export const SENSITIVE_FIELDS = [
  'baseSalary', 'fixedAllowance', 'dailyAllowance', 'dailyWage', 'bankName', 'bankAccount', 'employmentType', 'contractStart', 'contractEnd',
  'bpjsKes', 'bpjsTk', 'bpjsJp', 'ptkp', 'nik', 'npwp', 'reactivate',
] as const;
const DIGITS = (v: unknown) => String(v ?? '').replace(/\D/g, '');

type Changes = Record<string, { from: unknown; to: unknown }>;
const ID_FIELDS = ['nik', 'npwp', 'bankAccount'];
/** Nilai identitas pada permintaan perubahan ikut terenkripsi di database (kolom jsonb), sama seperti kolom aslinya */
const sealChanges = (c: Changes): Changes =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, ID_FIELDS.includes(k) ? { from: typeof v.from === 'string' ? encryptField(v.from) : v.from, to: typeof v.to === 'string' ? encryptField(v.to) : v.to } : v]));
const openChanges = (c: Changes): Changes =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, ID_FIELDS.includes(k) ? { from: typeof v.from === 'string' ? decryptField(v.from) : v.from, to: typeof v.to === 'string' ? decryptField(v.to) : v.to } : v]));

export interface EmpShape {
  joinDate: string;
  employmentType: EmploymentType;
  contractStart: string | null;
  contractEnd: string | null;
  baseSalary: string;
  fixedAllowance: string;
  dailyAllowance: string;
  dailyWage: string;
  bpjsKes: boolean;
  bpjsTk: boolean;
  bpjsJp: boolean;
  resignDate?: string | null;
  isActive?: boolean;
}

/** Aturan status kepegawaian. Mengembalikan data yang sudah dinormalkan (mis. BPJS dimatikan untuk tenaga lepas). */
export function applyEmploymentRules<T extends EmpShape>(model: string, e: T): T {
  const out = { ...e };
  if (model !== 'JASA') {
    if (out.employmentType !== 'TETAP') throw new BadRequestException('Status kepegawaian selain tetap khusus usaha jasa');
    if (out.contractStart || out.contractEnd) throw new BadRequestException('Tanggal kontrak khusus usaha jasa');
    if (D(out.dailyWage).gt(0)) throw new BadRequestException('Upah harian khusus usaha jasa');
    return out;
  }
  const t = out.employmentType;
  const base = D(out.baseSalary);
  const fixed = D(out.fixedAllowance);
  const daily = D(out.dailyAllowance);
  const wage = D(out.dailyWage);
  if (t === 'TETAP') {
    if (out.contractEnd) throw new BadRequestException('Karyawan tetap tidak punya tanggal akhir kontrak');
    if (base.lte(0)) throw new BadRequestException('Gaji pokok karyawan tetap harus lebih dari 0');
    if (wage.gt(0)) throw new BadRequestException('Upah harian hanya untuk status harian');
  } else if (t === 'KONTRAK' || t === 'MAGANG') {
    if (!out.contractEnd) throw new BadRequestException('Kontrak / magang wajib punya tanggal akhir');
    if (out.contractEnd < out.joinDate) throw new BadRequestException('Tanggal akhir kontrak sebelum mulai kerja');
    if (out.contractStart && out.contractStart > out.contractEnd) throw new BadRequestException('Tanggal akhir kontrak sebelum tanggal mulai kontrak');
    if (t === 'KONTRAK' && base.lte(0)) throw new BadRequestException('Gaji pokok karyawan kontrak harus lebih dari 0');
    if (wage.gt(0)) throw new BadRequestException('Upah harian hanya untuk status harian');
    const start = new Date(`${out.contractStart ?? out.joinDate}T00:00:00Z`);
    const end = new Date(`${out.contractEnd}T00:00:00Z`);
    if (t === 'KONTRAK' && end.getTime() - start.getTime() > 5 * 366 * 86400000) throw new BadRequestException('Kontrak (PKWT) maksimal 5 tahun');
  } else if (t === 'HARIAN') {
    if (wage.lte(0)) throw new BadRequestException('Upah per hari harus lebih dari 0');
    if (base.gt(0) || fixed.gt(0)) throw new BadRequestException('Karyawan harian tidak punya gaji pokok / tunjangan tetap bulanan');
    if (out.contractEnd) throw new BadRequestException('Karyawan harian tidak punya tanggal akhir kontrak');
  } else {
    // TENAGA_LEPAS, MITRA: dibayar dari catatan kerja
    if (base.gt(0) || fixed.gt(0) || daily.gt(0) || wage.gt(0)) throw new BadRequestException('Tenaga lepas / mitra dibayar dari catatan kerja: gaji pokok, tunjangan, dan upah harian harus 0');
    out.bpjsKes = false;
    out.bpjsTk = false;
    out.bpjsJp = false;
    out.contractEnd = out.contractEnd ?? null;
  }
  return out;
}

export class ProposeReasonDto {
  @ApiPropertyOptional({ description: 'Alasan perubahan (tampil bagi penyetuju)' }) @IsOptional() @IsString() @MaxLength(255) reason?: string;
}
export class DecideChangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class RejectChangeDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class ChangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: string;
}

type EmpRow = typeof employees.$inferSelect;

@Injectable()
export class EmploymentService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  isJasa = async (tenantId: string, db: DbOrTx = this.db) => (await this.settings.businessModel(db, tenantId)) === 'JASA';

  /** NIK / NPWP / rekening yang sama dengan karyawan aktif lain ditolak (cegah karyawan ganda & rekening dialihkan) */
  async assertNoDuplicates(db: DbOrTx, tenantId: string, selfId: string | null, v: { nik?: string | null; npwp?: string | null; bankAccount?: string | null }) {
    // kolom identitas terenkripsi (acak) → dibandingkan di aplikasi, bukan di SQL
    const active = await db.select({ id: employees.id, code: employees.code, name: employees.name, nik: employees.nik, npwp: employees.npwp, bankAccount: employees.bankAccount })
      .from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.isActive, true)));
    for (const [col, label, raw] of [['nik', 'NIK', v.nik], ['npwp', 'NPWP', v.npwp], ['bankAccount', 'Nomor rekening', v.bankAccount]] as const) {
      const d = DIGITS(raw);
      if (!d) continue;
      const hit = active.find((e) => e.id !== selfId && DIGITS(e[col]) === d);
      if (hit) throw new BadRequestException(`${label} sudah dipakai karyawan aktif lain (${hit.code} · ${hit.name})`);
    }
  }

  /** Mengubah data karyawan jasa oleh HR: bagian sensitif menjadi permintaan persetujuan; sisanya langsung berlaku */
  async splitUpdate(user: AuthUser, emp: EmpRow, dto: Record<string, unknown>, reason?: string): Promise<{ direct: Record<string, unknown>; request: { id: string; fields: string[] } | null }> {
    const direct: Record<string, unknown> = { ...dto };
    const isReactivation = (dto.isActive === true && !emp.isActive) || (dto.resignDate === null && emp.resignDate !== null);
    if (isReactivation) direct.reactivate = true;
    const sensitive = SENSITIVE_FIELDS.filter((f) => f in dto || (f === 'reactivate' && isReactivation));
    const changed = sensitive.filter((f) => {
      if (f === 'reactivate') return true;
      const cur = (emp as Record<string, unknown>)[f];
      return String(cur ?? '') !== String(dto[f] ?? '') && !(typeof cur === 'string' && /^\d+(\.\d+)?$/.test(cur) && D(cur).eq(D(String(dto[f] ?? 0))));
    });
    delete direct.reactivate;
    if (!changed.length) return { direct, request: null };
    // Pemilik berwenang penuh; karyawan yang belum diverifikasi masih bebas diedit (penyetuju memeriksa saat verifikasi)
    if (user.role === 'OWNER' || !emp.verified) return { direct, request: null };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of changed) {
      if (f === 'reactivate') {
        changes.isActive = { from: emp.isActive, to: true };
        changes.resignDate = { from: emp.resignDate, to: null };
        delete direct.isActive;
        delete direct.resignDate;
        continue;
      }
      changes[f] = { from: (emp as Record<string, unknown>)[f] ?? null, to: dto[f] ?? null };
      delete direct[f];
    }
    // validasi gabungan sekarang juga, agar HR tidak mengirim permintaan yang pasti ditolak aturan
    const merged = { ...emp } as Record<string, unknown>;
    for (const [k, c] of Object.entries(changes)) merged[k] = c.to;
    applyEmploymentRules('JASA', merged as unknown as EmpShape);
    await this.assertNoDuplicates(this.db, user.tenantId, emp.id, { nik: merged.nik as string, npwp: merged.npwp as string, bankAccount: merged.bankAccount as string });
    const [pending] = await this.db.select({ id: employeeChangeRequests.id }).from(employeeChangeRequests).where(and(eq(employeeChangeRequests.employeeId, emp.id), eq(employeeChangeRequests.status, 'PENDING')));
    if (pending) throw new BadRequestException('Masih ada permintaan perubahan yang menunggu persetujuan untuk karyawan ini');
    const [req] = await this.db.insert(employeeChangeRequests).values({ tenantId: user.tenantId, employeeId: emp.id, changes: sealChanges(changes), reason: reason ?? null, requestedById: user.sub }).returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'REQUEST', entity: 'EmployeeChange', entityId: req.id, data: { employee: emp.code, fields: Object.keys(changes) } });
    void this.approvals.notifyRoles(user.tenantId, { roles: ['FINANCE', 'ADMIN', 'OWNER'], excludeUserId: user.sub, title: `Perubahan data karyawan ${emp.code} menunggu persetujuan`, lines: [`Bidang: ${Object.keys(changes).join(', ')}`], path: '/employees/controls' });
    return { direct, request: { id: req.id, fields: Object.keys(changes) } };
  }

  private async assertCanDecide(tx: DbOrTx, u: AuthUser, requestedBy: string, employeeId: string) {
    const [emp] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
    if (emp?.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat memutuskan data Anda sendiri');
    if (requestedBy === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Harus diputuskan oleh orang lain dari pengusulnya (pemisahan fungsi)');
  }

  async listChanges(u: AuthUser, q: ChangeQueryDto) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName", c.changes, c.reason, c.status,
             c.requested_by_id AS "requestedById", ru.name AS "requestedByName", du.name AS "decidedByName", c.decision_note AS "decisionNote",
             c.created_at AS "createdAt", c.decided_at AS "decidedAt"
      FROM employee_change_requests c JOIN employees e ON e.id = c.employee_id
      LEFT JOIN users ru ON ru.id = c.requested_by_id LEFT JOIN users du ON du.id = c.decided_by_id
      WHERE c.tenant_id = ${u.tenantId} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`);
    return rows.rows.map((r) => ({ ...r, changes: openChanges(r.changes as Changes) }));
  }

  async approveChange(u: AuthUser, id: string, dto: DecideChangeDto) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(employeeChangeRequests).where(and(eq(employeeChangeRequests.id, id), eq(employeeChangeRequests.tenantId, u.tenantId))).for('update');
      if (!c) throw new NotFoundException('Permintaan tidak ditemukan');
      if (c.status !== 'PENDING') throw new BadRequestException('Permintaan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, c.requestedById, c.employeeId);
      const changes = openChanges(c.changes);
      const [emp] = await tx.select().from(employees).where(eq(employees.id, c.employeeId)).for('update');
      // data harus masih sama seperti saat diajukan (cegah menimpa perubahan lain)
      for (const [k, ch] of Object.entries(changes)) {
        const cur = (emp as Record<string, unknown>)[k] ?? null;
        const same = String(cur ?? '') === String(ch.from ?? '') || (cur !== null && ch.from !== null && /^-?\d+(\.\d+)?$/.test(String(cur)) && D(String(cur)).eq(D(String(ch.from))));
        if (!same) throw new BadRequestException(`Data ${k} sudah berubah sejak diajukan; minta HR mengajukan ulang`);
      }
      const merged = { ...emp } as Record<string, unknown>;
      for (const [k, ch] of Object.entries(changes)) merged[k] = ch.to;
      applyEmploymentRules('JASA', merged as unknown as EmpShape);
      await this.assertNoDuplicates(tx, u.tenantId, emp.id, { nik: merged.nik as string, npwp: merged.npwp as string, bankAccount: merged.bankAccount as string });
      const patch: Record<string, unknown> = {};
      for (const [k, ch] of Object.entries(changes)) patch[k] = ch.to;
      // aturan status dapat menormalkan nilai (mis. BPJS mati untuk tenaga lepas)
      const norm = applyEmploymentRules('JASA', merged as unknown as EmpShape) as unknown as Record<string, unknown>;
      for (const k of ['bpjsKes', 'bpjsTk', 'bpjsJp'] as const) if (norm[k] !== merged[k]) patch[k] = norm[k];
      await tx.update(employees).set(patch).where(eq(employees.id, emp.id));
      await tx.update(employeeChangeRequests).set({ status: 'APPROVED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.note ?? null }).where(eq(employeeChangeRequests.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'EmployeeChange', entityId: id, data: { employee: emp.code, changes, requestedBy: c.requestedById } });
      return { id, status: 'APPROVED' };
    });
  }

  async rejectChange(u: AuthUser, id: string, dto: RejectChangeDto) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(employeeChangeRequests).where(and(eq(employeeChangeRequests.id, id), eq(employeeChangeRequests.tenantId, u.tenantId))).for('update');
      if (!c) throw new NotFoundException('Permintaan tidak ditemukan');
      if (c.status !== 'PENDING') throw new BadRequestException('Permintaan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, c.requestedById, c.employeeId);
      await tx.update(employeeChangeRequests).set({ status: 'REJECTED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.reason }).where(eq(employeeChangeRequests.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'EmployeeChange', entityId: id, data: { reason: dto.reason } });
      return { id, status: 'REJECTED' };
    });
  }

  async cancelChange(u: AuthUser, id: string) {
    const [c] = await this.db.select().from(employeeChangeRequests).where(and(eq(employeeChangeRequests.id, id), eq(employeeChangeRequests.tenantId, u.tenantId)));
    if (!c) throw new NotFoundException('Permintaan tidak ditemukan');
    if (c.status !== 'PENDING') throw new BadRequestException('Permintaan ini sudah diputuskan');
    if (c.requestedById !== u.sub && u.role !== 'OWNER') throw new ForbiddenException('Hanya pengusul yang dapat menarik permintaan');
    await this.db.update(employeeChangeRequests).set({ status: 'CANCELLED', decidedById: u.sub, decidedAt: new Date() }).where(eq(employeeChangeRequests.id, id));
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'EmployeeChange', entityId: id });
    return { id, status: 'CANCELLED' };
  }

  /** Verifikasi karyawan baru oleh orang lain dari pembuatnya; sesudah itu baru ikut penggajian */
  async verify(u: AuthUser, employeeId: string) {
    return this.db.transaction(async (tx) => {
      const [emp] = await tx.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, u.tenantId))).for('update');
      if (!emp) throw new NotFoundException('Karyawan tidak ditemukan');
      if (emp.verified) throw new BadRequestException('Karyawan ini sudah diverifikasi');
      if (emp.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat memverifikasi data Anda sendiri');
      if (emp.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Karyawan harus diverifikasi oleh orang lain dari pembuatnya (pemisahan fungsi)');
      applyEmploymentRules('JASA', emp as unknown as EmpShape);
      await this.assertNoDuplicates(tx, u.tenantId, emp.id, emp);
      await tx.update(employees).set({ verified: true, verifiedById: u.sub, verifiedAt: new Date() }).where(eq(employees.id, employeeId));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VERIFY', entity: 'Employee', entityId: employeeId, data: { code: emp.code, createdBy: emp.createdById, type: emp.employmentType, baseSalary: emp.baseSalary } });
      return { id: employeeId, verified: true };
    });
  }

  /** Hal yang patut diperiksa pemilik / keuangan */
  async alerts(u: AuthUser) {
    const today = todayJakarta();
    const soon = addDays(today, 30);
    const out: { kind: string; severity: 'warn' | 'info'; message: string; employeeId?: string }[] = [];
    const rows = await this.db.select().from(employees).where(and(eq(employees.tenantId, u.tenantId), eq(employees.isActive, true)));
    const bump = (m: Map<string, EmpRow[]>, k: string, e: EmpRow) => m.set(k, [...(m.get(k) ?? []), e]);
    const byNik = new Map<string, EmpRow[]>();
    const byBank = new Map<string, EmpRow[]>();
    for (const e of rows) {
      const label = `${e.code} · ${e.name}`;
      if (!e.verified) out.push({ kind: 'BELUM_DIVERIFIKASI', severity: 'warn', employeeId: e.id, message: `${label}: karyawan baru belum diverifikasi, belum ikut penggajian` });
      if (e.contractEnd && e.contractEnd < today && !e.resignDate) out.push({ kind: 'KONTRAK_BERAKHIR', severity: 'warn', employeeId: e.id, message: `${label}: kontrak berakhir ${e.contractEnd} dan belum diperpanjang — gaji dan catatan kerja sudah berhenti otomatis` });
      else if (e.contractEnd && e.contractEnd <= soon) out.push({ kind: 'KONTRAK_SEGERA', severity: 'info', employeeId: e.id, message: `${label}: kontrak berakhir ${e.contractEnd} (kurang dari 30 hari)` });
      if (!e.nik && !e.npwp) out.push({ kind: 'TANPA_IDENTITAS', severity: 'info', employeeId: e.id, message: `${label}: belum ada NIK / NPWP (PPh 21 lebih tinggi bila tanpa NPWP)` });
      if (!e.bankAccount && e.employmentType !== 'MITRA') out.push({ kind: 'TANPA_REKENING', severity: 'info', employeeId: e.id, message: `${label}: belum ada nomor rekening` });
      const nik = DIGITS(e.nik);
      if (nik) bump(byNik, nik, e);
      const bank = DIGITS(e.bankAccount);
      if (bank) bump(byBank, bank, e);
    }
    for (const [, list] of byNik) if (list.length > 1) out.push({ kind: 'NIK_GANDA', severity: 'warn', message: `NIK sama dipakai ${list.map((e) => e.code).join(', ')}` });
    for (const [, list] of byBank) if (list.length > 1) out.push({ kind: 'REKENING_GANDA', severity: 'warn', message: `Rekening sama dipakai ${list.map((e) => e.code).join(', ')}` });
    const pending = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM employee_change_requests WHERE tenant_id = ${u.tenantId} AND status = 'PENDING' AND created_at < now() - interval '3 days'`);
    if (pending.rows[0].n > 0) out.push({ kind: 'PERMINTAAN_LAMA', severity: 'info', message: `${pending.rows[0].n} permintaan perubahan data menunggu lebih dari 3 hari` });
    return out;
  }

  /** Batas masa kerja efektif untuk penggajian & catatan kerja: keluar atau kontrak berakhir, mana lebih dulu */
  static endOf(e: { resignDate: string | null; contractEnd: string | null }): string | null {
    const ds = [e.resignDate, e.contractEnd].filter((d): d is string => !!d).sort();
    return ds[0] ?? null;
  }
}

@ApiTags('SDM — jasa')
@ApiBearerAuth()
@RequireApp('hr')
@Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('hr/employment')
export class EmploymentController {
  constructor(private readonly svc: EmploymentService) {}

  @Get('changes')
  changes(@CurrentUser() u: AuthUser, @Query() q: ChangeQueryDto) {
    return this.svc.listChanges(u, q);
  }
  @Get('alerts')
  alerts(@CurrentUser() u: AuthUser) {
    return this.svc.alerts(u);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('changes/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideChangeDto) {
    return this.svc.approveChange(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('changes/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectChangeDto) {
    return this.svc.rejectChange(u, id, dto);
  }
  @Roles('HR')
  @Post('changes/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelChange(u, id);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('employees/:id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.verify(u, id);
  }
}
