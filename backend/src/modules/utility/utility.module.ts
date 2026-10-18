/**
 * Layanan utilitas (air, listrik, internet, kebersihan): tarif bertingkat, sambungan pelanggan, catat meter, tagihan bulanan,
 * denda keterlambatan, serta pemutusan dan penyambungan kembali. Tagihan memakai faktur jasa yang sudah ada, jadi piutang,
 * pembayaran, jurnal, dan PPN mengikuti alur Penjualan biasa.
 *
 * Pencegahan kecurangan:
 *  - angka meter dicatat petugas, DIVERIFIKASI orang lain (pemisahan fungsi; Pemilik dikecualikan); angka janggal wajib catatan pemeriksa
 *  - angka meter tidak boleh turun kecuali meter diganti (dengan angka akhir meter lama + angka awal meter baru)
 *  - tagihan hanya dari pencatatan terverifikasi; satu sambungan satu tagihan per periode (klaim periode, tidak bisa tertagih dua kali)
 *  - denda dihitung server dari aturan perusahaan, sekali per tagihan, dengan batas persentase
 *  - pemutusan hanya bila menunggak melebihi batas (atau atas permintaan pelanggan), penyambungan kembali oleh orang lain dan hanya bila lunas
 *  - tarif hanya diubah Admin/Pemilik dan tercatat sebelum/sesudah; sambungan ganda pada alamat dan layanan yang sama ditolak
 *  - kontrol kebocoran pendapatan: sambungan aktif tanpa pencatatan, pemakaian nol berulang, pencatatan lama belum diverifikasi
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { and, eq, sql } from 'drizzle-orm';
import {
  computeBill,
  DEFAULT_UTILITY_RULES,
  flagReading,
  isPeriod,
  lateFee,
  UTILITY_SERVICE_DEFAULTS,
  UTILITY_SERVICE_TYPES,
  validateBlocks,
  validateRules,
  type TariffBlock,
  type UtilityRules,
  type UtilityServiceType,
} from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, customers, utilityBills, utilityConnections, utilityLateFees, utilityReadings, utilityTariffs } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { ServiceBillingService } from '../sales/services/service-billing';
import { SalesModule } from '../sales/sales.module';

const SECTION = 'utility';
const num = (v: unknown) => Number(v ?? 0);
const isUnique = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');
const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

// ---------- DTO ----------
export class BlockDto {
  @ApiPropertyOptional({ description: 'Sampai pemakaian ini (kosong = tanpa batas, hanya blok terakhir)' }) @IsOptional() @IsNumber() @Min(0) upTo?: number | null;
  @ApiProperty() @IsNumber() @Min(0) price: number;
}
export class TariffDto {
  @ApiProperty({ example: 'Air rumah tangga' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: UTILITY_SERVICE_TYPES }) @IsIn(UTILITY_SERVICE_TYPES) serviceType: UtilityServiceType;
  @ApiPropertyOptional({ example: 'm³' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiProperty({ example: 10000 }) @IsNumber() @Min(0) fixedFee: number;
  @ApiProperty({ example: 2500 }) @IsNumber() @Min(0) adminFee: number;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsNumber() @Min(0) minUsage?: number;
  @ApiProperty({ type: [BlockDto] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BlockDto) blocks: BlockDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vatable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class ConnectionDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() tariffId: string;
  @ApiPropertyOptional({ description: 'Nomor meter (wajib untuk layanan terukur)' }) @IsOptional() @IsString() @MaxLength(60) meterNo?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) address: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() installedAt?: string;
  @ApiPropertyOptional({ example: '0', description: 'Angka meter saat dipasang' }) @IsOptional() @IsNumberString() initialReading?: string;
}
export class ReadingDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiProperty({ example: '1234.5', description: 'Angka meter sekarang (meter diganti: angka meter BARU)' }) @IsNumberString() current: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() meterReplaced?: boolean;
  @ApiPropertyOptional({ description: 'Meter diganti: angka akhir meter LAMA' }) @IsOptional() @IsNumberString() oldMeterFinal?: string;
  @ApiPropertyOptional({ description: 'Meter diganti: angka awal meter BARU' }) @IsOptional() @IsNumberString() newMeterStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class VerifyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class SuspendDto extends ReasonDto {
  @ApiPropertyOptional({ description: 'Atas permintaan pelanggan (boleh tanpa tunggakan)' }) @IsOptional() @IsBoolean() onRequest?: boolean;
}
export class BillRunDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
}
export class RulesDto {
  @ApiProperty() @IsNumber() graceDays: number;
  @ApiProperty() @IsNumber() lateFeePct: number;
  @ApiProperty() @IsNumber() lateFeeCapPct: number;
  @ApiProperty() @IsNumber() suspendAfterDays: number;
  @ApiProperty() @IsNumber() spikeFactor: number;
  @ApiProperty() @IsNumber() spikeMinUsage: number;
  @ApiProperty() @IsNumber() dueDays: number;
}

interface TariffRow {
  id: string;
  name: string;
  service_type: UtilityServiceType;
  unit: string;
  metered: boolean;
  fixed_fee: string;
  admin_fee: string;
  min_usage: string;
  blocks: TariffBlock[];
  vatable: boolean;
}
interface ConnRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  tariff_id: string;
  status: string;
  installed_at: string;
  initial_reading: string;
  status_changed_by_id: string | null;
  meter_no: string | null;
  address: string;
}

@Injectable()
export class UtilityService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly billing: ServiceBillingService,
  ) {}

  // ---------- aturan ----------
  rules(tenantId: string): Promise<UtilityRules> {
    return this.settings.section(this.db, tenantId, SECTION, DEFAULT_UTILITY_RULES);
  }
  async saveRules(u: AuthUser, dto: RulesDto) {
    const problems = validateRules(dto);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    const before = await this.rules(u.tenantId);
    const saved = await this.settings.saveSection(this.db, u.tenantId, SECTION, DEFAULT_UTILITY_RULES, dto);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityRules', entityId: u.tenantId, data: { before, after: saved } });
    return saved;
  }

  // ---------- tarif ----------
  async tariffs(tenantId: string) {
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.service_type AS "serviceType", t.unit, t.metered, t.fixed_fee AS "fixedFee", t.admin_fee AS "adminFee", t.min_usage AS "minUsage", t.blocks, t.vatable, t.is_active AS "isActive",
             (SELECT COUNT(*)::int FROM utility_connections c WHERE c.tariff_id = t.id AND c.status <> 'DISCONNECTED') AS "connections"
      FROM utility_tariffs t WHERE t.tenant_id = ${tenantId} ORDER BY t.service_type, t.name`);
    return r.rows;
  }

  private normalizeTariff(dto: TariffDto) {
    const defaults = UTILITY_SERVICE_DEFAULTS[dto.serviceType];
    const blocks: TariffBlock[] = dto.blocks.map((b) => ({ upTo: b.upTo ?? null, price: b.price }));
    const problems = validateBlocks(blocks, defaults.metered);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    if (!defaults.metered && dto.fixedFee <= 0) throw new BadRequestException('Layanan tarif tetap membutuhkan biaya tetap per periode lebih dari 0');
    if (defaults.metered && dto.fixedFee <= 0 && blocks.every((b) => b.price <= 0)) throw new BadRequestException('Tarif tidak boleh bernilai nol semua');
    return { blocks, metered: defaults.metered, unit: dto.unit?.trim() || defaults.unit };
  }

  async createTariff(u: AuthUser, dto: TariffDto) {
    const n = this.normalizeTariff(dto);
    try {
      const [row] = await this.db
        .insert(utilityTariffs)
        .values({ tenantId: u.tenantId, name: dto.name.trim(), serviceType: dto.serviceType, unit: n.unit, metered: n.metered, fixedFee: dto.fixedFee.toFixed(2), adminFee: dto.adminFee.toFixed(2), minUsage: String(dto.minUsage ?? 0), blocks: n.blocks, vatable: !!dto.vatable, createdById: u.sub })
        .returning();
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityTariff', entityId: row.id, data: { name: row.name, blocks: n.blocks, fixedFee: row.fixedFee } });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama tarif sudah dipakai');
      throw e;
    }
  }

  async updateTariff(u: AuthUser, id: string, dto: TariffDto) {
    const [old] = await this.db.select().from(utilityTariffs).where(and(eq(utilityTariffs.id, id), eq(utilityTariffs.tenantId, u.tenantId)));
    if (!old) throw new NotFoundException('Tarif tidak ditemukan');
    if (old.serviceType !== dto.serviceType) throw new BadRequestException('Jenis layanan tarif tidak bisa diubah — buat tarif baru');
    const n = this.normalizeTariff(dto);
    try {
      const [row] = await this.db
        .update(utilityTariffs)
        .set({ name: dto.name.trim(), unit: n.unit, fixedFee: dto.fixedFee.toFixed(2), adminFee: dto.adminFee.toFixed(2), minUsage: String(dto.minUsage ?? 0), blocks: n.blocks, vatable: !!dto.vatable, isActive: dto.isActive ?? old.isActive })
        .where(eq(utilityTariffs.id, id))
        .returning();
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityTariff', entityId: id, data: { before: { name: old.name, fixedFee: old.fixedFee, adminFee: old.adminFee, blocks: old.blocks, vatable: old.vatable }, after: { name: row.name, fixedFee: row.fixedFee, adminFee: row.adminFee, blocks: row.blocks, vatable: row.vatable } } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['FINANCE', 'OWNER'], excludeUserId: u.sub, title: `Tarif "${row.name}" diubah`, lines: ['Berlaku untuk tagihan berikutnya. Periksa riwayat perubahan di jejak audit.'], path: '/utility' });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama tarif sudah dipakai');
      throw e;
    }
  }

  // ---------- sambungan ----------
  async connections(tenantId: string, q: { status?: string; search?: string }) {
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.status, c.meter_no AS "meterNo", c.address, c.installed_at::text AS "installedAt", c.status_note AS "statusNote",
             c.customer_id AS "customerId", cu.name AS "customerName", c.tariff_id AS "tariffId", t.name AS "tariffName", t.service_type AS "serviceType", t.unit, t.metered,
             (SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1) AS "lastReading",
             (SELECT r.period FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1) AS "lastPeriod"
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
        ${q.search ? sql`AND (cu.name ILIKE ${'%' + q.search + '%'} OR c.number ILIKE ${'%' + q.search + '%'} OR c.meter_no ILIKE ${'%' + q.search + '%'} OR c.address ILIKE ${'%' + q.search + '%'})` : sql``}
      ORDER BY c.number DESC LIMIT 500`);
    return r.rows;
  }

  async connection(tenantId: string, id: string) {
    const [c] = (await this.connections(tenantId, {})).filter((x) => x.id === id);
    if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
    const readings = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.period, r.previous, r.current, r.usage, r.status, r.flags, r.meter_replaced AS "meterReplaced", r.note, eu.name AS "enteredByName", vu.name AS "verifiedByName", r.verify_note AS "verifyNote"
      FROM utility_readings r LEFT JOIN users eu ON eu.id = r.entered_by_id LEFT JOIN users vu ON vu.id = r.verified_by_id
      WHERE r.connection_id = ${id} AND r.tenant_id = ${tenantId} ORDER BY r.period DESC LIMIT 24`);
    const bills = await this.db.execute<Record<string, unknown>>(sql`
      SELECT b.id, b.period, b.usage, b.subtotal, b.late_fee AS "lateFee", i.id AS "invoiceId", i.number AS "invoiceNumber", i.total, i.paid_amount AS "paidAmount", i.status, i.due_date::text AS "dueDate"
      FROM utility_bills b LEFT JOIN invoices i ON i.id = b.invoice_id WHERE b.connection_id = ${id} AND b.tenant_id = ${tenantId} ORDER BY b.period DESC LIMIT 24`);
    return { ...c, readings: readings.rows, bills: bills.rows };
  }

  async createConnection(u: AuthUser, dto: ConnectionDto) {
    return this.db.transaction(async (tx) => {
      const [cust] = await tx.select({ id: customers.id, isActive: customers.isActive }).from(customers).where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, u.tenantId)));
      if (!cust || !cust.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
      const [t] = await tx.select().from(utilityTariffs).where(and(eq(utilityTariffs.id, dto.tariffId), eq(utilityTariffs.tenantId, u.tenantId)));
      if (!t || !t.isActive) throw new BadRequestException('Tarif tidak ditemukan / nonaktif');
      const meterNo = dto.meterNo?.trim() || null;
      if (t.metered && !meterNo) throw new BadRequestException('Nomor meter wajib untuk layanan terukur');
      if (!t.metered && meterNo) throw new BadRequestException('Layanan tarif tetap tidak memakai nomor meter');
      const installed = toDocDate(dto.installedAt);
      if (installed > todayJakarta()) throw new BadRequestException('Tanggal pasang tidak boleh di masa depan');
      const initial = D(dto.initialReading ?? '0');
      if (!initial.isFinite() || initial.lt(0)) throw new BadRequestException('Angka awal meter tidak valid');
      const dup = await tx.execute(sql`
        SELECT c.number FROM utility_connections c JOIN utility_tariffs t2 ON t2.id = c.tariff_id
        WHERE c.tenant_id = ${u.tenantId} AND c.status <> 'DISCONNECTED' AND t2.service_type = ${t.serviceType}
          AND (lower(btrim(c.address)) = lower(btrim(${dto.address})) OR (${meterNo}::text IS NOT NULL AND c.meter_no = ${meterNo})) LIMIT 1`);
      if (dup.rows.length) throw new BadRequestException(`Alamat atau nomor meter ini sudah terdaftar pada sambungan ${(dup.rows[0] as { number: string }).number} (layanan sama)`);
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_CONNECTION', installed);
      const [row] = await tx
        .insert(utilityConnections)
        .values({ tenantId: u.tenantId, number, customerId: dto.customerId, tariffId: dto.tariffId, meterNo, address: dto.address.trim(), installedAt: installed, initialReading: initial.toString(), createdById: u.sub })
        .returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityConnection', entityId: row.id, data: { number, meterNo, tariff: t.name } });
      return row;
    });
  }

  private async lockConnection(tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const r = await tx.execute(sql`SELECT c.*, cu.name AS customer_name FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = ${id} AND c.tenant_id = ${tenantId} FOR UPDATE OF c`);
    if (!r.rows.length) throw new NotFoundException('Sambungan tidak ditemukan');
    return r.rows[0] as unknown as ConnRow;
  }

  /** Tunggakan melewati jatuh tempo untuk satu sambungan */
  private async overdueOf(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, connectionId: string) {
    const r = await db.execute<{ outstanding: string; days_late: number }>(sql`
      SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS outstanding, COALESCE(MAX(${todayJakarta()}::date - i.due_date), 0)::int AS days_late
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.status <> 'PAID' AND i.due_date < ${todayJakarta()}::date`);
    return { outstanding: num(r.rows[0]?.outstanding), daysLate: Number(r.rows[0]?.days_late ?? 0) };
  }
  private async unpaidOf(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, connectionId: string) {
    const r = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.status <> 'PAID'`);
    return Number(r.rows[0]?.n ?? 0);
  }

  async suspend(u: AuthUser, id: string, dto: SuspendDto) {
    const rules = await this.rules(u.tenantId);
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status !== 'ACTIVE') throw new BadRequestException('Hanya sambungan aktif yang bisa diputus sementara');
      if (!dto.onRequest) {
        const od = await this.overdueOf(tx, u.tenantId, id);
        if (od.daysLate <= rules.suspendAfterDays) throw new BadRequestException(`Pemutusan hanya untuk tunggakan lebih dari ${rules.suspendAfterDays} hari setelah jatuh tempo (saat ini ${od.daysLate} hari). Pilih "atas permintaan pelanggan" bila pelanggan yang meminta.`);
      }
      await tx.update(utilityConnections).set({ status: 'SUSPENDED', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason }).where(eq(utilityConnections.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'SUSPEND', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason, onRequest: !!dto.onRequest } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['ADMIN', 'OWNER', 'FINANCE'], excludeUserId: u.sub, title: `Sambungan ${c.number} (${c.customer_name}) diputus sementara`, lines: [dto.reason, 'Penyambungan kembali harus dilakukan orang lain setelah tagihan lunas.'], path: '/utility' });
      return { ok: true };
    });
  }

  async reconnect(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status !== 'SUSPENDED') throw new BadRequestException('Sambungan ini tidak sedang diputus sementara');
      if (c.status_changed_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Penyambungan kembali harus dilakukan orang lain dari yang memutus (pemisahan fungsi)');
      const od = await this.overdueOf(tx, u.tenantId, id);
      if (od.outstanding > 0) throw new BadRequestException(`Masih ada tunggakan jatuh tempo ${rp(od.outstanding)}. Lunasi dulu sebelum disambung kembali.`);
      await tx.update(utilityConnections).set({ status: 'ACTIVE', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason }).where(eq(utilityConnections.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'RECONNECT', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason } });
      return { ok: true };
    });
  }

  async disconnect(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status === 'DISCONNECTED') throw new BadRequestException('Sambungan sudah dibongkar');
      if (await this.unpaidOf(tx, u.tenantId, id)) throw new BadRequestException('Masih ada tagihan yang belum lunas. Lunasi atau selesaikan dulu sebelum sambungan dibongkar.');
      await tx.update(utilityConnections).set({ status: 'DISCONNECTED', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason }).where(eq(utilityConnections.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'DISCONNECT', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason } });
      return { ok: true };
    });
  }

  // ---------- catat meter ----------
  async readings(tenantId: string, q: { period?: string; status?: string; connectionId?: string }) {
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.period, r.previous, r.current, r.usage, r.status, r.flags, r.meter_replaced AS "meterReplaced", r.note, r.verify_note AS "verifyNote",
             r.connection_id AS "connectionId", c.number AS "connectionNumber", c.meter_no AS "meterNo", cu.name AS "customerName", t.unit,
             eu.name AS "enteredByName", r.entered_by_id AS "enteredById", vu.name AS "verifiedByName", r.entered_at AS "enteredAt"
      FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      LEFT JOIN users eu ON eu.id = r.entered_by_id LEFT JOIN users vu ON vu.id = r.verified_by_id
      WHERE r.tenant_id = ${tenantId} ${q.period ? sql`AND r.period = ${q.period}` : sql``} ${q.status ? sql`AND r.status = ${q.status}` : sql``} ${q.connectionId ? sql`AND r.connection_id = ${q.connectionId}` : sql``}
      ORDER BY (r.status = 'ENTERED') DESC, r.entered_at DESC LIMIT 500`);
    return r.rows;
  }

  /** Sambungan terukur aktif yang belum punya pencatatan untuk periode ini (daftar kerja petugas) */
  async due(tenantId: string, period: string) {
    if (!isPeriod(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.meter_no AS "meterNo", c.address, cu.name AS "customerName", t.unit,
             COALESCE((SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1), c.initial_reading) AS previous
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')
      ORDER BY c.address LIMIT 1000`);
    return r.rows;
  }

  async enterReading(u: AuthUser, dto: ReadingDto) {
    const rules = await this.rules(u.tenantId);
    if (dto.period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode pencatatan tidak boleh di masa depan');
    const result = await this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, dto.connectionId);
      if (c.status !== 'ACTIVE') throw new BadRequestException('Sambungan tidak aktif');
      const [t] = await tx.select().from(utilityTariffs).where(eq(utilityTariffs.id, c.tariff_id));
      if (!t.metered) throw new BadRequestException('Layanan ini tarif tetap — tidak perlu catat meter');
      if (dto.period < c.installed_at.slice(0, 7)) throw new BadRequestException('Periode sebelum tanggal pasang sambungan');
      const last = (await tx.execute<{ period: string; current: string; status: string; id: string }>(sql`SELECT id, period, current, status FROM utility_readings WHERE connection_id = ${c.id} AND status <> 'REJECTED' ORDER BY period DESC LIMIT 1`)).rows[0];
      if (last && last.period >= dto.period) throw new BadRequestException(last.period === dto.period ? 'Periode ini sudah dicatat' : `Pencatatan terakhir sudah periode ${last.period}; periode harus setelahnya`);
      const prev = D(last?.current ?? c.initial_reading);
      const cur = D(dto.current);
      if (!cur.isFinite() || cur.lt(0)) throw new BadRequestException('Angka meter tidak valid');
      let usage = cur.minus(prev);
      if (dto.meterReplaced) {
        if (dto.oldMeterFinal === undefined || dto.newMeterStart === undefined) throw new BadRequestException('Meter diganti: isi angka akhir meter lama dan angka awal meter baru');
        const oldFinal = D(dto.oldMeterFinal);
        const newStart = D(dto.newMeterStart);
        if (oldFinal.lt(prev)) throw new BadRequestException('Angka akhir meter lama lebih kecil dari catatan sebelumnya');
        if (cur.lt(newStart)) throw new BadRequestException('Angka meter baru lebih kecil dari angka awalnya');
        if (!(dto.note ?? '').trim()) throw new BadRequestException('Meter diganti: tulis catatan (nomor meter baru, alasan penggantian)');
        usage = oldFinal.minus(prev).plus(cur.minus(newStart));
      } else if (cur.lt(prev)) {
        throw new BadRequestException(`Angka meter (${cur.toString()}) lebih kecil dari catatan sebelumnya (${prev.toString()}). Bila meter diganti, centang "meter diganti".`);
      }
      const hist = (await tx.execute<{ usage: string }>(sql`SELECT usage FROM utility_readings WHERE connection_id = ${c.id} AND status <> 'REJECTED' ORDER BY period DESC LIMIT 3`)).rows.map((x) => num(x.usage));
      const flags = flagReading(usage.toNumber(), hist, rules, !!dto.meterReplaced);
      try {
        const [row] = await tx
          .insert(utilityReadings)
          .values({ tenantId: u.tenantId, connectionId: c.id, period: dto.period, previous: prev.toString(), current: cur.toString(), usage: usage.toString(), meterReplaced: !!dto.meterReplaced, flags, note: dto.note?.trim() || null, enteredById: u.sub })
          .returning();
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityReading', entityId: row.id, data: { connection: c.number, period: dto.period, usage: row.usage, flags } });
        return { row, flags };
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('Periode ini sudah dicatat');
        throw e;
      }
    });
    return { ...result.row, flags: result.flags };
  }

  private async lockReading(tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const r = await tx.execute(sql`SELECT * FROM utility_readings WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new NotFoundException('Pencatatan tidak ditemukan');
    return r.rows[0] as unknown as { id: string; status: string; entered_by_id: string; flags: string[]; connection_id: string; period: string };
  }

  async verify(u: AuthUser, id: string, dto: VerifyDto) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockReading(tx, u.tenantId, id);
      if (r.status !== 'ENTERED') throw new BadRequestException('Pencatatan ini sudah diputuskan');
      if (r.entered_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pencatatan harus diverifikasi orang lain dari petugas yang mencatat (pemisahan fungsi)');
      if (r.flags.length && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Angka ini ditandai janggal (${r.flags.join(', ')}). Tulis catatan pemeriksaan (mis. hasil cek ulang lapangan).`);
      await tx.update(utilityReadings).set({ status: 'VERIFIED', verifiedById: u.sub, verifiedAt: new Date(), verifyNote: dto.note?.trim() || null }).where(eq(utilityReadings.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityReading', entityId: id, data: { flags: r.flags, note: dto.note } });
      return { ok: true };
    });
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockReading(tx, u.tenantId, id);
      if (r.status !== 'ENTERED') throw new BadRequestException('Hanya pencatatan yang menunggu verifikasi yang bisa ditolak');
      if (r.entered_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pencatatan hanya bisa ditolak orang lain dari petugas yang mencatat');
      await tx.update(utilityReadings).set({ status: 'REJECTED', verifiedById: u.sub, verifiedAt: new Date(), verifyNote: dto.reason }).where(eq(utilityReadings.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'UtilityReading', entityId: id, data: { reason: dto.reason } });
      return { ok: true };
    });
  }

  // ---------- penagihan ----------
  private async lateFeeCandidates(tenantId: string, connectionId: string, rules: UtilityRules) {
    const today = todayJakarta();
    const r = await this.db.execute<{ invoice_id: string; number: string; total: string; paid_amount: string; due_date: string; bill_id: string }>(sql`
      SELECT i.id AS invoice_id, i.number, i.total, i.paid_amount, i.due_date::text, b.id AS bill_id
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.status <> 'PAID'
        AND NOT EXISTS (SELECT 1 FROM utility_late_fees f WHERE f.invoice_id = i.id)`);
    const out: { invoiceId: string; number: string; billId: string; amount: number; daysLate: number }[] = [];
    for (const x of r.rows) {
      const daysLate = diffDays(x.due_date, today);
      const amount = lateFee(num(x.total), num(x.total) - num(x.paid_amount), daysLate, rules);
      if (amount > 0) out.push({ invoiceId: x.invoice_id, number: x.number, billId: x.bill_id, amount, daysLate });
    }
    return out;
  }

  /** Rencana penagihan satu periode: apa yang akan ditagih, apa yang tertahan dan kenapa */
  async plan(tenantId: string, period: string) {
    if (!isPeriod(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    if (period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode penagihan tidak boleh di masa depan');
    const rules = await this.rules(tenantId);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id AS connection_id, c.number, c.status, c.address, cu.id AS customer_id, cu.name AS customer_name, t.id AS tariff_id, t.name AS tariff_name, t.unit, t.metered, t.fixed_fee, t.admin_fee, t.min_usage, t.blocks, t.vatable,
             r.id AS reading_id, r.status AS reading_status, r.usage, b.id AS bill_id, b.invoice_id AS bill_invoice_id
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      LEFT JOIN utility_readings r ON r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED'
      LEFT JOIN utility_bills b ON b.connection_id = c.id AND b.period = ${period}
      WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED' AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
      ORDER BY c.number`);
    const ready: { connectionId: string; number: string; customerId: string; customerName: string; tariffId: string; tariffName: string; vatable: boolean; unit: string; usage: number | null; readingId: string | null; lines: ReturnType<typeof computeBill>['lines']; subtotal: number; lateFees: { invoiceId: string; number: string; billId: string; amount: number; daysLate: number }[]; lateFeeTotal: number }[] = [];
    const held: { connectionId: string; number: string; customerName: string; reason: string }[] = [];
    for (const x of rows.rows) {
      const base = { connectionId: x.connection_id as string, number: x.number as string, customerName: x.customer_name as string };
      if (x.bill_id) {
        if (!x.bill_invoice_id) held.push({ ...base, reason: 'Penagihan periode ini tertahan di tengah jalan — periksa di Penjualan › Faktur lalu hubungi Admin' });
        continue;
      }
      const metered = x.metered as boolean;
      if (metered) {
        if (!x.reading_id) { if (x.status === 'ACTIVE') held.push({ ...base, reason: 'Meter belum dicatat' }); continue; }
        if (x.reading_status === 'ENTERED') { held.push({ ...base, reason: 'Pencatatan menunggu verifikasi' }); continue; }
        if (x.reading_status !== 'VERIFIED') continue;
      } else if (x.status !== 'ACTIVE') continue;
      const tariff = { fixedFee: num(x.fixed_fee), adminFee: num(x.admin_fee), minUsage: num(x.min_usage), blocks: x.blocks as TariffBlock[] };
      const usage = metered ? num(x.usage) : null;
      const bill = computeBill(tariff, usage, x.unit as string);
      if (bill.subtotal <= 0) { held.push({ ...base, reason: 'Nilai tagihan nol — periksa tarif' }); continue; }
      const lateFees = await this.lateFeeCandidates(tenantId, base.connectionId, rules);
      ready.push({ ...base, customerId: x.customer_id as string, tariffId: x.tariff_id as string, tariffName: x.tariff_name as string, vatable: x.vatable as boolean, unit: x.unit as string, usage, readingId: (x.reading_id as string) ?? null, lines: bill.lines, subtotal: bill.subtotal, lateFees, lateFeeTotal: Math.round(lateFees.reduce((s, l) => s + l.amount, 0) * 100) / 100 });
    }
    return { period, ready, held, totals: { count: ready.length, subtotal: ready.reduce((s, r) => s + r.subtotal, 0), lateFee: ready.reduce((s, r) => s + r.lateFeeTotal, 0) } };
  }

  async preview(tenantId: string, period: string) {
    const p = await this.plan(tenantId, period);
    return { ...p, ready: p.ready.map((r) => ({ connectionId: r.connectionId, number: r.number, customerName: r.customerName, tariffName: r.tariffName, usage: r.usage, unit: r.unit, subtotal: r.subtotal, lateFee: r.lateFeeTotal, lateFeeOf: r.lateFees.map((l) => `${l.number} (${l.daysLate} hari)`) })) };
  }

  private async key(tenantId: string, systemKey: string) {
    const [a] = await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, systemKey)));
    if (!a) throw new BadRequestException(`Akun ${systemKey} belum tersedia — pastikan jenis usaha perusahaan adalah Utilitas lalu muat ulang aplikasi`);
    return a.id;
  }

  async run(u: AuthUser, dto: BillRunDto) {
    const rules = await this.rules(u.tenantId);
    const plan = await this.plan(u.tenantId, dto.period);
    const acct = {
      FIXED: await this.key(u.tenantId, SYS.UTILITY_FIXED_REVENUE),
      USAGE: await this.key(u.tenantId, SYS.UTILITY_USAGE_REVENUE),
      ADMIN: await this.key(u.tenantId, SYS.UTILITY_FIXED_REVENUE),
      LATE_FEE: await this.key(u.tenantId, SYS.UTILITY_LATE_FEE_REVENUE),
    } as const;
    const today = todayJakarta();
    const billed: { number: string; invoice: string; total: number }[] = [];
    const failed: { number: string; reason: string }[] = [];
    for (const item of plan.ready) {
      // klaim periode lebih dulu: unik per sambungan + periode, sehingga tidak mungkin tertagih dua kali meski dijalankan bersamaan
      let claimId: string;
      try {
        const [claim] = await this.db.insert(utilityBills).values({ tenantId: u.tenantId, connectionId: item.connectionId, period: dto.period, usage: item.usage === null ? null : String(item.usage), subtotal: item.subtotal.toFixed(2), lateFee: item.lateFeeTotal.toFixed(2), createdById: u.sub }).returning({ id: utilityBills.id });
        claimId = claim.id;
      } catch (e) {
        if (isUnique(e)) { failed.push({ number: item.number, reason: 'Sudah ditagih / sedang diproses' }); continue; }
        throw e;
      }
      try {
        const lineOf = (l: (typeof item.lines)[number]) => ({ description: l.description, qty: String(l.qty), unit: l.kind === 'USAGE' ? item.unit : 'Paket', price: l.price.toFixed(2), accountId: acct[l.kind] });
        const withLate = !item.vatable && item.lateFees.length > 0;
        const lines = [...item.lines.map(lineOf), ...(withLate ? item.lateFees.map((l) => ({ description: `Denda keterlambatan ${l.number}`, qty: '1', unit: 'Paket', price: l.amount.toFixed(2), accountId: acct.LATE_FEE })) : [])];
        const invoice = await this.billing.createInvoice(u, {
          customerId: item.customerId,
          date: today,
          dueDate: addDays(today, rules.dueDays),
          description: `${item.tariffName} periode ${dto.period} — sambungan ${item.number}`,
          withVat: item.vatable ? undefined : false,
          lines,
        });
        let lateInvoice: string | null = null;
        if (!withLate && item.lateFees.length) {
          const li = await this.billing.createInvoice(u, {
            customerId: item.customerId,
            date: today,
            dueDate: addDays(today, rules.dueDays),
            description: `Denda keterlambatan — sambungan ${item.number}`,
            withVat: false,
            lines: item.lateFees.map((l) => ({ description: `Denda keterlambatan ${l.number}`, qty: '1', unit: 'Paket', price: l.amount.toFixed(2), accountId: acct.LATE_FEE })),
          });
          lateInvoice = li.number;
        }
        await this.db.transaction(async (tx) => {
          await tx.update(utilityBills).set({ invoiceId: invoice.id }).where(eq(utilityBills.id, claimId));
          if (item.readingId) await tx.update(utilityReadings).set({ status: 'BILLED', billId: claimId }).where(eq(utilityReadings.id, item.readingId));
          for (const l of item.lateFees) await tx.insert(utilityLateFees).values({ tenantId: u.tenantId, invoiceId: l.invoiceId, billId: claimId, amount: l.amount.toFixed(2) }).onConflictDoNothing();
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityBill', entityId: claimId, data: { connection: item.number, period: dto.period, invoice: invoice.number, subtotal: item.subtotal, lateFee: item.lateFeeTotal, lateInvoice } });
        });
        billed.push({ number: item.number, invoice: invoice.number, total: item.subtotal + item.lateFeeTotal });
      } catch (e) {
        // faktur gagal dibuat: lepas klaim agar bisa diulang
        await this.db.delete(utilityBills).where(and(eq(utilityBills.id, claimId), sql`${utilityBills.invoiceId} IS NULL`));
        failed.push({ number: item.number, reason: e instanceof Error ? e.message : 'Gagal membuat faktur' });
      }
    }
    return { period: dto.period, billedCount: billed.length, billedTotal: billed.reduce((s, b) => s + b.total, 0), billed, failed, held: plan.held };
  }

  // ---------- tunggakan & kontrol ----------
  async overdue(tenantId: string) {
    const rules = await this.rules(tenantId);
    const today = todayJakarta();
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.status, c.address, cu.name AS "customerName", cu.phone,
             SUM(i.total - i.paid_amount) AS outstanding, MAX(${today}::date - i.due_date)::int AS "daysLate", COUNT(*)::int AS bills
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.due_date < ${today}::date AND c.status <> 'DISCONNECTED'
      GROUP BY c.id, c.number, c.status, c.address, cu.name, cu.phone ORDER BY MAX(${today}::date - i.due_date) DESC LIMIT 500`);
    return r.rows.map((x) => ({ ...x, outstanding: x.outstanding as string, suggestSuspend: x.status === 'ACTIVE' && Number(x.daysLate) > rules.suspendAfterDays }));
  }

  async controls(tenantId: string) {
    const period = todayJakarta().slice(0, 7);
    const prev2 = (() => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 3, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const q = async (query: ReturnType<typeof sql>) => (await this.db.execute<Record<string, unknown>>(query)).rows;
    const noReading = await q(sql`
      SELECT c.number, cu.name AS customer, c.address, (SELECT MAX(r.period) FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED') AS "lastPeriod"
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${prev2}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' AND r.period > ${prev2}) LIMIT 100`);
    const zero = await q(sql`
      SELECT c.number, cu.name AS customer, c.address FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND (SELECT COUNT(*) FROM (SELECT usage FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY period DESC LIMIT 3) z WHERE z.usage = 0) = 3 LIMIT 100`);
    const stale = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, (${todayJakarta()}::date - r.entered_at::date)::int AS days FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE r.tenant_id = ${tenantId} AND r.status = 'ENTERED' AND r.entered_at < now() - interval '5 days' ORDER BY r.entered_at LIMIT 100`);
    const flagged = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, r.usage, r.flags FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE r.tenant_id = ${tenantId} AND r.status = 'ENTERED' AND cardinality(r.flags) > 0 ORDER BY r.entered_at DESC LIMIT 100`);
    const dup = await q(sql`
      SELECT lower(btrim(c.address)) AS address, t.service_type AS service, COUNT(*)::int AS n, string_agg(c.number, ', ') AS numbers
      FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED'
      GROUP BY lower(btrim(c.address)), t.service_type HAVING COUNT(*) > 1 LIMIT 100`);
    const selfVerified = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, u.name AS "userName" FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id JOIN users u ON u.id = r.entered_by_id
      WHERE r.tenant_id = ${tenantId} AND r.verified_by_id = r.entered_by_id AND r.status IN ('VERIFIED','BILLED') ORDER BY r.verified_at DESC LIMIT 100`);
    return [
      { key: 'NO_READING', title: 'Sambungan aktif tanpa pencatatan 2+ bulan (pendapatan bocor?)', severity: 'high', items: noReading },
      { key: 'ZERO_USAGE', title: 'Pemakaian nol 3 bulan berturut-turut (meter macet / sambungan ilegal?)', severity: 'medium', items: zero },
      { key: 'STALE', title: 'Pencatatan menunggu verifikasi lebih dari 5 hari', severity: 'medium', items: stale },
      { key: 'FLAGGED', title: 'Angka meter janggal menunggu pemeriksaan', severity: 'medium', items: flagged },
      { key: 'DUPLICATE', title: 'Beberapa sambungan di alamat dan layanan yang sama', severity: 'medium', items: dup },
      { key: 'SELF_VERIFIED', title: 'Dicatat dan diverifikasi oleh orang yang sama (hanya Pemilik)', severity: 'high', items: selfVerified },
    ];
  }

  async summary(tenantId: string) {
    const period = todayJakarta().slice(0, 7);
    const one = async (query: ReturnType<typeof sql>) => Number((await this.db.execute<{ n: number }>(query)).rows[0]?.n ?? 0);
    const [active, suspended, awaiting, ready, missing] = await Promise.all([
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND status = 'SUSPENDED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_readings WHERE tenant_id = ${tenantId} AND status = 'ENTERED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_readings WHERE tenant_id = ${tenantId} AND status = 'VERIFIED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')`),
    ]);
    const od = await this.overdue(tenantId);
    return { period, active, suspended, awaitingVerification: awaiting, readyToBill: ready, missingReadings: missing, overdueCount: od.length, overdueTotal: od.reduce((s, x) => s + num(x.outstanding), 0), suggestSuspend: od.filter((x) => x.suggestSuspend).length };
  }
}

@ApiTags('Layanan utilitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility')
export class UtilityController {
  constructor(private readonly svc: UtilityService) {}

  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get('rules') rules(@CurrentUser() u: AuthUser) { return this.svc.rules(u.tenantId); }
  @Roles('ADMIN') @Put('rules') saveRules(@CurrentUser() u: AuthUser, @Body() dto: RulesDto) { return this.svc.saveRules(u, dto); }

  @Get('tariffs') tariffs(@CurrentUser() u: AuthUser) { return this.svc.tariffs(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('tariffs') createTariff(@CurrentUser() u: AuthUser, @Body() dto: TariffDto) { return this.svc.createTariff(u, dto); }
  @Roles('ADMIN') @Put('tariffs/:id') updateTariff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TariffDto) { return this.svc.updateTariff(u, id, dto); }

  @Get('connections') connections(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('search') search?: string) { return this.svc.connections(u.tenantId, { status, search }); }
  @Get('connections/:id') connection(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.connection(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE') @Post('connections') createConnection(@CurrentUser() u: AuthUser, @Body() dto: ConnectionDto) { return this.svc.createConnection(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('connections/:id/suspend') suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDto) { return this.svc.suspend(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('connections/:id/reconnect') reconnect(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reconnect(u, id, dto); }
  @Roles('ADMIN') @Post('connections/:id/disconnect') disconnect(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.disconnect(u, id, dto); }

  @Get('readings') readings(@CurrentUser() u: AuthUser, @Query('period') period?: string, @Query('status') status?: string, @Query('connectionId') connectionId?: string) { return this.svc.readings(u.tenantId, { period, status, connectionId }); }
  @Get('readings/due') due(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.due(u.tenantId, period); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('readings') enter(@CurrentUser() u: AuthUser, @Body() dto: ReadingDto) { return this.svc.enterReading(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('readings/:id/verify') verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) { return this.svc.verify(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('readings/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reject(u, id, dto); }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('billing/preview') preview(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.preview(u.tenantId, period); }
  @Roles('ADMIN', 'FINANCE') @Post('billing/run') run(@CurrentUser() u: AuthUser, @Body() dto: BillRunDto) { return this.svc.run(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('overdue') overdue(@CurrentUser() u: AuthUser) { return this.svc.overdue(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}

@Module({ imports: [SalesModule], controllers: [UtilityController], providers: [UtilityService], exports: [UtilityService] })
export class UtilityModule {}
