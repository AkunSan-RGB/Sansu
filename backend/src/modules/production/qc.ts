/**
 * Pengendalian mutu (QC) hasil produksi dengan karantina.
 *
 * - Rencana inspeksi per produk berisi parameter (angka dengan batas min/maks, atau lulus/gagal, boleh bertanda kritis).
 * - Produk yang ditandai "wajib QC": saat perintah produksi selesai, hasilnya masuk gudang KARANTINA (bukan gudang tujuan) dan inspeksi
 *   dibuat otomatis. Stok karantina tidak bisa dijual, dipakai produksi, atau dipindah (dijaga di inti mutasi stok); keluarnya hanya lewat QC.
 * - Hasil inspeksi dinilai SERVER dari angka yang dimasukkan (bukan centang lulus dari klien). Parameter kritis gagal → seluruh lot gagal.
 *   Lolos → dipindah ke gudang tujuan dengan harga pokok yang sama. Gagal tetap di karantina sampai dibuang (scrap) — pembuangan hanya
 *   Admin/Pemilik (orang lain dari inspektur), dijurnal sebagai selisih persediaan.
 * - Pemisahan fungsi: inspektur bukan orang yang menyelesaikan produksi (Pemilik dikecualikan).
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { todayJakarta } from '../../common/utils/dates';
import { D, qty4 } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { InventoryService } from '../inventory/inventory.service';
import { StockService } from '../inventory/stock.service';

const num = (v: unknown) => Number(v ?? 0);

export class QcParamDto {
  @ApiProperty({ example: 'Berat bersih (g)' }) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty({ enum: ['NUMERIC', 'PASSFAIL'] }) @IsIn(['NUMERIC', 'PASSFAIL']) kind: 'NUMERIC' | 'PASSFAIL';
  @ApiPropertyOptional() @IsOptional() @IsNumber() minValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ description: 'Gagal pada parameter kritis = seluruh lot gagal' }) @IsOptional() @IsBoolean() critical?: boolean;
}
export class QcPlanDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty({ type: [QcParamDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => QcParamDto) params: QcParamDto[];
  @ApiPropertyOptional({ description: 'Hasil produksi produk ini wajib QC (masuk karantina dulu)', default: true }) @IsOptional() @IsBoolean() requireOnProduction?: boolean;
}
export class ResultDto {
  @ApiProperty() @IsUUID() resultId: string;
  @ApiPropertyOptional({ description: 'Angka hasil ukur (parameter angka)' }) @IsOptional() @IsNumber() value?: number;
  @ApiPropertyOptional({ description: 'Lulus/gagal (parameter lulus-gagal)' }) @IsOptional() @IsBoolean() pass?: boolean;
}
export class DecideDto {
  @ApiProperty({ type: [ResultDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ResultDto) results: ResultDto[];
  @ApiPropertyOptional({ description: 'Jumlah yang dinyatakan lolos; kosong = seluruhnya bila semua parameter lolos, 0 bila ada yang gagal' }) @IsOptional() @IsNumber() @Min(0) qtyPass?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ScrapDto {
  @ApiProperty() @IsNumber() @Min(0.0001) qty: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class InspectionsQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'PASSED', 'FAILED', 'PARTIAL']) status?: string;
}

type Insp = { id: string; number: string; order_id: string | null; product_id: string; warehouse_id: string; release_warehouse_id: string; qty: string; unit_cost: string; status: string; qty_pass: string | null; qty_fail: string | null; qty_scrapped: string; completed_by_id: string | null; inspector_id: string | null };

@Injectable()
export class QcService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- gudang karantina & rencana ----------
  async quarantineWarehouse(db: Db | Tx, tenantId: string) {
    return (await db.execute<{ id: string }>(sql`SELECT id FROM warehouses WHERE tenant_id = ${tenantId} AND is_quarantine AND is_active`)).rows[0]?.id ?? null;
  }

  /** Siapkan gudang karantina (sekali) */
  async setup(u: AuthUser) {
    const existing = await this.quarantineWarehouse(this.db, u.tenantId);
    if (existing) return { id: existing, created: false };
    const code = 'KARANTINA';
    const r = await this.db.execute<{ id: string }>(sql`INSERT INTO warehouses (tenant_id, code, name, is_quarantine) VALUES (${u.tenantId}, ${code}, 'Gudang Karantina (QC)', true) ON CONFLICT DO NOTHING RETURNING id`);
    if (!r.rows.length) throw new BadRequestException(`Kode gudang ${code} sudah dipakai oleh gudang lain; ubah kodenya lebih dulu`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'QcSetup', entityId: r.rows[0].id, data: { code } });
    return { id: r.rows[0].id, created: true };
  }

  plans(tenantId: string) {
    return this.db.execute(sql`
      SELECT p.id, p.product_id AS "productId", pr.sku, pr.name AS "productName", p.name, p.is_active AS "isActive", pr.qc_required AS "qcRequired",
             COALESCE((SELECT json_agg(json_build_object('id', q.id, 'name', q.name, 'kind', q.kind, 'minValue', q.min_value, 'maxValue', q.max_value, 'unit', q.unit, 'critical', q.critical) ORDER BY q.sequence) FROM qc_plan_params q WHERE q.plan_id = p.id), '[]'::json) AS params
      FROM qc_plans p JOIN products pr ON pr.id = p.product_id WHERE p.tenant_id = ${tenantId} ORDER BY pr.name`).then((r) => r.rows);
  }

  async savePlan(u: AuthUser, productId: string, dto: QcPlanDto) {
    for (const [i, p] of dto.params.entries()) {
      if (p.kind === 'NUMERIC') {
        if (p.minValue == null && p.maxValue == null) throw new BadRequestException(`Parameter ${i + 1} (${p.name}): isi batas minimum dan/atau maksimum`);
        if (p.minValue != null && p.maxValue != null && p.minValue > p.maxValue) throw new BadRequestException(`Parameter ${i + 1} (${p.name}): minimum lebih besar dari maksimum`);
      }
    }
    await this.db.transaction(async (tx) => {
      const pr = await tx.execute(sql`SELECT 1 FROM products WHERE id = ${productId} AND tenant_id = ${u.tenantId}`);
      if (!pr.rows.length) throw new NotFoundException('Produk tidak ditemukan');
      const plan = (await tx.execute<{ id: string }>(sql`INSERT INTO qc_plans (tenant_id, product_id, name) VALUES (${u.tenantId}, ${productId}, ${dto.name.trim()}) ON CONFLICT (tenant_id, product_id) DO UPDATE SET name = EXCLUDED.name, is_active = true RETURNING id`)).rows[0];
      await tx.execute(sql`DELETE FROM qc_plan_params WHERE plan_id = ${plan.id}`);
      for (const [i, p] of dto.params.entries()) {
        await tx.execute(sql`INSERT INTO qc_plan_params (tenant_id, plan_id, sequence, name, kind, min_value, max_value, unit, critical) VALUES (${u.tenantId}, ${plan.id}, ${i + 1}, ${p.name.trim()}, ${p.kind}, ${p.kind === 'NUMERIC' ? p.minValue ?? null : null}, ${p.kind === 'NUMERIC' ? p.maxValue ?? null : null}, ${p.unit ?? null}, ${p.critical ?? false})`);
      }
      const require = dto.requireOnProduction ?? true;
      if (require && !(await this.quarantineWarehouse(tx, u.tenantId))) throw new BadRequestException('Siapkan gudang karantina dulu (Pengendalian mutu › Siapkan karantina)');
      await tx.execute(sql`UPDATE products SET qc_required = ${require} WHERE id = ${productId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'QcPlan', entityId: plan.id, data: { productId, params: dto.params.length, required: require } });
    });
    return this.plans(u.tenantId);
  }

  // ---------- inspeksi ----------
  /** Dipanggil dari penyelesaian produksi (dalam transaksinya): buat inspeksi PENDING beserta baris hasil dari rencana */
  async createForOrderTx(tx: Tx, u: AuthUser, p: { orderId: string; productId: string; warehouseId: string; releaseWarehouseId: string; qty: string; unitCost: string }) {
    const plan = (await tx.execute<{ id: string }>(sql`SELECT id FROM qc_plans WHERE tenant_id = ${u.tenantId} AND product_id = ${p.productId} AND is_active`)).rows[0];
    const number = await this.seq.next(tx, u.tenantId, 'QC_INSPECTION', todayJakarta());
    const id = (await tx.execute<{ id: string }>(sql`INSERT INTO qc_inspections (tenant_id, number, order_id, product_id, plan_id, warehouse_id, release_warehouse_id, qty, unit_cost, completed_by_id) VALUES (${u.tenantId}, ${number}, ${p.orderId}, ${p.productId}, ${plan?.id ?? null}, ${p.warehouseId}, ${p.releaseWarehouseId}, ${p.qty}, ${p.unitCost}, ${u.sub}) RETURNING id`)).rows[0].id;
    if (plan) await tx.execute(sql`INSERT INTO qc_inspection_results (tenant_id, inspection_id, sequence, name, kind, min_value, max_value, unit, critical) SELECT tenant_id, ${id}::uuid, sequence, name, kind, min_value, max_value, unit, critical FROM qc_plan_params WHERE plan_id = ${plan.id}`);
    await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'QcInspection', entityId: id, data: { number, qty: p.qty } });
    return { id, number };
  }

  list(tenantId: string, q: InspectionsQuery) {
    return this.db.execute(sql`
      SELECT i.id, i.number, i.status, i.qty, i.qty_pass AS "qtyPass", i.qty_fail AS "qtyFail", i.qty_scrapped AS "qtyScrapped", i.unit_cost AS "unitCost", i.created_at AS "createdAt", i.decided_at AS "decidedAt", i.note,
             pr.sku, pr.name AS "productName", o.number AS "orderNumber", w.name AS "warehouseName", rw.name AS "releaseWarehouseName"
      FROM qc_inspections i JOIN products pr ON pr.id = i.product_id LEFT JOIN production_orders o ON o.id = i.order_id JOIN warehouses w ON w.id = i.warehouse_id JOIN warehouses rw ON rw.id = i.release_warehouse_id
      WHERE i.tenant_id = ${tenantId} ${q.status ? sql`AND i.status = ${q.status}` : sql``} ORDER BY (i.status = 'PENDING') DESC, i.created_at DESC LIMIT 300`).then((r) => r.rows);
  }

  async get(tenantId: string, id: string) {
    const head = (await this.list(tenantId, {})).find((x) => (x as { id: string }).id === id);
    if (!head) throw new NotFoundException('Inspeksi tidak ditemukan');
    const results = (await this.db.execute(sql`SELECT id, sequence, name, kind, min_value AS "minValue", max_value AS "maxValue", unit, critical, value, passed FROM qc_inspection_results WHERE inspection_id = ${id} AND tenant_id = ${tenantId} ORDER BY sequence`)).rows;
    return { ...head, results };
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const r = await tx.execute<Insp>(sql`SELECT * FROM qc_inspections WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new NotFoundException('Inspeksi tidak ditemukan');
    return r.rows[0];
  }

  /** Nilai satu parameter oleh server: angka dibandingkan batas; lulus/gagal menurut isian */
  private judge(r: { kind: string; min_value: string | null; max_value: string | null }, v: { value?: number; pass?: boolean }) {
    if (r.kind === 'NUMERIC') {
      if (v.value == null) throw new BadRequestException('Parameter angka wajib diisi nilai ukurnya');
      const x = v.value;
      return (r.min_value == null || x >= num(r.min_value)) && (r.max_value == null || x <= num(r.max_value));
    }
    if (v.pass == null) throw new BadRequestException('Parameter lulus/gagal wajib dipilih');
    return v.pass;
  }

  async decide(u: AuthUser, id: string, dto: DecideDto) {
    await this.db.transaction(async (tx) => {
      const i = await this.lock(tx, u.tenantId, id);
      if (i.status !== 'PENDING') throw new BadRequestException('Inspeksi ini sudah diputuskan');
      if (u.role !== 'OWNER' && i.completed_by_id === u.sub) throw new ForbiddenException('Inspeksi harus dilakukan orang lain dari yang menyelesaikan produksinya (pemisahan fungsi)');
      const rows = (await tx.execute<{ id: string; name: string; kind: string; min_value: string | null; max_value: string | null; critical: boolean }>(sql`SELECT id, name, kind, min_value, max_value, critical FROM qc_inspection_results WHERE inspection_id = ${id} ORDER BY sequence`)).rows;
      const given = new Map(dto.results.map((r) => [r.resultId, r]));
      if (given.size !== dto.results.length) throw new BadRequestException('Parameter yang sama diisi dua kali');
      let anyFail = false;
      let criticalFail = false;
      for (const r of rows) {
        const v = given.get(r.id);
        if (!v) throw new BadRequestException(`Parameter "${r.name}" belum diisi`);
        const ok = this.judge(r, v);
        if (!ok) { anyFail = true; if (r.critical) criticalFail = true; }
        await tx.execute(sql`UPDATE qc_inspection_results SET value = ${v.value ?? null}, passed = ${ok} WHERE id = ${r.id}`);
      }
      for (const k of given.keys()) if (!rows.some((r) => r.id === k)) throw new BadRequestException('Ada parameter yang bukan bagian inspeksi ini');
      const total = D(i.qty);
      const qtyPass = qty4(dto.qtyPass ?? (anyFail ? 0 : total.toNumber()));
      if (qtyPass.gt(total)) throw new BadRequestException('Jumlah lolos melebihi jumlah yang diinspeksi');
      if (criticalFail && qtyPass.gt(0)) throw new BadRequestException('Parameter kritis gagal: seluruh lot harus gagal');
      if (anyFail && qtyPass.gte(total)) throw new BadRequestException('Ada parameter yang gagal: seluruh lot tidak boleh dinyatakan lolos');
      if (!qtyPass.eq(total) && (dto.note ?? '').trim().length < 5) throw new BadRequestException('Lot yang tidak lolos seluruhnya wajib disertai catatan (min. 5 huruf)');
      const qtyFail = total.minus(qtyPass);
      if (qtyPass.gt(0)) {
        // dipindah ke gudang tujuan dengan harga pokok yang sama
        const out = await this.stock.move(tx, { tenantId: u.tenantId, productId: i.product_id, warehouseId: i.warehouse_id, type: 'TRANSFER_OUT', qty: qtyPass.negated(), refType: 'QC_INSPECTION', refId: i.id, refNumber: i.number, date: todayJakarta(), skipAccessCheck: true, fromQc: true });
        await this.stock.move(tx, { tenantId: u.tenantId, productId: i.product_id, warehouseId: i.release_warehouse_id, type: 'TRANSFER_IN', qty: qtyPass, unitCost: out.unitCost, writedownUnit: out.writedownUnit, refType: 'QC_INSPECTION', refId: i.id, refNumber: i.number, date: todayJakarta(), skipAccessCheck: true });
      }
      const status = qtyFail.isZero() ? 'PASSED' : qtyPass.isZero() ? 'FAILED' : 'PARTIAL';
      await tx.execute(sql`UPDATE qc_inspections SET status = ${status}, qty_pass = ${qtyPass.toFixed(4)}, qty_fail = ${qtyFail.toFixed(4)}, inspector_id = ${u.sub}, decided_at = now(), note = ${dto.note ?? null} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: status === 'PASSED' ? 'APPROVE' : 'REJECT', entity: 'QcInspection', entityId: id, data: { number: i.number, status, qtyPass: qtyPass.toString(), qtyFail: qtyFail.toString(), criticalFail, note: dto.note } });
    });
    return this.get(u.tenantId, id);
  }

  /** Buang (scrap) lot gagal yang masih di karantina: Admin/Pemilik, orang lain dari inspektur, alasan wajib; dijurnal sebagai selisih persediaan */
  async scrap(u: AuthUser, id: string, dto: ScrapDto) {
    await this.db.transaction(async (tx) => {
      const i = await this.lock(tx, u.tenantId, id);
      if (!['FAILED', 'PARTIAL'].includes(i.status)) throw new BadRequestException('Hanya lot yang gagal inspeksi yang dapat dibuang');
      if (u.role !== 'OWNER' && i.inspector_id === u.sub) throw new ForbiddenException('Pembuangan harus dilakukan orang lain dari inspektur (pemisahan fungsi)');
      const remaining = D(i.qty_fail ?? 0).minus(i.qty_scrapped);
      const q = qty4(dto.qty);
      if (q.gt(remaining)) throw new BadRequestException(`Sisa lot gagal di karantina hanya ${remaining.toFixed(4)}`);
      const r = await this.inventory.adjust(u, { warehouseId: i.warehouse_id, date: todayJakarta(), reason: 'DAMAGED', notes: `Scrap QC ${i.number}: ${dto.reason}`, lines: [{ productId: i.product_id, qty: q.negated().toFixed(4) }] }, tx, { qc: true });
      await tx.execute(sql`UPDATE qc_inspections SET qty_scrapped = qty_scrapped + ${q.toFixed(4)} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'QcInspection', entityId: id, data: { number: i.number, scrapped: q.toString(), reason: dto.reason, adjustment: r.number, value: r.valueOut } });
    });
    return this.get(u.tenantId, id);
  }

  async controls(tenantId: string) {
    const q = async (t: ReturnType<typeof sql>) => (await this.db.execute(t)).rows;
    const pendingOld = await q(sql`SELECT i.number, pr.name AS product, i.qty, i.created_at AS "createdAt" FROM qc_inspections i JOIN products pr ON pr.id = i.product_id WHERE i.tenant_id = ${tenantId} AND i.status = 'PENDING' AND i.created_at < now() - interval '1 day' ORDER BY i.created_at LIMIT 50`);
    const held = await q(sql`SELECT i.number, pr.name AS product, (i.qty_fail - i.qty_scrapped) AS qty, ROUND((i.qty_fail - i.qty_scrapped) * i.unit_cost, 2) AS value, i.decided_at AS "decidedAt" FROM qc_inspections i JOIN products pr ON pr.id = i.product_id WHERE i.tenant_id = ${tenantId} AND i.status IN ('FAILED', 'PARTIAL') AND i.qty_fail > i.qty_scrapped ORDER BY i.decided_at LIMIT 50`);
    const failRate = await q(sql`SELECT pr.name AS product, COUNT(*)::int AS inspections, SUM(i.qty) AS qty, SUM(i.qty_fail) AS failed, ROUND(SUM(i.qty_fail) / NULLIF(SUM(i.qty), 0) * 100, 1) AS "failPct" FROM qc_inspections i JOIN products pr ON pr.id = i.product_id WHERE i.tenant_id = ${tenantId} AND i.status <> 'PENDING' AND i.decided_at > now() - interval '90 days' GROUP BY pr.name HAVING SUM(i.qty_fail) > 0 ORDER BY 5 DESC LIMIT 20`);
    const inspectorPass = await q(sql`SELECT u.name AS inspector, COUNT(*)::int AS inspections, ROUND(AVG(CASE WHEN i.status = 'PASSED' THEN 100 ELSE 0 END), 0) AS "passPct" FROM qc_inspections i JOIN users u ON u.id = i.inspector_id WHERE i.tenant_id = ${tenantId} AND i.status <> 'PENDING' AND i.decided_at > now() - interval '90 days' GROUP BY u.name HAVING COUNT(*) >= 5 ORDER BY 3 DESC LIMIT 20`);
    const noPlan = await q(sql`SELECT i.number, pr.name AS product FROM qc_inspections i JOIN products pr ON pr.id = i.product_id WHERE i.tenant_id = ${tenantId} AND i.plan_id IS NULL AND i.status = 'PENDING' LIMIT 20`);
    return { pendingOverOneDay: pendingOld, failedHeldInQuarantine: held, failRateByProduct: failRate, passRateByInspector: inspectorPass, inspectionsWithoutPlan: noPlan };
  }
}

@ApiTags('Pengendalian mutu')
@ApiBearerAuth()
@RequireApp('inventory')
@Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
@Controller('qc')
export class QcController {
  constructor(private readonly svc: QcService) {}

  @Roles('ADMIN') @Post('setup') setup(@CurrentUser() u: AuthUser) { return this.svc.setup(u); }
  @Get('plans') plans(@CurrentUser() u: AuthUser) { return this.svc.plans(u.tenantId); }
  @Roles('ADMIN') @Put('plans/:productId') savePlan(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: QcPlanDto) { return this.svc.savePlan(u, productId, dto); }
  @Get('inspections') list(@CurrentUser() u: AuthUser, @Query() q: InspectionsQuery) { return this.svc.list(u.tenantId, q); }
  @Get('inspections/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('inspections/:id/decide') decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) { return this.svc.decide(u, id, dto); }
  @Roles('ADMIN') @Post('inspections/:id/scrap') scrap(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScrapDto) { return this.svc.scrap(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}
