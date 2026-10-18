/**
 * Upah kerja. Dibuat untuk usaha jasa, lalu dipakai semua jenis usaha dengan satuan yang sesuai (lihat shared/work-units): usaha jasa dibayar bermacam-macam: per jam (konsultan, tutor), per sesi (terapis, instruktur), borongan per pekerjaan
 * (teknisi, desainer) atau komisi dari faktur jasa; toko, kafe, dan pabrik per shift; pabrik dan gudang per hasil atau borongan. Semuanya dicatat sebagai "catatan kerja", disetujui, lalu otomatis masuk slip gaji
 * bulan berjalan sebagai upah jasa — dan menjadi biaya langsung proyek bila dikaitkan ke proyek.
 *
 * Pencegahan kecurangan:
 *  - angka dihitung server dari kartu tarif (disalin saat dibuat); pengisi catatan tidak bisa mengetik nominal dan tidak mengatur tarif
 *  - pembuat ≠ penyetuju (Pemilik dikecualikan agar usaha kecil tetap bisa jalan); pegawai tidak mengisi / menyetujui upahnya sendiri
 *  - batas jam per hari, tanggal tidak boleh masa depan / terlalu lampau / di luar masa kerja, tidak boleh bentrok dengan absensi (cuti, sakit, alpa)
 *  - catatan kembar ditolak; komisi hanya dari faktur jasa yang sudah LUNAS, tidak dibatalkan, tanpa retur, satu kali per pegawai per faktur,
 *    total persen satu faktur ≤ 100%
 *  - saat gaji diposting, jumlah catatan kerja dicocokkan lagi dengan slip; setelah diposting catatan terkunci
 *  - semua langkah tercatat di jejak audit
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { WORK_LIMITS, WORK_UNIT_LABELS, WORK_UNITS, WORK_UNITS_BY_MODEL, type WorkUnit } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, invoices, productionOrders, projects, serviceRates, serviceWorkEntries } from '../../db/schema';
import { monthRange } from '../hr/hr.module';

export const MAX_HOURS_PER_DAY = 16;
export const MAX_BACKDATE_DAYS = 62;
export const MAX_HOURS_PER_MONTH = 260;
const UNITS = WORK_UNITS;
export const UNIT_LABELS = WORK_UNIT_LABELS;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateRateDto {
  @ApiProperty({ example: 'Konsultan senior — per jam' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: UNITS }) @IsIn(UNITS as unknown as string[]) unit: (typeof UNITS)[number];
  @ApiProperty({ example: '250000', description: 'Rupiah per satuan; untuk komisi = persen (1–100)' }) @IsNumberString() rate: string;
}
export class UpdateRateDto {
  @ApiPropertyOptional() @IsOptional() @IsNumberString() rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateEntryDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsUUID() rateId: string;
  @ApiPropertyOptional({ example: '2026-10-14', description: 'Default hari ini' }) @IsOptional() @IsDateString() workDate?: string;
  @ApiPropertyOptional({ example: '6.5', description: 'Jam / sesi / pekerjaan. Kosong untuk komisi.' }) @IsOptional() @IsNumberString() quantity?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Wajib untuk tarif komisi: faktur jasa yang sudah lunas' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional({ description: 'Tarif per hasil (pabrik): perintah produksi yang dikerjakan; jumlah hasil dibatasi keluaran perintah itu' }) @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
}
export class DecideEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class VoidEntryDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class EntryQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'VOID']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

/** Faktur jasa yang boleh dikomisikan: lunas, tidak dibatalkan (jurnal tidak dibalik), tanpa retur */
const employeeOk = sql`EXISTS (SELECT 1 FROM employees em WHERE em.id = w.employee_id AND em.verified
  AND (em.contract_end IS NULL OR em.contract_end >= w.work_date) AND (em.resign_date IS NULL OR em.resign_date >= w.work_date))`;
const invoiceUsable = sql`i.kind = 'SERVICE' AND i.status = 'PAID' AND i.returned_amount = 0 AND i.is_opening = false
  AND i.journal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversal_of_id = i.journal_id)`;

/**
 * Dipanggil penggajian saat menghitung slip. Mengaitkan catatan kerja yang DISETUJUI dan layak ke penggajian ini,
 * melepas yang tidak layak lagi (dibatalkan, faktur dibatalkan/diretur, pegawai keluar dari slip), lalu mengembalikan jumlah per pegawai.
 */
export async function attachServiceEntries(tx: Tx, tenantId: string, runId: string, period: string, keepEmployeeIds: Set<string> | null, onlyEmployeeId?: string): Promise<Map<string, Dec>> {
  const { to } = monthRange(period);
  await tx.execute(sql`SELECT id FROM service_work_entries WHERE tenant_id = ${tenantId} AND (run_id = ${runId} OR (run_id IS NULL AND status = 'APPROVED' AND work_date <= ${to})) ${onlyEmployeeId ? sql`AND employee_id = ${onlyEmployeeId}` : sql``} FOR UPDATE`);
  // lepas: tidak lagi disetujui, atau pegawai tidak lagi ada di slip, atau komisi yang fakturnya tidak layak lagi
  await tx.execute(sql`
    UPDATE service_work_entries w SET run_id = NULL
    WHERE w.tenant_id = ${tenantId} AND w.run_id = ${runId} ${onlyEmployeeId ? sql`AND w.employee_id = ${onlyEmployeeId}` : sql``}
      AND (w.status <> 'APPROVED' OR NOT ${employeeOk}
        ${keepEmployeeIds ? sql`OR w.employee_id NOT IN (${keepEmployeeIds.size ? sql.join([...keepEmployeeIds].map((x) => sql`${x}::uuid`), sql`, `) : sql`NULL::uuid`})` : sql``}
        OR (w.unit = 'PERCENT' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = w.invoice_id AND ${invoiceUsable})))`);
  // kaitkan yang baru layak
  await tx.execute(sql`
    UPDATE service_work_entries w SET run_id = ${runId}
    WHERE w.tenant_id = ${tenantId} AND w.run_id IS NULL AND w.status = 'APPROVED' AND w.work_date <= ${to}
      ${onlyEmployeeId ? sql`AND w.employee_id = ${onlyEmployeeId}` : sql``}
      ${keepEmployeeIds ? sql`AND w.employee_id IN (${keepEmployeeIds.size ? sql.join([...keepEmployeeIds].map((x) => sql`${x}::uuid`), sql`, `) : sql`NULL::uuid`})` : sql``}
      AND ${employeeOk}
      AND (w.unit <> 'PERCENT' OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = w.invoice_id AND ${invoiceUsable}))`);
  const sums = await tx.execute<{ employee_id: string; total: string }>(sql`
    SELECT employee_id, SUM(amount) AS total FROM service_work_entries WHERE tenant_id = ${tenantId} AND run_id = ${runId} AND status = 'APPROVED' GROUP BY employee_id`);
  return new Map(sums.rows.map((r) => [r.employee_id, D(r.total)]));
}

/** Dipanggil saat posting gaji: jumlah catatan kerja harus sama dengan upah jasa di slip (mencegah selisih diam-diam) */
export async function assertServiceEntriesMatch(tx: Tx, tenantId: string, runId: string, slips: { employeeId: string; serviceIncome: string }[]) {
  const sums = await tx.execute<{ employee_id: string; total: string; bad: number }>(sql`
    SELECT employee_id, SUM(amount) AS total, COUNT(*) FILTER (WHERE status <> 'APPROVED')::int AS bad
    FROM service_work_entries WHERE tenant_id = ${tenantId} AND run_id = ${runId} GROUP BY employee_id`);
  const by = new Map(sums.rows.map((r) => [r.employee_id, r]));
  for (const s of slips) {
    const e = by.get(s.employeeId);
    if ((e && e.bad > 0) || !D(e?.total ?? 0).eq(D(s.serviceIncome))) {
      throw new BadRequestException('Catatan kerja jasa berubah sesudah gaji dihitung. Klik "Hitung ulang" dulu, lalu periksa slipnya.');
    }
  }
  const slipEmp = new Set(slips.map((s) => s.employeeId));
  if (sums.rows.some((r) => !slipEmp.has(r.employee_id))) throw new BadRequestException('Ada catatan kerja jasa yang tidak punya slip. Klik "Hitung ulang" dulu.');
}

@Injectable()
export class ServiceWorkService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Nama pegawai aktif untuk memilih pegawai pada catatan kerja — tanpa gaji/rekening, jadi aman dibuka untuk Admin */
  async staff(u: AuthUser) {
    const r = await this.db.execute<{ id: string; code: string; name: string; isActive: boolean; verified: boolean }>(sql`
      SELECT id, code, name, is_active AS "isActive", verified FROM employees WHERE tenant_id = ${u.tenantId} AND is_active ORDER BY name`);
    return r.rows;
  }

  private async requireJasa(tenantId: string) {
    if ((await this.settings.businessModel(this.db, tenantId)) !== 'JASA') throw new BadRequestException('Fitur ini khusus usaha jasa');
  }

  /** Satuan upah yang berlaku untuk jenis usaha perusahaan ini */
  private async unitsOf(tenantId: string): Promise<WorkUnit[]> {
    return WORK_UNITS_BY_MODEL[await this.settings.businessModel(this.db, tenantId)];
  }

  /** Satuan upah dan batas wajar untuk layar (judul, pilihan satuan tarif) */
  async profile(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    return { model, units: WORK_UNITS_BY_MODEL[model].map((k) => ({ key: k, label: WORK_UNIT_LABELS[k] })), limits: WORK_LIMITS };
  }

  // ---------- kartu tarif ----------
  async listRates(u: AuthUser) {
    return this.db.select().from(serviceRates).where(eq(serviceRates.tenantId, u.tenantId)).orderBy(serviceRates.unit, serviceRates.name);
  }

  async createRate(u: AuthUser, dto: CreateRateDto) {
    if (!(await this.unitsOf(u.tenantId)).includes(dto.unit)) throw new BadRequestException(`Satuan "${WORK_UNIT_LABELS[dto.unit]}" tidak dipakai di jenis usaha Anda`);
    const rate = D(dto.rate);
    this.checkRate(dto.unit, rate);
    const [dup] = await this.db.select({ id: serviceRates.id }).from(serviceRates).where(and(eq(serviceRates.tenantId, u.tenantId), eq(serviceRates.name, dto.name.trim())));
    if (dup) throw new BadRequestException('Nama tarif sudah dipakai');
    const [row] = await this.db.insert(serviceRates).values({ tenantId: u.tenantId, name: dto.name.trim(), unit: dto.unit, rate: rate.toFixed(2), createdById: u.sub }).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceRate', entityId: row.id, data: { name: row.name, unit: row.unit, rate: row.rate } });
    return row;
  }

  async updateRate(u: AuthUser, id: string, dto: UpdateRateDto) {
    const [r] = await this.db.select().from(serviceRates).where(and(eq(serviceRates.id, id), eq(serviceRates.tenantId, u.tenantId)));
    if (!r) throw new NotFoundException('Tarif tidak ditemukan');
    const rate = dto.rate !== undefined ? D(dto.rate) : D(r.rate);
    this.checkRate(r.unit, rate);
    const [row] = await this.db.update(serviceRates).set({ rate: rate.toFixed(2), isActive: dto.isActive ?? r.isActive }).where(eq(serviceRates.id, id)).returning();
    // tarif baru hanya berlaku untuk catatan berikutnya; catatan lama memakai tarif saat dibuat
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ServiceRate', entityId: id, data: { before: { rate: r.rate, isActive: r.isActive }, after: { rate: row.rate, isActive: row.isActive } } });
    return row;
  }

  private checkRate(unit: string, rate: Dec) {
    if (rate.lte(0)) throw new BadRequestException('Tarif harus lebih dari 0');
    if (unit === 'PERCENT' && rate.gt(100)) throw new BadRequestException('Persen komisi maksimal 100');
    if (unit !== 'PERCENT' && rate.gt(1_000_000_000)) throw new BadRequestException('Tarif tidak masuk akal');
  }

  // ---------- catatan kerja ----------
  async list(u: AuthUser, q: EntryQueryDto) {
    const range = q.period ? monthRange(q.period) : null;
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT w.id, w.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName", w.rate_id AS "rateId", sr.name AS "rateName", w.unit,
             w.work_date::text AS "workDate", w.project_id AS "projectId", p.code AS "projectCode", w.invoice_id AS "invoiceId", i.number AS "invoiceNumber", w.production_order_id AS "productionOrderId", po.number AS "productionNumber",
             w.quantity, w.rate, w.base_amount AS "baseAmount", w.amount, w.description, w.status, w.created_by_id AS "createdById", cu.name AS "createdByName",
             w.decided_by_id AS "decidedById", du.name AS "decidedByName", w.decision_note AS "decisionNote", w.run_id AS "runId", r.number AS "runNumber", r.status AS "runStatus"
      FROM service_work_entries w
      JOIN employees e ON e.id = w.employee_id
      JOIN service_rates sr ON sr.id = w.rate_id
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN invoices i ON i.id = w.invoice_id
      LEFT JOIN production_orders po ON po.id = w.production_order_id
      LEFT JOIN payroll_runs r ON r.id = w.run_id
      LEFT JOIN users cu ON cu.id = w.created_by_id
      LEFT JOIN users du ON du.id = w.decided_by_id
      WHERE w.tenant_id = ${u.tenantId}
        ${range ? sql`AND w.work_date BETWEEN ${range.from} AND ${range.to}` : sql``}
        ${q.status ? sql`AND w.status = ${q.status}` : sql``}
        ${q.employeeId ? sql`AND w.employee_id = ${q.employeeId}` : sql``}
      ORDER BY w.work_date DESC, w.created_at DESC LIMIT 500`);
    return rows.rows;
  }

  /** Perintah produksi yang bisa dijadikan dasar upah per hasil (sedang berjalan atau selesai) */
  async productionOrdersForPay(u: AuthUser) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT po.id, po.number, po.status, po.planned_qty AS "plannedQty", po.output_qty AS "outputQty",
             COALESCE((SELECT SUM(w.quantity) FROM service_work_entries w WHERE w.production_order_id = po.id AND w.status IN ('PENDING','APPROVED')), 0) AS "paidQty"
      FROM production_orders po WHERE po.tenant_id = ${u.tenantId} AND po.status IN ('IN_PROGRESS','COMPLETED') ORDER BY po.created_at DESC LIMIT 100`);
    return rows.rows;
  }

  /** Faktur jasa lunas yang bisa dikomisikan, beserta persen yang sudah dibagikan */
  async commissionableInvoices(u: AuthUser) {
    await this.requireJasa(u.tenantId);
    const since = addDays(todayJakarta(), -180);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT i.id, i.number, i.date::text AS date, i.subtotal, c.name AS "customerName", i.project_id AS "projectId",
             COALESCE((SELECT SUM(w.rate) FROM service_work_entries w WHERE w.invoice_id = i.id AND w.status IN ('PENDING','APPROVED')), 0) AS "allocatedPct"
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${u.tenantId} AND i.date >= ${since} AND ${invoiceUsable}
      ORDER BY i.date DESC LIMIT 200`);
    return rows.rows;
  }

  async create(u: AuthUser, dto: CreateEntryDto) {
    const today = todayJakarta();
    const workDate = dto.workDate ?? today;
    if (workDate > today) throw new BadRequestException('Tanggal kerja tidak boleh di masa depan');
    if (workDate < addDays(today, -MAX_BACKDATE_DAYS)) throw new BadRequestException(`Catatan kerja maksimal ${MAX_BACKDATE_DAYS} hari ke belakang`);

    return this.db.transaction(async (tx) => {
      // kunci baris pegawai: mencegah dua catatan bersamaan melewati batas jam harian
      const lock = await tx.execute<{ id: string }>(sql`SELECT id FROM employees WHERE id = ${dto.employeeId} AND tenant_id = ${u.tenantId} FOR UPDATE`);
      if (!lock.rows.length) throw new NotFoundException('Pegawai tidak ditemukan');
      const [emp] = await tx.select().from(employees).where(eq(employees.id, dto.employeeId));
      if (!emp.isActive && !emp.resignDate) throw new BadRequestException('Pegawai tidak aktif');
      if (emp.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat mencatat upah jasa untuk diri sendiri');
      if (!emp.verified) throw new BadRequestException('Karyawan ini belum diverifikasi; belum bisa dicatat upahnya');
      if (workDate < emp.joinDate) throw new BadRequestException('Tanggal kerja sebelum pegawai bergabung');
      if (emp.resignDate && workDate > emp.resignDate) throw new BadRequestException('Tanggal kerja setelah pegawai keluar');
      if (emp.contractEnd && workDate > emp.contractEnd) throw new BadRequestException(`Kontrak pegawai berakhir ${emp.contractEnd}; perpanjang kontrak (dengan persetujuan) sebelum mencatat kerja sesudahnya`);
      if (emp.contractStart && workDate < emp.contractStart) throw new BadRequestException('Tanggal kerja sebelum kontrak dimulai');

      const [rate] = await tx.select().from(serviceRates).where(and(eq(serviceRates.id, dto.rateId), eq(serviceRates.tenantId, u.tenantId)));
      if (!rate) throw new NotFoundException('Tarif tidak ditemukan');
      if (!rate.isActive) throw new BadRequestException('Tarif ini sudah tidak aktif');
      if (!(await this.unitsOf(u.tenantId)).includes(rate.unit)) throw new BadRequestException('Satuan tarif ini tidak dipakai di jenis usaha Anda');

      let projectId = dto.projectId ?? null;
      if (projectId) {
        const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, u.tenantId)));
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      }

      let productionOrderId: string | null = null;
      let quantity: Dec;
      let baseAmount: Dec | null = null;
      let amount: Dec;
      let invoiceId: string | null = null;
      if (rate.unit === 'PERCENT') {
        if (!dto.invoiceId) throw new BadRequestException('Komisi harus dikaitkan ke faktur jasa yang sudah lunas');
        const inv = await tx.execute<{ id: string; subtotal: string; project_id: string | null }>(sql`
          SELECT i.id, i.subtotal, i.project_id FROM invoices i WHERE i.id = ${dto.invoiceId} AND i.tenant_id = ${u.tenantId} AND ${invoiceUsable} FOR UPDATE OF i`);
        if (!inv.rows.length) throw new BadRequestException('Faktur harus faktur jasa yang sudah LUNAS, tidak dibatalkan, dan tanpa retur');
        const allocated = await tx.execute<{ pct: string }>(sql`SELECT COALESCE(SUM(rate), 0) AS pct FROM service_work_entries WHERE invoice_id = ${dto.invoiceId} AND status IN ('PENDING','APPROVED')`);
        if (D(allocated.rows[0].pct).plus(rate.rate).gt(100)) throw new BadRequestException('Total persen komisi untuk faktur ini melebihi 100%');
        invoiceId = dto.invoiceId;
        projectId = projectId ?? inv.rows[0].project_id;
        baseAmount = D(inv.rows[0].subtotal);
        quantity = D(1);
        amount = money(baseAmount.times(rate.rate).div(100));
      } else {
        if (dto.invoiceId) throw new BadRequestException('Faktur hanya untuk tarif komisi');
        if (dto.productionOrderId && rate.unit !== 'PIECE') throw new BadRequestException('Perintah produksi hanya untuk tarif per hasil');
        quantity = D(dto.quantity ?? NaN);
        if (!quantity.isFinite() || quantity.lte(0)) throw new BadRequestException('Jumlah harus lebih dari 0');
        if (quantity.decimalPlaces() > 2) throw new BadRequestException('Jumlah maksimal 2 angka di belakang koma');
        if (rate.unit === 'HOUR') {
          if (quantity.gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Satu catatan maksimal ${MAX_HOURS_PER_DAY} jam`);
          const day = await tx.execute<{ h: string }>(sql`SELECT COALESCE(SUM(quantity), 0) AS h FROM service_work_entries WHERE employee_id = ${emp.id} AND work_date = ${workDate} AND unit = 'HOUR' AND status IN ('PENDING','APPROVED')`);
          if (D(day.rows[0].h).plus(quantity).gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Jam kerja pegawai pada tanggal itu melebihi ${MAX_HOURS_PER_DAY} jam per hari`);
        } else if (rate.unit === 'SHIFT') {
          if (!quantity.isInteger()) throw new BadRequestException('Jumlah shift harus bilangan bulat');
          const day = await tx.execute<{ n: string }>(sql`SELECT COALESCE(SUM(quantity), 0) AS n FROM service_work_entries WHERE employee_id = ${emp.id} AND work_date = ${workDate} AND unit = 'SHIFT' AND status IN ('PENDING','APPROVED')`);
          if (D(day.rows[0].n).plus(quantity).gt(WORK_LIMITS.shiftPerDay)) throw new BadRequestException(`Satu pegawai maksimal ${WORK_LIMITS.shiftPerDay} shift per hari`);
        } else if (rate.unit === 'PIECE') {
          if (quantity.gt(WORK_LIMITS.maxPieceQty)) throw new BadRequestException('Jumlah hasil terlalu besar untuk satu catatan');
          if (dto.productionOrderId) {
            // jumlah hasil yang dibayarkan per perintah produksi tidak boleh melebihi keluarannya (aktual bila selesai, rencana bila berjalan)
            const [po] = await tx.select().from(productionOrders).where(and(eq(productionOrders.id, dto.productionOrderId), eq(productionOrders.tenantId, u.tenantId))).for('update');
            if (!po) throw new BadRequestException('Perintah produksi tidak ditemukan');
            if (po.status !== 'IN_PROGRESS' && po.status !== 'COMPLETED') throw new BadRequestException('Perintah produksi harus sedang berjalan atau sudah selesai');
            const cap = D(po.status === 'COMPLETED' ? po.outputQty : po.plannedQty);
            const used = await tx.execute<{ q: string }>(sql`SELECT COALESCE(SUM(quantity), 0) AS q FROM service_work_entries WHERE production_order_id = ${po.id} AND rate_id = ${rate.id} AND status IN ('PENDING','APPROVED')`);
            if (D(used.rows[0].q).plus(quantity).gt(cap)) throw new BadRequestException(`Jumlah hasil melebihi keluaran perintah produksi ${po.number} (${cap.toFixed(2)} sudah termasuk catatan lain untuk tarif ini)`);
            productionOrderId = po.id;
          }
        } else if (quantity.gt(100)) {
          throw new BadRequestException('Jumlah sesi / pekerjaan terlalu besar untuk satu catatan');
        }
        const [att] = await tx.select({ status: attendances.status }).from(attendances).where(and(eq(attendances.employeeId, emp.id), eq(attendances.date, workDate)));
        if (att && att.status !== 'HADIR') throw new BadRequestException(`Absensi pegawai pada ${workDate} tercatat ${att.status}; tidak bisa ada catatan kerja`);
        amount = money(quantity.times(rate.rate));
      }
      const dup = await tx.execute<{ id: string }>(sql`
        SELECT id FROM service_work_entries WHERE employee_id = ${emp.id} AND work_date = ${workDate} AND rate_id = ${rate.id} AND quantity = ${quantity.toFixed(2)}
          AND project_id IS NOT DISTINCT FROM ${projectId}::uuid AND invoice_id IS NOT DISTINCT FROM ${invoiceId}::uuid
          AND production_order_id IS NOT DISTINCT FROM ${productionOrderId}::uuid AND status IN ('PENDING','APPROVED') LIMIT 1`);
      if (dup.rows.length) throw new BadRequestException('Catatan yang sama persis sudah ada');

      const [row] = await tx
        .insert(serviceWorkEntries)
        .values({
          tenantId: u.tenantId,
          employeeId: emp.id,
          rateId: rate.id,
          unit: rate.unit,
          workDate,
          projectId,
          invoiceId,
          productionOrderId,
          quantity: quantity.toFixed(2),
          rate: D(rate.rate).toFixed(2),
          baseAmount: baseAmount ? baseAmount.toFixed(2) : null,
          amount: amount.toFixed(2),
          description: dto.description ?? null,
          createdById: u.sub,
        })
        .returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceWorkEntry', entityId: row.id, data: { employee: emp.code, unit: row.unit, workDate, quantity: row.quantity, rate: row.rate, amount: row.amount, invoiceId } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['FINANCE', 'ADMIN', 'OWNER'], excludeUserId: u.sub, title: `Catatan upah kerja menunggu persetujuan: ${emp.code} · Rp${Math.round(amount.toNumber()).toLocaleString('id-ID')}`, lines: [`Dicatat oleh ${u.email ?? 'HR'} untuk tanggal ${workDate}`], path: '/payroll/jasa' });
      return row;
    });
  }

  private async lockEntry(tx: Tx, tenantId: string, id: string) {
    const [e] = await tx.select().from(serviceWorkEntries).where(and(eq(serviceWorkEntries.id, id), eq(serviceWorkEntries.tenantId, tenantId))).for('update');
    if (!e) throw new NotFoundException('Catatan kerja tidak ditemukan');
    return e;
  }

  /** Pemisahan fungsi saat memutuskan: bukan pegawai yang bersangkutan, dan bukan pembuat catatan (kecuali Pemilik) */
  private async assertCanDecide(tx: Tx, u: AuthUser, e: typeof serviceWorkEntries.$inferSelect) {
    const [emp] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, e.employeeId));
    if (emp?.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat memutuskan catatan upah Anda sendiri');
    if (e.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Catatan harus diputuskan oleh orang lain dari pembuatnya (pemisahan fungsi)');
  }

  async approve(u: AuthUser, id: string, dto: DecideEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status !== 'PENDING') throw new BadRequestException('Catatan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, e);
      if (e.unit === 'PERCENT') {
        const ok = await tx.execute(sql`SELECT 1 FROM invoices i WHERE i.id = ${e.invoiceId} AND ${invoiceUsable}`);
        if (!ok.rows.length) throw new BadRequestException('Faktur komisi ini tidak lagi layak (belum lunas / dibatalkan / ada retur)');
      }
      const [row] = await tx.update(serviceWorkEntries).set({ status: 'APPROVED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.note ?? null }).where(eq(serviceWorkEntries.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'ServiceWorkEntry', entityId: id, data: { amount: e.amount, createdBy: e.createdById } });
      return row;
    });
  }

  async reject(u: AuthUser, id: string, dto: VoidEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status !== 'PENDING') throw new BadRequestException('Catatan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, e);
      const [row] = await tx.update(serviceWorkEntries).set({ status: 'REJECTED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.reason }).where(eq(serviceWorkEntries.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'ServiceWorkEntry', entityId: id, data: { reason: dto.reason } });
      return row;
    });
  }

  /** Batalkan: pembuat boleh menarik catatan yang masih menunggu; keuangan boleh membatalkan yang sudah disetujui selama gajinya belum diposting */
  async voidIt(u: AuthUser, id: string, dto: VoidEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status === 'REJECTED' || e.status === 'VOID') throw new BadRequestException('Catatan ini sudah ditolak / dibatalkan');
      const isDecider = ['FINANCE', 'ADMIN', 'OWNER'].includes(u.role);
      if (e.status === 'APPROVED' && !isDecider) throw new ForbiddenException('Catatan yang sudah disetujui hanya dapat dibatalkan oleh Keuangan / Admin');
      if (e.status === 'PENDING' && !isDecider && e.createdById !== u.sub) throw new ForbiddenException('Hanya pembuat catatan yang dapat menariknya');
      if (e.runId) {
        const [run] = await tx.execute<{ status: string; number: string }>(sql`SELECT status, number FROM payroll_runs WHERE id = ${e.runId}`).then((r) => r.rows);
        if (run && run.status !== 'DRAFT') throw new BadRequestException(`Sudah masuk gaji ${run.number} yang diposting; tidak bisa dibatalkan`);
      }
      const [row] = await tx.update(serviceWorkEntries).set({ status: 'VOID', decisionNote: dto.reason, decidedById: u.sub, decidedAt: new Date(), runId: null }).where(eq(serviceWorkEntries.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VOID', entity: 'ServiceWorkEntry', entityId: id, data: { reason: dto.reason, wasStatus: e.status, amount: e.amount } });
      return row;
    });
  }

  /** Hal yang patut diperiksa pemilik / keuangan sebelum memposting gaji */
  async anomalies(u: AuthUser, period: string) {
    const { from, to } = monthRange(period);
    const out: { kind: string; severity: 'warn' | 'info'; message: string; employeeId?: string }[] = [];
    const hours = await this.db.execute<{ employee_id: string; name: string; h: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.quantity) AS h FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${u.tenantId} AND w.unit = 'HOUR' AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name HAVING SUM(w.quantity) > ${MAX_HOURS_PER_MONTH}`);
    for (const r of hours.rows) out.push({ kind: 'JAM_BERLEBIH', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ${D(r.h).toFixed(1)} jam dalam sebulan (batas wajar ${MAX_HOURS_PER_MONTH})` });
    const stuck = await this.db.execute<{ employee_id: string; name: string; number: string | null }>(sql`
      SELECT w.employee_id, e.name, i.number FROM service_work_entries w JOIN employees e ON e.id = w.employee_id LEFT JOIN invoices i ON i.id = w.invoice_id
      WHERE w.tenant_id = ${u.tenantId} AND w.unit = 'PERCENT' AND w.status = 'APPROVED' AND w.run_id IS NULL AND w.work_date <= ${to}`);
    for (const r of stuck.rows) out.push({ kind: 'KOMISI_TERTAHAN', severity: 'warn', employeeId: r.employee_id, message: `Komisi ${r.name} dari faktur ${r.number ?? '-'} tertahan: faktur belum lunas, dibatalkan, atau diretur` });
    const conflict = await this.db.execute<{ employee_id: string; name: string; d: string; st: string }>(sql`
      SELECT w.employee_id, e.name, w.work_date::text AS d, a.status::text AS st
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id JOIN attendances a ON a.employee_id = w.employee_id AND a.date = w.work_date
      WHERE w.tenant_id = ${u.tenantId} AND w.unit <> 'PERCENT' AND w.status IN ('PENDING','APPROVED') AND a.status <> 'HADIR' AND w.work_date BETWEEN ${from} AND ${to}`);
    for (const r of conflict.rows) out.push({ kind: 'BENTROK_ABSENSI', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ada catatan kerja pada ${r.d} padahal absensi ${r.st}` });
    const big = await this.db.execute<{ employee_id: string; name: string; svc: string; base: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.amount) AS svc, (e.base_salary + e.fixed_allowance) AS base
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${u.tenantId} AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name, e.base_salary, e.fixed_allowance
      HAVING (e.base_salary + e.fixed_allowance) > 0 AND SUM(w.amount) > 3 * (e.base_salary + e.fixed_allowance)`);
    for (const r of big.rows) out.push({ kind: 'UPAH_JASA_BESAR', severity: 'info', employeeId: r.employee_id, message: `${r.name}: upah kerja bulan ini lebih dari 3× gaji tetapnya` });
    // premi shift berlebihan dan hasil per perintah produksi yang sudah melebihi keluaran (mis. setelah keluaran dikoreksi)
    const shifts = await this.db.execute<{ employee_id: string; name: string; n: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.quantity) AS n FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${u.tenantId} AND w.unit = 'SHIFT' AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name HAVING SUM(w.quantity) > 31`);
    for (const r of shifts.rows) out.push({ kind: 'SHIFT_BERLEBIH', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ${D(r.n).toFixed(0)} shift dalam sebulan (lebih dari 31)` });
    const over = await this.db.execute<{ number: string; paid: string; cap: string }>(sql`
      SELECT po.number, SUM(w.quantity) AS paid, (CASE WHEN po.status = 'COMPLETED' THEN po.output_qty ELSE po.planned_qty END) AS cap
      FROM service_work_entries w JOIN production_orders po ON po.id = w.production_order_id
      WHERE w.tenant_id = ${u.tenantId} AND w.unit = 'PIECE' AND w.status IN ('PENDING','APPROVED')
      GROUP BY po.id, po.number, po.status, po.output_qty, po.planned_qty
      HAVING SUM(w.quantity) > (CASE WHEN po.status = 'COMPLETED' THEN po.output_qty ELSE po.planned_qty END)`);
    for (const r of over.rows) out.push({ kind: 'HASIL_MELEBIHI_PRODUKSI', severity: 'warn', message: `Perintah produksi ${r.number}: hasil yang dibayar ${D(r.paid).toFixed(2)} melebihi keluaran ${D(r.cap).toFixed(2)}` });
    return out;
  }
}

@ApiTags('Penggajian — jasa')
@ApiBearerAuth()
@RequireApp('payroll')
@Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('payroll/service')
export class ServiceWorkController {
  constructor(private readonly svc: ServiceWorkService) {}

  @Get('staff')
  staff(@CurrentUser() u: AuthUser) {
    return this.svc.staff(u);
  }
  @Get('profile')
  profile(@CurrentUser() u: AuthUser) {
    return this.svc.profile(u);
  }
  @Get('rates')
  rates(@CurrentUser() u: AuthUser) {
    return this.svc.listRates(u);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('rates')
  createRate(@CurrentUser() u: AuthUser, @Body() dto: CreateRateDto) {
    return this.svc.createRate(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Patch('rates/:id')
  updateRate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRateDto) {
    return this.svc.updateRate(u, id, dto);
  }
  @Get('entries')
  entries(@CurrentUser() u: AuthUser, @Query() q: EntryQueryDto) {
    return this.svc.list(u, q);
  }
  @Get('production-orders')
  productionOrders(@CurrentUser() u: AuthUser) {
    return this.svc.productionOrdersForPay(u);
  }
  @Get('commissionable-invoices')
  invoices(@CurrentUser() u: AuthUser) {
    return this.svc.commissionableInvoices(u);
  }
  @Get('anomalies')
  anomalies(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    return this.svc.anomalies(u, period && PERIOD.test(period) ? period : todayJakarta().slice(0, 7));
  }
  @Roles('HR')
  @Post('entries')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEntryDto) {
    return this.svc.create(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('entries/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideEntryDto) {
    return this.svc.approve(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('entries/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidEntryDto) {
    return this.svc.reject(u, id, dto);
  }
  @Roles('HR', 'FINANCE', 'ADMIN')
  @Post('entries/:id/void')
  voidIt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidEntryDto) {
    return this.svc.voidIt(u, id, dto);
  }
}
