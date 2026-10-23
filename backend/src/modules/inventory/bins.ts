/**
 * Lokasi rak gudang (tahap 1): master rak, aktivasi per gudang, stok per rak, pindah antar rak, riwayat, dan pemeriksaan konsistensi.
 * Rak hanya mencatat LOKASI; kuantitas gudang, HPP, dan jurnal tidak berubah (lihat bin-tracker.ts untuk hook mutasi stok).
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { D, qty4 } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { addToBin, BIN_KINDS, logBinMove, UNASSIGNED_CODE } from './bin-tracker';

const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const CREATABLE_KINDS = ['STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE'] as const;
const MAX_BATCH = 200;
const MAX_ROWS = 500;

export class BinWarehouseDto {
  @ApiProperty() @IsUUID() warehouseId: string;
}

export class CreateBinsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ example: ['A-01-01', 'A-01-02'], description: 'Kode rak; huruf besar, angka, titik, garis, garis miring (maks 30 karakter)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BATCH) @IsString({ each: true }) codes: string[];
  @ApiPropertyOptional({ enum: CREATABLE_KINDS }) @IsOptional() @IsIn(CREATABLE_KINDS as unknown as string[]) kind?: (typeof CREATABLE_KINDS)[number];
  @ApiPropertyOptional({ example: 'A' }) @IsOptional() @IsString() @MaxLength(30) zone?: string;
}

export class UpdateBinDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BinMoveLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ description: 'Kosong = bagian stok yang tidak bernomor lot' }) @IsOptional() @IsUUID() lotId?: string;
  @ApiProperty() @IsUUID() fromBinId: string;
  @ApiProperty() @IsUUID() toBinId: string;
  @ApiProperty({ example: '12' }) @Matches(/^\d+(\.\d{1,4})?$/, { message: 'Jumlah tidak valid' }) qty: string;
}

export class MoveBinsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [BinMoveLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BinMoveLineDto) lines: BinMoveLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class BinStockQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() binId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ description: 'Cari kode barang / nama / barcode' }) @IsOptional() @IsString() @MaxLength(60) q?: string;
}

@Injectable()
export class BinsService {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService) {}

  private async warehouse(db: Db | Tx, tenantId: string, id: string, lock = false) {
    const r = await db.execute<{ id: string; code: string; name: string; kind: string; is_quarantine: boolean; is_active: boolean; bins_enabled: boolean }>(
      lock
        ? sql`SELECT id, code, name, kind, is_quarantine, is_active, bins_enabled FROM warehouses WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
        : sql`SELECT id, code, name, kind, is_quarantine, is_active, bins_enabled FROM warehouses WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    if (!r.rows[0]) throw new BadRequestException('Gudang tidak ditemukan');
    return r.rows[0];
  }

  private async bin(db: Db | Tx, tenantId: string, id: string) {
    const r = await db.execute<{ id: string; warehouse_id: string; code: string; kind: string; is_active: boolean }>(sql`SELECT id, warehouse_id, code, kind, is_active FROM warehouse_bins WHERE id = ${id} AND tenant_id = ${tenantId}`);
    if (!r.rows[0]) throw new NotFoundException('Rak tidak ditemukan');
    return r.rows[0];
  }

  /** Daftar gudang beserta status rak (untuk pilihan di layar) */
  async warehouses(u: AuthUser) {
    const allowed = allowedWarehouses(u);
    const r = await this.db.execute(sql`
      SELECT w.id, w.code, w.name, w.bins_enabled AS "binsEnabled", w.kind, w.is_quarantine AS "isQuarantine",
             (SELECT COUNT(*)::int FROM warehouse_bins b WHERE b.warehouse_id = w.id AND b.kind <> 'UNASSIGNED' AND b.is_active) AS "binCount"
      FROM warehouses w WHERE w.tenant_id = ${u.tenantId} AND w.is_active
        ${allowed ? sql`AND w.id IN (${sql.join(allowed.map((a) => sql`${a}::uuid`), sql`, `)})` : sql``}
      ORDER BY w.code`);
    return r.rows;
  }

  async list(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    const w = await this.warehouse(this.db, u.tenantId, warehouseId);
    const bins = await this.db.execute(sql`
      SELECT b.id, b.code, b.zone, b.name, b.kind, b.is_active AS "isActive",
             COALESCE(SUM(s.qty), 0) AS qty, COUNT(DISTINCT s.product_id)::int AS products
      FROM warehouse_bins b LEFT JOIN stock_bin_balances s ON s.bin_id = b.id
      WHERE b.tenant_id = ${u.tenantId} AND b.warehouse_id = ${warehouseId}
      GROUP BY b.id ORDER BY (b.kind = 'UNASSIGNED') DESC, b.zone NULLS LAST, b.code`);
    return { warehouse: { id: w.id, code: w.code, name: w.name, binsEnabled: w.bins_enabled }, bins: bins.rows };
  }

  async activate(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    await this.db.transaction(async (tx) => {
      const w = await this.warehouse(tx, u.tenantId, warehouseId, true);
      if (w.bins_enabled) throw new BadRequestException(`Lokasi rak gudang ${w.name} sudah aktif`);
      if (w.kind !== 'MAIN') throw new BadRequestException('Lokasi rak hanya untuk gudang biasa (bukan titipan outlet atau mobil sales)');
      if (w.is_quarantine) throw new BadRequestException('Gudang karantina QC tidak memakai lokasi rak');
      if (!w.is_active) throw new BadRequestException('Gudang nonaktif');
      let uid = (await tx.execute<{ id: string }>(sql`SELECT id FROM warehouse_bins WHERE warehouse_id = ${warehouseId} AND kind = 'UNASSIGNED'`)).rows[0]?.id;
      if (!uid) {
        uid = (await tx.execute<{ id: string }>(sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, name, kind, created_by_id) VALUES (${u.tenantId}, ${warehouseId}, ${UNASSIGNED_CODE}, 'Belum ditempatkan', 'UNASSIGNED', ${u.sub}) RETURNING id`)).rows[0].id;
      }
      // bekukan saldo gudang selama penyalinan awal
      await tx.execute(sql`SELECT 1 FROM stock_balances WHERE warehouse_id = ${warehouseId} AND qty > 0 FOR UPDATE`);
      // 1) lot (FEFO), dibatasi sampai saldo barangnya
      await tx.execute(sql`
        WITH l AS (
          SELECT sl.id, sl.product_id, sl.qty_remaining, sb.qty AS bal,
                 SUM(sl.qty_remaining) OVER (PARTITION BY sl.product_id ORDER BY sl.expiry_date NULLS LAST, sl.received_date, sl.id) AS run
          FROM stock_lots sl JOIN stock_balances sb ON sb.product_id = sl.product_id AND sb.warehouse_id = sl.warehouse_id
          WHERE sl.warehouse_id = ${warehouseId} AND sl.qty_remaining > 0 AND sb.qty > 0)
        INSERT INTO stock_bin_balances (tenant_id, warehouse_id, bin_id, product_id, lot_id, qty)
        SELECT ${u.tenantId}, ${warehouseId}, ${uid}, product_id, id, LEAST(qty_remaining, bal - (run - qty_remaining))
        FROM l WHERE bal - (run - qty_remaining) > 0`);
      // 2) sisa stok yang tidak bernomor lot
      await tx.execute(sql`
        INSERT INTO stock_bin_balances (tenant_id, warehouse_id, bin_id, product_id, lot_id, qty)
        SELECT ${u.tenantId}, ${warehouseId}, ${uid}, sb.product_id, NULL,
               sb.qty - COALESCE((SELECT SUM(x.qty) FROM stock_bin_balances x WHERE x.warehouse_id = ${warehouseId} AND x.product_id = sb.product_id), 0)
        FROM stock_balances sb
        WHERE sb.warehouse_id = ${warehouseId} AND sb.qty > 0
          AND sb.qty - COALESCE((SELECT SUM(x.qty) FROM stock_bin_balances x WHERE x.warehouse_id = ${warehouseId} AND x.product_id = sb.product_id), 0) > 0`);
      await tx.execute(sql`
        INSERT INTO bin_moves (tenant_id, warehouse_id, product_id, lot_id, from_bin_id, to_bin_id, qty, kind, note, created_by_id)
        SELECT ${u.tenantId}, ${warehouseId}, product_id, lot_id, NULL, ${uid}, qty, 'SEED', 'Stok awal saat lokasi rak diaktifkan', ${u.sub}
        FROM stock_bin_balances WHERE bin_id = ${uid}`);
      await tx.execute(sql`UPDATE warehouses SET bins_enabled = true WHERE id = ${warehouseId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WarehouseBins', entityId: warehouseId, data: { warehouse: w.name, binsEnabled: true } });
    });
    return this.list(u, warehouseId);
  }

  async deactivate(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    await this.db.transaction(async (tx) => {
      const w = await this.warehouse(tx, u.tenantId, warehouseId, true);
      if (!w.bins_enabled) throw new BadRequestException('Lokasi rak gudang ini belum aktif');
      const used = await tx.execute<{ code: string }>(sql`
        SELECT b.code FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
        WHERE s.warehouse_id = ${warehouseId} AND b.kind <> 'UNASSIGNED' AND s.qty > 0 GROUP BY b.code ORDER BY b.code LIMIT 3`);
      if (used.rows.length) throw new BadRequestException(`Masih ada stok di rak ${used.rows.map((r) => r.code).join(', ')}. Pindahkan semuanya ke ${UNASSIGNED_CODE} dulu.`);
      await tx.execute(sql`DELETE FROM stock_bin_balances WHERE warehouse_id = ${warehouseId}`);
      await tx.execute(sql`UPDATE warehouses SET bins_enabled = false WHERE id = ${warehouseId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WarehouseBins', entityId: warehouseId, data: { warehouse: w.name, binsEnabled: false } });
    });
    return { ok: true };
  }

  async createBins(u: AuthUser, dto: CreateBinsDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    const codes = dto.codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) throw new BadRequestException('Kode rak kosong');
    const bad = codes.find((c) => !CODE_RE.test(c));
    if (bad) throw new BadRequestException(`Kode rak "${bad}" tidak valid: pakai huruf besar, angka, titik, garis, atau garis miring (maks 30 karakter)`);
    if (codes.includes(UNASSIGNED_CODE)) throw new BadRequestException(`Kode ${UNASSIGNED_CODE} dipakai rak sistem`);
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) throw new BadRequestException(`Kode rak ${dup} muncul dua kali dalam daftar`);
    await this.db.transaction(async (tx) => {
      const w = await this.warehouse(tx, u.tenantId, dto.warehouseId, true);
      if (!w.bins_enabled) throw new BadRequestException('Aktifkan lokasi rak gudang ini dulu');
      const exist = await tx.execute<{ code: string }>(sql`SELECT code FROM warehouse_bins WHERE warehouse_id = ${dto.warehouseId} AND code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`);
      if (exist.rows.length) throw new BadRequestException(`Kode rak sudah ada: ${exist.rows.slice(0, 5).map((r) => r.code).join(', ')}`);
      for (const code of codes) {
        await tx.execute(sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, zone, kind, created_by_id) VALUES (${u.tenantId}, ${dto.warehouseId}, ${code}, ${dto.zone?.trim() || null}, ${dto.kind ?? 'STORAGE'}, ${u.sub})`);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WarehouseBin', entityId: dto.warehouseId, data: { warehouse: w.name, count: codes.length, kind: dto.kind ?? 'STORAGE', first: codes[0], last: codes[codes.length - 1] } });
    });
    return this.list(u, dto.warehouseId);
  }

  async updateBin(u: AuthUser, id: string, dto: UpdateBinDto) {
    const b = await this.bin(this.db, u.tenantId, id);
    assertWarehouseAccess(u, b.warehouse_id);
    if (b.kind === 'UNASSIGNED') throw new BadRequestException('Rak sistem tidak dapat diubah');
    await this.db.transaction(async (tx) => {
      if (dto.isActive === false && b.is_active) {
        const left = await tx.execute(sql`SELECT 1 FROM stock_bin_balances WHERE bin_id = ${id} AND qty > 0 LIMIT 1`);
        if (left.rows.length) throw new BadRequestException(`Rak ${b.code} masih berisi stok; pindahkan dulu sebelum dinonaktifkan`);
      }
      await tx.execute(sql`
        UPDATE warehouse_bins SET name = ${dto.name === undefined ? sql`name` : dto.name.trim() || null}, zone = ${dto.zone === undefined ? sql`zone` : dto.zone.trim() || null}, is_active = ${dto.isActive ?? b.is_active}
        WHERE id = ${id} AND tenant_id = ${u.tenantId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WarehouseBin', entityId: id, data: { code: b.code, ...dto } });
    });
    return this.list(u, b.warehouse_id);
  }

  /** Stok per rak (juga untuk "barang ini ada di rak mana"): satu baris per rak × barang × lot */
  async stock(u: AuthUser, q: BinStockQuery) {
    if (q.warehouseId) assertWarehouseAccess(u, q.warehouseId);
    const allowed = allowedWarehouses(u);
    const term = q.q?.trim();
    const rows = await this.db.execute(sql`
      SELECT s.bin_id AS "binId", b.code AS "binCode", b.zone, b.kind AS "binKind", s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
             s.product_id AS "productId", p.sku, p.name, p.base_uom AS uom, s.lot_id AS "lotId", l.lot_no AS "lotNo", l.expiry_date AS "expiryDate", s.qty
      FROM stock_bin_balances s
      JOIN warehouse_bins b ON b.id = s.bin_id
      JOIN warehouses w ON w.id = s.warehouse_id
      JOIN products p ON p.id = s.product_id
      LEFT JOIN stock_lots l ON l.id = s.lot_id
      WHERE s.tenant_id = ${u.tenantId} AND s.qty > 0
        ${q.warehouseId ? sql`AND s.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND s.warehouse_id IN (${sql.join(allowed.map((a) => sql`${a}::uuid`), sql`, `)})` : sql``}
        ${q.binId ? sql`AND s.bin_id = ${q.binId}` : sql``}
        ${q.productId ? sql`AND s.product_id = ${q.productId}` : sql``}
        ${term ? sql`AND (p.sku ILIKE ${'%' + term.replace(/[%_\\]/g, '\\$&') + '%'} OR p.name ILIKE ${'%' + term.replace(/[%_\\]/g, '\\$&') + '%'} OR p.barcode = ${term})` : sql``}
      ORDER BY w.code, (b.kind = 'UNASSIGNED') DESC, b.code, p.sku, l.expiry_date NULLS LAST
      LIMIT ${MAX_ROWS}`);
    return { rows: rows.rows, truncated: rows.rows.length >= MAX_ROWS };
  }

  async history(u: AuthUser, q: BinStockQuery) {
    if (q.warehouseId) assertWarehouseAccess(u, q.warehouseId);
    const allowed = allowedWarehouses(u);
    const r = await this.db.execute(sql`
      SELECT m.id, m.created_at AS "createdAt", m.kind, m.qty, p.sku, p.name, l.lot_no AS "lotNo", fb.code AS "fromCode", tb.code AS "toCode",
             m.ref_type AS "refType", m.note, usr.name AS "by"
      FROM bin_moves m
      JOIN products p ON p.id = m.product_id
      LEFT JOIN stock_lots l ON l.id = m.lot_id
      LEFT JOIN warehouse_bins fb ON fb.id = m.from_bin_id
      LEFT JOIN warehouse_bins tb ON tb.id = m.to_bin_id
      LEFT JOIN users usr ON usr.id = m.created_by_id
      WHERE m.tenant_id = ${u.tenantId}
        ${q.warehouseId ? sql`AND m.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND m.warehouse_id IN (${sql.join(allowed.map((a) => sql`${a}::uuid`), sql`, `)})` : sql``}
        ${q.binId ? sql`AND (m.from_bin_id = ${q.binId} OR m.to_bin_id = ${q.binId})` : sql``}
        ${q.productId ? sql`AND m.product_id = ${q.productId}` : sql``}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 200`);
    return r.rows;
  }

  /** Pindah stok antar rak dalam satu gudang. Kuantitas gudang, HPP, dan jurnal tidak berubah. */
  async move(u: AuthUser, dto: MoveBinsDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    const lines = [...dto.lines].sort((a, b) => a.productId.localeCompare(b.productId));
    await this.db.transaction(async (tx) => {
      const w = await this.warehouse(tx, u.tenantId, dto.warehouseId);
      if (!w.bins_enabled) throw new BadRequestException('Lokasi rak gudang ini belum aktif');
      const bins = new Map<string, { id: string; code: string; kind: string; is_active: boolean }>();
      const getBin = async (id: string) => {
        if (bins.has(id)) return bins.get(id)!;
        const r = await tx.execute<{ id: string; code: string; kind: string; is_active: boolean }>(sql`SELECT id, code, kind, is_active FROM warehouse_bins WHERE id = ${id} AND warehouse_id = ${dto.warehouseId} AND tenant_id = ${u.tenantId}`);
        if (!r.rows[0]) throw new BadRequestException('Rak tidak ditemukan di gudang ini');
        bins.set(id, r.rows[0]);
        return r.rows[0];
      };
      const locked = new Set<string>();
      for (const ln of lines) {
        const qty = qty4(ln.qty);
        if (!qty.gt(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
        if (ln.fromBinId === ln.toBinId) throw new BadRequestException('Rak asal dan rak tujuan sama');
        const from = await getBin(ln.fromBinId);
        const to = await getBin(ln.toBinId);
        if (!to.is_active) throw new BadRequestException(`Rak tujuan ${to.code} nonaktif`);
        // stok di rak rusak/karantina hanya boleh dikeluarkan Pemilik/Admin
        if ((from.kind === 'DAMAGED' || from.kind === 'QUARANTINE') && u.role !== 'OWNER' && u.role !== 'ADMIN') {
          throw new ForbiddenException(`Memindahkan stok dari rak ${from.code} (${from.kind === 'DAMAGED' ? 'rusak' : 'karantina'}) hanya boleh dilakukan Pemilik atau Admin`);
        }
        // kunci yang sama dengan mutasi stok (produk × gudang) agar tidak berebut dengan penjualan/penerimaan
        if (!locked.has(ln.productId)) {
          await tx.execute(sql`SELECT 1 FROM stock_balances WHERE product_id = ${ln.productId} AND warehouse_id = ${dto.warehouseId} FOR UPDATE`);
          locked.add(ln.productId);
        }
        const src = (await tx.execute<{ id: string; qty: string }>(sql`
          SELECT id, qty FROM stock_bin_balances
          WHERE bin_id = ${ln.fromBinId} AND product_id = ${ln.productId} AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(${ln.lotId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          FOR UPDATE`)).rows[0];
        const have = D(src?.qty ?? 0);
        if (!src || have.lt(qty)) {
          const [p] = (await tx.execute<{ sku: string }>(sql`SELECT sku FROM products WHERE id = ${ln.productId} AND tenant_id = ${u.tenantId}`)).rows;
          throw new BadRequestException(`Stok ${p?.sku ?? 'barang'} di rak ${from.code} tidak cukup: tersedia ${have.toString()}, dipindah ${qty.toString()}`);
        }
        await tx.execute(sql`UPDATE stock_bin_balances SET qty = ${have.minus(qty).toFixed(4)} WHERE id = ${src.id}`);
        await tx.execute(sql`DELETE FROM stock_bin_balances WHERE id = ${src.id} AND qty = 0`);
        await addToBin(tx, { tenantId: u.tenantId, warehouseId: dto.warehouseId, productId: ln.productId, binId: ln.toBinId, lotId: ln.lotId ?? null, qty });
        await logBinMove(tx, { tenantId: u.tenantId, warehouseId: dto.warehouseId, productId: ln.productId, lotId: ln.lotId ?? null, fromBinId: ln.fromBinId, toBinId: ln.toBinId, qty, kind: 'MOVE', refType: 'BIN_MOVE', note: dto.note?.trim() || null });
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WarehouseBinMove', entityId: dto.warehouseId, data: { warehouse: w.name, lines: lines.length, note: dto.note ?? null, bins: [...bins.values()].map((b) => b.code) } });
    });
    return { ok: true, moved: lines.length };
  }

  /** Pemeriksaan invarian: Σ stok rak = stok gudang per barang, dan per lot */
  async check(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    const w = await this.warehouse(this.db, u.tenantId, warehouseId);
    if (!w.bins_enabled) return { enabled: false, ok: true, productMismatches: [], lotMismatches: [], unassigned: { products: 0, qty: '0' } };
    const prod = await this.db.execute(sql`
      SELECT p.sku, p.name, COALESCE(sb.qty, 0) AS balance, COALESCE(x.s, 0) AS binned
      FROM stock_balances sb
      FULL JOIN (SELECT product_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${warehouseId} GROUP BY product_id) x ON x.product_id = sb.product_id AND sb.warehouse_id = ${warehouseId}
      JOIN products p ON p.id = COALESCE(sb.product_id, x.product_id)
      WHERE (sb.warehouse_id = ${warehouseId} OR sb.warehouse_id IS NULL) AND COALESCE(sb.qty, 0) <> COALESCE(x.s, 0)
      ORDER BY p.sku LIMIT 100`);
    const lots = await this.db.execute(sql`
      SELECT p.sku, p.name, l.lot_no AS "lotNo", l.qty_remaining AS balance, COALESCE(x.s, 0) AS binned
      FROM stock_lots l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN (SELECT lot_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${warehouseId} AND lot_id IS NOT NULL GROUP BY lot_id) x ON x.lot_id = l.id
      WHERE l.warehouse_id = ${warehouseId} AND l.qty_remaining <> COALESCE(x.s, 0)
      ORDER BY p.sku LIMIT 100`);
    const un = (await this.db.execute<{ products: number; qty: string }>(sql`
      SELECT COUNT(DISTINCT s.product_id)::int AS products, COALESCE(SUM(s.qty), 0) AS qty FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
      WHERE s.warehouse_id = ${warehouseId} AND b.kind = 'UNASSIGNED' AND s.qty > 0`)).rows[0];
    return { enabled: true, ok: prod.rows.length === 0 && lots.rows.length === 0, productMismatches: prod.rows, lotMismatches: lots.rows, unassigned: un };
  }
}

const READ_ROLES = ['ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'PURCHASING', 'SALES'] as const;

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory/bins')
export class BinsController {
  constructor(private readonly svc: BinsService) {}

  @Get('warehouses') @Roles(...READ_ROLES)
  warehouses(@CurrentUser() u: AuthUser) { return this.svc.warehouses(u); }

  @Get() @Roles(...READ_ROLES)
  list(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) { return this.svc.list(u, warehouseId); }

  @Get('stock') @Roles(...READ_ROLES)
  stock(@CurrentUser() u: AuthUser, @Query() q: BinStockQuery) { return this.svc.stock(u, q); }

  @Get('history') @Roles(...READ_ROLES)
  history(@CurrentUser() u: AuthUser, @Query() q: BinStockQuery) { return this.svc.history(u, q); }

  @Get('check') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
  check(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) { return this.svc.check(u, warehouseId); }

  @Post('activate') @Roles('ADMIN', 'FINANCE')
  activate(@CurrentUser() u: AuthUser, @Body() dto: BinWarehouseDto) { return this.svc.activate(u, dto.warehouseId); }

  @Post('deactivate') @Roles('ADMIN', 'FINANCE')
  deactivate(@CurrentUser() u: AuthUser, @Body() dto: BinWarehouseDto) { return this.svc.deactivate(u, dto.warehouseId); }

  @Post() @Roles('ADMIN', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBinsDto) { return this.svc.createBins(u, dto); }

  @Patch(':id') @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBinDto) { return this.svc.updateBin(u, id, dto); }

  @Post('move') @Roles('ADMIN', 'WAREHOUSE')
  move(@CurrentUser() u: AuthUser, @Body() dto: MoveBinsDto) { return this.svc.move(u, dto); }
}
