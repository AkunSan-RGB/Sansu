/**
 * Lembar waktu yang dapat ditagih (usaha jasa): karyawan mencatat jam kerja per pelanggan/proyek, atasan menyetujui, lalu keuangan
 * menagihnya sebagai faktur jasa (jam × tarif) tanpa mengetik ulang.
 *
 * Alur: DRAFT → SUBMITTED → APPROVED → BILLED  (atau REJECTED → diperbaiki, APPROVED → WRITTEN_OFF)
 *
 * Pencegahan kecurangan / kebocoran pendapatan:
 *  - karyawan hanya mencatat untuk dirinya; mencatat untuk orang lain hanya Admin/Keuangan/Pemilik
 *  - jam per hari per karyawan ≤ 16 (semua catatan aktif dijumlahkan); tanggal tidak di masa depan; mundur > 31 hari hanya Admin/Keuangan
 *  - persetujuan oleh orang lain dari pencatat dan dari karyawannya (pemisahan fungsi; Pemilik dikecualikan)
 *  - tarif diambil dari daftar tarif (proyek+karyawan > proyek > karyawan > umum, berlaku sejak tanggal); mengubah tarif saat persetujuan
 *    hanya Admin/Pemilik dengan alasan; catatan tanpa tarif tidak bisa disetujui
 *  - catatan tertagih tidak bisa diubah; faktur dan penandaan "tertagih" satu transaksi (tidak bisa tertagih dua kali, tidak ada faktur setengah jadi)
 *  - penghapusan tagihan (write-off) hanya Admin/Pemilik dengan alasan
 *  - kontrol: menunggu persetujuan lama, disetujui tetapi belum ditagih lama (kebocoran pendapatan), jam > 12/hari, tanpa tarif, tarif diubah manual
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { addDays, toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { ServiceBillingService } from './service-billing';

export const MAX_HOURS_PER_DAY = 16;
export const LONG_DAY_HOURS = 12;
export const BACKDATE_DAYS = 31;
const PRIVILEGED = ['OWNER', 'ADMIN', 'FINANCE'];
const num = (v: unknown) => Number(v ?? 0);
const isPriv = (u: AuthUser) => PRIVILEGED.includes(u.role);

export class TimeEntryDto {
  @ApiPropertyOptional({ description: 'Kosong = karyawan yang terhubung dengan akun Anda' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Wajib bila tanpa proyek' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiProperty({ example: '2026-10-19' }) @IsDateString() workDate: string;
  @ApiProperty({ example: '2.5' }) @IsNumberString() hours: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() billable?: boolean;
}
export class UpdateTimeEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() workDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() hours?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() billable?: boolean;
}
export class IdsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
}
export class ApproveDto {
  @ApiPropertyOptional({ description: 'Ubah tarif (Admin/Pemilik; wajib rateNote)' }) @IsOptional() @IsNumberString() rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) rateNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class RateDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ example: '350000', description: 'Tarif per jam (Rp, belum PPN)' }) @IsNumberString() rate: string;
  @ApiProperty() @IsDateString() validFrom: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class BillDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) entryIds: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() withVat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}
export class EntriesQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'BILLED', 'REJECTED', 'WRITTEN_OFF']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
export class RangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

type Entry = { id: string; employee_id: string; project_id: string | null; customer_id: string; work_date: string; hours: string; description: string; billable: boolean; rate: string | null; status: string; created_by_id: string; invoice_id: string | null };

@Injectable()
export class TimesheetService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
  ) {}

  /** Karyawan yang terhubung dengan akun pengguna ini */
  private async ownEmployee(db: DbOrTx, u: AuthUser) {
    const r = await db.execute<{ id: string }>(sql`SELECT id FROM employees WHERE tenant_id = ${u.tenantId} AND user_id = ${u.sub} LIMIT 1`);
    return r.rows[0]?.id ?? null;
  }

  /** Tarif paling spesifik yang berlaku pada tanggal kerja; null bila belum ada */
  async resolveRate(db: DbOrTx, tenantId: string, employeeId: string, projectId: string | null, date: string): Promise<string | null> {
    const r = await db.execute<{ rate: string }>(sql`
      SELECT rate FROM (
        SELECT rate, valid_from, created_at,
          CASE WHEN project_id IS NOT DISTINCT FROM ${projectId}::uuid AND project_id IS NOT NULL AND employee_id = ${employeeId}::uuid THEN 4
               WHEN project_id IS NOT DISTINCT FROM ${projectId}::uuid AND project_id IS NOT NULL AND employee_id IS NULL THEN 3
               WHEN project_id IS NULL AND employee_id = ${employeeId}::uuid THEN 2
               WHEN project_id IS NULL AND employee_id IS NULL THEN 1 ELSE 0 END AS spec
        FROM billing_rates WHERE tenant_id = ${tenantId} AND valid_from <= ${date}::date) x
      WHERE spec > 0 ORDER BY spec DESC, valid_from DESC, created_at DESC LIMIT 1`);
    return r.rows[0]?.rate ?? null;
  }

  private checkHours(raw: string) {
    const h = D(raw);
    if (!h.isFinite() || h.lte(0) || h.gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Jam kerja harus lebih dari 0 dan paling banyak ${MAX_HOURS_PER_DAY} per catatan`);
    if (!h.times(100).isInteger()) throw new BadRequestException('Jam kerja maksimal dua desimal');
    return h;
  }

  private checkDate(u: AuthUser, date: string) {
    const d = toDocDate(date);
    if (d > todayJakarta()) throw new BadRequestException('Tanggal kerja tidak boleh di masa depan');
    if (d < addDays(todayJakarta(), -BACKDATE_DAYS) && !isPriv(u)) throw new ForbiddenException(`Catatan lebih dari ${BACKDATE_DAYS} hari ke belakang hanya boleh dibuat Admin/Keuangan`);
    return d;
  }

  /** Total jam aktif karyawan pada hari itu (tidak termasuk catatan ditolak/dihapus-tagih dan `exceptId`) */
  private async dayHours(tx: DbOrTx, tenantId: string, employeeId: string, date: string, exceptId?: string) {
    const r = await tx.execute<{ h: string }>(sql`SELECT COALESCE(SUM(hours), 0) AS h FROM time_entries WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} AND work_date = ${date} AND status NOT IN ('REJECTED', 'WRITTEN_OFF') ${exceptId ? sql`AND id <> ${exceptId}` : sql``}`);
    return num(r.rows[0].h);
  }

  async create(u: AuthUser, dto: TimeEntryDto) {
    const own = await this.ownEmployee(this.db, u);
    const employeeId = dto.employeeId ?? own;
    if (!employeeId) throw new BadRequestException('Akun Anda belum terhubung dengan data karyawan; pilih karyawan atau minta Admin menghubungkannya');
    if (employeeId !== own && !isPriv(u)) throw new ForbiddenException('Anda hanya dapat mencatat waktu untuk diri sendiri');
    const hours = this.checkHours(dto.hours);
    const date = this.checkDate(u, dto.workDate);
    const id = await this.db.transaction(async (tx) => {
      const emp = await tx.execute<{ id: string; is_active: boolean | null }>(sql`SELECT id FROM employees WHERE id = ${employeeId} AND tenant_id = ${u.tenantId} FOR UPDATE`);
      if (!emp.rows.length) throw new BadRequestException('Karyawan tidak ditemukan');
      let customerId = dto.customerId ?? null;
      let projectId: string | null = null;
      if (dto.projectId) {
        const p = (await tx.execute<{ id: string; customer_id: string; status: string }>(sql`SELECT id, customer_id, status FROM projects WHERE id = ${dto.projectId} AND tenant_id = ${u.tenantId}`)).rows[0];
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
        if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
        if (customerId && customerId !== p.customer_id) throw new BadRequestException('Proyek ini milik pelanggan lain');
        customerId = p.customer_id;
        projectId = p.id;
      }
      if (!customerId) throw new BadRequestException('Pilih proyek atau pelanggan');
      const c = await tx.execute(sql`SELECT 1 FROM customers WHERE id = ${customerId} AND tenant_id = ${u.tenantId}`);
      if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
      const already = await this.dayHours(tx, u.tenantId, employeeId, date);
      if (already + hours.toNumber() > MAX_HOURS_PER_DAY) throw new BadRequestException(`Total jam karyawan pada ${date} akan menjadi ${already + hours.toNumber()} (batas ${MAX_HOURS_PER_DAY} jam per hari)`);
      const billable = dto.billable ?? true;
      const rate = billable ? await this.resolveRate(tx, u.tenantId, employeeId, projectId, date) : null;
      const r = await tx.execute<{ id: string }>(sql`INSERT INTO time_entries (tenant_id, employee_id, project_id, customer_id, work_date, hours, description, billable, rate, created_by_id) VALUES (${u.tenantId}, ${employeeId}, ${projectId}, ${customerId}, ${date}, ${hours.toFixed(2)}, ${dto.description.trim()}, ${billable}, ${rate}, ${u.sub}) RETURNING id`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TimeEntry', entityId: r.rows[0].id, data: { employeeId, customerId, projectId, date, hours: hours.toFixed(2), billable, rate } });
      return r.rows[0].id;
    });
    return this.get(u, id);
  }

  private async lock(tx: Tx, u: AuthUser, id: string) {
    const r = await tx.execute<Entry>(sql`SELECT * FROM time_entries WHERE id = ${id} AND tenant_id = ${u.tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new NotFoundException('Catatan waktu tidak ditemukan');
    return r.rows[0];
  }

  /** Pemilik catatan atau karyawannya boleh mengubah/mengajukan; selain itu hanya Admin/Keuangan/Pemilik */
  private async assertOwner(tx: Tx, u: AuthUser, e: Entry) {
    if (isPriv(u)) return;
    const own = await this.ownEmployee(tx, u);
    if (e.created_by_id !== u.sub && e.employee_id !== own) throw new ForbiddenException('Catatan ini milik orang lain');
  }

  async update(u: AuthUser, id: string, dto: UpdateTimeEntryDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      await this.assertOwner(tx, u, e);
      if (!['DRAFT', 'REJECTED'].includes(e.status)) throw new BadRequestException('Hanya catatan draf atau yang ditolak yang dapat diubah');
      const hours = dto.hours ? this.checkHours(dto.hours) : D(e.hours);
      const date = dto.workDate ? this.checkDate(u, dto.workDate) : e.work_date;
      const already = await this.dayHours(tx, u.tenantId, e.employee_id, date, id);
      if (already + hours.toNumber() > MAX_HOURS_PER_DAY) throw new BadRequestException(`Total jam pada ${date} melebihi ${MAX_HOURS_PER_DAY} jam`);
      const billable = dto.billable ?? e.billable;
      const rate = billable ? await this.resolveRate(tx, u.tenantId, e.employee_id, e.project_id, date) : null;
      await tx.execute(sql`UPDATE time_entries SET work_date = ${date}, hours = ${hours.toFixed(2)}, description = ${dto.description?.trim() ?? e.description}, billable = ${billable}, rate = ${rate}, rate_note = NULL, status = 'DRAFT', decision_note = NULL WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TimeEntry', entityId: id, data: { before: { date: e.work_date, hours: e.hours, billable: e.billable }, after: { date, hours: hours.toFixed(2), billable } } });
    });
    return this.get(u, id);
  }

  async submit(u: AuthUser, ids: string[]) {
    const done: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const id of [...new Set(ids)]) {
        const e = await this.lock(tx, u, id);
        await this.assertOwner(tx, u, e);
        if (!['DRAFT', 'REJECTED'].includes(e.status)) throw new BadRequestException('Hanya catatan draf atau yang ditolak yang dapat diajukan');
        await tx.execute(sql`UPDATE time_entries SET status = 'SUBMITTED', submitted_at = now(), decision_note = NULL WHERE id = ${id}`);
        done.push(id);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TimeEntry', entityId: done[0], data: { submitted: done.length } });
    });
    return { submitted: done.length };
  }

  async approve(u: AuthUser, id: string, dto: ApproveDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'SUBMITTED') throw new BadRequestException('Hanya catatan yang diajukan yang dapat disetujui');
      const empUser = (await tx.execute<{ user_id: string | null }>(sql`SELECT user_id FROM employees WHERE id = ${e.employee_id}`)).rows[0]?.user_id;
      if (u.role !== 'OWNER' && (e.created_by_id === u.sub || empUser === u.sub)) throw new ForbiddenException('Catatan waktu harus disetujui orang lain dari pencatatnya (pemisahan fungsi)');
      let rate = e.rate;
      if (e.billable) {
        if (dto.rate !== undefined) {
          if (!['OWNER', 'ADMIN'].includes(u.role)) throw new ForbiddenException('Mengubah tarif hanya boleh Admin/Pemilik');
          if ((dto.rateNote ?? '').trim().length < 5) throw new BadRequestException('Mengubah tarif wajib disertai alasan (min. 5 huruf)');
          const r = money(dto.rate);
          if (r.lte(0)) throw new BadRequestException('Tarif harus lebih dari 0');
          rate = r.toFixed(2);
        } else if (!rate) {
          rate = await this.resolveRate(tx, u.tenantId, e.employee_id, e.project_id, e.work_date);
        }
        if (!rate) throw new BadRequestException('Belum ada tarif tagih untuk catatan ini; atur di tab Tarif');
      }
      await tx.execute(sql`UPDATE time_entries SET status = 'APPROVED', rate = ${rate}, rate_note = ${dto.rate !== undefined ? dto.rateNote!.trim() : null}, decided_by_id = ${u.sub}, decided_at = now(), decision_note = ${dto.note ?? null} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'TimeEntry', entityId: id, data: { hours: e.hours, rate, overridden: dto.rate !== undefined, note: dto.rateNote } });
    });
    return this.get(u, id);
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'SUBMITTED') throw new BadRequestException('Hanya catatan yang diajukan yang dapat ditolak');
      await tx.execute(sql`UPDATE time_entries SET status = 'REJECTED', decided_by_id = ${u.sub}, decided_at = now(), decision_note = ${dto.reason} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'TimeEntry', entityId: id, data: { reason: dto.reason } });
    });
    return this.get(u, id);
  }

  async writeOff(u: AuthUser, id: string, dto: ReasonDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'APPROVED') throw new BadRequestException('Hanya catatan yang disetujui dan belum ditagih yang dapat dihapus-tagih');
      await tx.execute(sql`UPDATE time_entries SET status = 'WRITTEN_OFF', decision_note = ${dto.reason}, decided_by_id = ${u.sub}, decided_at = now() WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'TimeEntry', entityId: id, data: { reason: dto.reason, hours: e.hours, rate: e.rate } });
    });
    return this.get(u, id);
  }

  async get(u: AuthUser, id: string) {
    const rows = await this.list(u, {}, id);
    if (!rows.length) throw new NotFoundException('Catatan waktu tidak ditemukan');
    return rows[0];
  }

  /** Karyawan biasa hanya melihat catatannya sendiri */
  async list(u: AuthUser, q: EntriesQuery, onlyId?: string) {
    const own = isPriv(u) || u.role === 'ACCOUNTANT' ? null : await this.ownEmployee(this.db, u);
    const scoped = !isPriv(u) && u.role !== 'ACCOUNTANT';
    const r = await this.db.execute(sql`
      SELECT t.id, t.employee_id AS "employeeId", e.name AS "employeeName", t.project_id AS "projectId", p.name AS "projectName", t.customer_id AS "customerId", c.name AS "customerName",
             t.work_date AS "workDate", t.hours, t.description, t.billable, t.rate, (t.hours * COALESCE(t.rate, 0)) AS amount, t.rate_note AS "rateNote", t.status,
             t.decision_note AS "decisionNote", t.invoice_id AS "invoiceId", t.created_by_id AS "createdById", t.created_at AS "createdAt"
      FROM time_entries t JOIN employees e ON e.id = t.employee_id JOIN customers c ON c.id = t.customer_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.tenant_id = ${u.tenantId}
        ${onlyId ? sql`AND t.id = ${onlyId}` : sql``}
        ${scoped ? sql`AND (t.employee_id = ${own}::uuid OR t.created_by_id = ${u.sub})` : sql``}
        ${q.status ? sql`AND t.status = ${q.status}` : sql``} ${q.employeeId ? sql`AND t.employee_id = ${q.employeeId}` : sql``} ${q.customerId ? sql`AND t.customer_id = ${q.customerId}` : sql``}
        ${q.from ? sql`AND t.work_date >= ${q.from}` : sql``} ${q.to ? sql`AND t.work_date <= ${q.to}` : sql``}
      ORDER BY t.work_date DESC, t.created_at DESC LIMIT 500`);
    return r.rows as Record<string, unknown>[];
  }

  // ---------- tarif ----------
  rates(tenantId: string) {
    return this.db.execute(sql`SELECT r.id, r.employee_id AS "employeeId", e.name AS "employeeName", r.project_id AS "projectId", p.name AS "projectName", r.rate, r.valid_from AS "validFrom", r.note FROM billing_rates r LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN projects p ON p.id = r.project_id WHERE r.tenant_id = ${tenantId} ORDER BY r.valid_from DESC, r.created_at DESC LIMIT 300`).then((r) => r.rows);
  }

  async createRate(u: AuthUser, dto: RateDto) {
    const rate = money(dto.rate);
    if (rate.lte(0) || rate.gt(100_000_000)) throw new BadRequestException('Tarif per jam tidak wajar');
    if (dto.employeeId) {
      const e = await this.db.execute(sql`SELECT 1 FROM employees WHERE id = ${dto.employeeId} AND tenant_id = ${u.tenantId}`);
      if (!e.rows.length) throw new BadRequestException('Karyawan tidak ditemukan');
    }
    if (dto.projectId) {
      const p = await this.db.execute(sql`SELECT 1 FROM projects WHERE id = ${dto.projectId} AND tenant_id = ${u.tenantId}`);
      if (!p.rows.length) throw new BadRequestException('Proyek tidak ditemukan');
    }
    const r = await this.db.execute<{ id: string }>(sql`INSERT INTO billing_rates (tenant_id, employee_id, project_id, rate, valid_from, note, created_by_id) VALUES (${u.tenantId}, ${dto.employeeId ?? null}, ${dto.projectId ?? null}, ${rate.toFixed(2)}, ${toDocDate(dto.validFrom)}, ${dto.note ?? null}, ${u.sub}) RETURNING id`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'BillingRate', entityId: r.rows[0].id, data: { employeeId: dto.employeeId, projectId: dto.projectId, rate: rate.toFixed(2), validFrom: dto.validFrom } });
    return { id: r.rows[0].id };
  }

  // ---------- penagihan ----------
  /** Waktu disetujui yang belum ditagih, dikelompokkan per pelanggan/proyek */
  async unbilled(tenantId: string) {
    const r = await this.db.execute(sql`
      SELECT t.customer_id AS "customerId", c.name AS "customerName", t.project_id AS "projectId", p.name AS "projectName",
             COUNT(*)::int AS entries, SUM(t.hours) AS hours, SUM(t.hours * t.rate) AS amount, MIN(t.work_date) AS oldest
      FROM time_entries t JOIN customers c ON c.id = t.customer_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.tenant_id = ${tenantId} AND t.status = 'APPROVED' AND t.billable
      GROUP BY t.customer_id, c.name, t.project_id, p.name ORDER BY MIN(t.work_date)`);
    return r.rows;
  }

  async bill(u: AuthUser, dto: BillDto) {
    const ids = [...new Set(dto.entryIds)];
    if (ids.length !== dto.entryIds.length) throw new BadRequestException('Catatan yang sama dipilih lebih dari sekali');
    const rows = (await this.db.execute<Entry & { employee_name: string }>(sql`SELECT t.*, e.name AS employee_name FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${u.tenantId} AND t.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows;
    if (rows.length !== ids.length) throw new BadRequestException('Ada catatan yang tidak ditemukan');
    for (const r of rows) {
      if (r.status !== 'APPROVED' || !r.billable || !r.rate) throw new BadRequestException(`Catatan ${r.work_date} (${r.employee_name}) belum disetujui, tidak dapat ditagih, atau sudah ditagih`);
      if (r.customer_id !== dto.customerId) throw new BadRequestException('Semua catatan harus milik pelanggan yang sama');
    }
    const projects = [...new Set(rows.map((r) => r.project_id))];
    if (projects.length > 1) throw new BadRequestException('Catatan berasal dari proyek berbeda; tagih per proyek (atau per catatan tanpa proyek)');
    // satu baris faktur per karyawan dan tarif
    const groups = new Map<string, { name: string; hours: ReturnType<typeof D>; rate: string; from: string; to: string }>();
    for (const r of rows) {
      const k = `${r.employee_id}|${r.rate}`;
      const g = groups.get(k) ?? { name: r.employee_name, hours: D(0), rate: r.rate!, from: r.work_date, to: r.work_date };
      g.hours = g.hours.plus(r.hours);
      if (r.work_date < g.from) g.from = r.work_date;
      if (r.work_date > g.to) g.to = r.work_date;
      groups.set(k, g);
    }
    const total = rows.reduce((a, r) => a.plus(D(r.hours).times(r.rate!)), D(0));
    const inv = await this.billing.createInvoice(
      u,
      {
        customerId: dto.customerId,
        projectId: projects[0] ?? undefined,
        date: dto.date,
        description: dto.description ?? 'Jasa berdasarkan lembar waktu',
        withVat: dto.withVat,
        lines: [...groups.values()].map((g) => ({ description: `Jasa ${g.name} ${g.from === g.to ? g.from : `${g.from} s/d ${g.to}`}`, qty: g.hours.toFixed(2), unit: 'Jam', price: g.rate })),
      },
      {
        // penandaan tertagih satu transaksi dengan faktur; bila ada yang berubah sejak dibaca, seluruhnya dibatalkan
        inTx: async (tx, invoice) => {
          const locked = (await tx.execute<{ id: string; hours: string; rate: string }>(sql`SELECT id, hours, rate FROM time_entries WHERE tenant_id = ${u.tenantId} AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND status = 'APPROVED' AND billable AND invoice_id IS NULL FOR UPDATE`)).rows;
          const sum = locked.reduce((a, r) => a.plus(D(r.hours).times(r.rate)), D(0));
          if (locked.length !== ids.length || !sum.eq(total)) throw new BadRequestException('Catatan waktu berubah sejak dipilih (sudah ditagih atau diubah); muat ulang daftar');
          await tx.execute(sql`UPDATE time_entries SET status = 'BILLED', invoice_id = ${invoice.id} WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TimesheetBilling', entityId: invoice.id, data: { invoice: invoice.number, entries: ids.length, hours: rows.reduce((a, r) => a.plus(r.hours), D(0)).toFixed(2), amount: total.toFixed(2) } });
        },
      },
    );
    return { ...inv, entries: ids.length, amount: money(total).toFixed(2) };
  }

  // ---------- kontrol dan laporan ----------
  async controls(tenantId: string) {
    const q = async (text: ReturnType<typeof sql>) => (await this.db.execute(text)).rows;
    const today = todayJakarta();
    const submittedOld = await q(sql`SELECT t.id, e.name AS employee, t.work_date AS "workDate", t.hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status = 'SUBMITTED' AND t.submitted_at < now() - interval '3 days' ORDER BY t.submitted_at LIMIT 50`);
    const unbilledOld = await q(sql`SELECT c.name AS customer, COUNT(*)::int AS entries, SUM(t.hours) AS hours, SUM(t.hours * t.rate) AS amount, MIN(t.work_date) AS oldest FROM time_entries t JOIN customers c ON c.id = t.customer_id WHERE t.tenant_id = ${tenantId} AND t.status = 'APPROVED' AND t.billable AND t.decided_at < now() - interval '30 days' GROUP BY c.name ORDER BY MIN(t.work_date)`);
    const noRate = await q(sql`SELECT t.id, e.name AS employee, t.work_date AS "workDate", t.hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.billable AND t.rate IS NULL AND t.status IN ('DRAFT', 'SUBMITTED', 'REJECTED') ORDER BY t.work_date LIMIT 50`);
    const longDays = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", SUM(t.hours) AS hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status NOT IN ('REJECTED', 'WRITTEN_OFF') AND t.work_date >= ${addDays(today, -60)} GROUP BY e.name, t.work_date HAVING SUM(t.hours) > ${LONG_DAY_HOURS} ORDER BY t.work_date DESC LIMIT 50`);
    const overrides = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", t.rate, t.rate_note AS note FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.rate_note IS NOT NULL AND t.decided_at > now() - interval '60 days' ORDER BY t.decided_at DESC LIMIT 50`);
    const writeOffs = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", t.hours, t.rate, t.decision_note AS reason FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status = 'WRITTEN_OFF' AND t.decided_at > now() - interval '60 days' ORDER BY t.decided_at DESC LIMIT 50`);
    return { submittedOver3Days: submittedOld, approvedUnbilledOver30Days: unbilledOld, billableWithoutRate: noRate, longDays, rateOverrides: overrides, writtenOff: writeOffs };
  }

  /** Utilisasi per karyawan: jam dicatat, jam tertagih, nilai tertagih dan yang belum ditagih */
  async utilization(tenantId: string, q: RangeQuery) {
    const to = q.to ?? todayJakarta();
    const from = q.from ?? addDays(to, -30);
    const r = await this.db.execute(sql`
      SELECT e.id AS "employeeId", e.name AS employee,
             COALESCE(SUM(t.hours) FILTER (WHERE t.status NOT IN ('REJECTED', 'WRITTEN_OFF')), 0) AS "totalHours",
             COALESCE(SUM(t.hours) FILTER (WHERE t.billable AND t.status NOT IN ('REJECTED', 'WRITTEN_OFF', 'DRAFT')), 0) AS "billableHours",
             COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'BILLED'), 0) AS billed,
             COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'APPROVED' AND t.billable), 0) AS "approvedUnbilled"
      FROM employees e JOIN time_entries t ON t.employee_id = e.id AND t.work_date BETWEEN ${from} AND ${to}
      WHERE e.tenant_id = ${tenantId} GROUP BY e.id, e.name ORDER BY e.name`);
    return { from, to, rows: r.rows };
  }
}

@ApiTags('Lembar waktu')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
@Controller('timesheets')
export class TimesheetController {
  constructor(private readonly svc: TimesheetService) {}

  @Get('entries') list(@CurrentUser() u: AuthUser, @Query() q: EntriesQuery) { return this.svc.list(u, q); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('entries') create(@CurrentUser() u: AuthUser, @Body() dto: TimeEntryDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Put('entries/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTimeEntryDto) { return this.svc.update(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('submit') submit(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) { return this.svc.submit(u, dto.ids); }
  @Roles('ADMIN', 'FINANCE') @Post('entries/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) { return this.svc.approve(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('entries/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reject(u, id, dto); }
  @Roles('ADMIN') @Post('entries/:id/write-off') writeOff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.writeOff(u, id, dto); }

  @Get('rates') rates(@CurrentUser() u: AuthUser) { return this.svc.rates(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('rates') createRate(@CurrentUser() u: AuthUser, @Body() dto: RateDto) { return this.svc.createRate(u, dto); }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('unbilled') unbilled(@CurrentUser() u: AuthUser) { return this.svc.unbilled(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('bill') bill(@CurrentUser() u: AuthUser, @Body() dto: BillDto) { return this.svc.bill(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('utilization') utilization(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.utilization(u.tenantId, q); }
}
