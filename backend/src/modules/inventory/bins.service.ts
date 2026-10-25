import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { D, Dec, qty4 } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { addToBin, BIN_PICK_TIER, logBinMove, UNASSIGNED_CODE } from './bin-tracker';
import { CREATABLE_KINDS, BinStockQuery, PickPlanQuery } from './bins.shared';
import { CreateBinsDto, ImportBinsDto, UpdateBinDto, MoveBinsDto } from './bins.dto';

const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;

const KIND_ALIAS: Record<string, (typeof CREATABLE_KINDS)[number]> = { STORAGE: 'STORAGE', SIMPAN: 'STORAGE', STAGING: 'STAGING', PENYIAPAN: 'STAGING', DAMAGED: 'DAMAGED', RUSAK: 'DAMAGED', QUARANTINE: 'QUARANTINE', KARANTINA: 'QUARANTINE' };

/** Batas hari untuk kontrol rak */
export const UNPLACED_DAYS = 7;

export const DAMAGED_DAYS = 30;

export const HEAVY_MOVES = 30;

const MAX_ROWS = 500;

@Injectable()
export class BinsService {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService, private readonly approvals: ApprovalsService) {}

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

  /** Impor rak dari berkas (kode, zona, jenis, nama): diperiksa baris demi baris; bila ada yang bermasalah tidak ada yang disimpan */
  async importBins(u: AuthUser, dto: ImportBinsDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    const w = await this.warehouse(this.db, u.tenantId, dto.warehouseId);
    if (!w.bins_enabled) throw new BadRequestException('Aktifkan lokasi rak gudang ini dulu');
    const exist = new Set((await this.db.execute<{ code: string }>(sql`SELECT code FROM warehouse_bins WHERE warehouse_id = ${dto.warehouseId}`)).rows.map((r) => r.code));
    const seen = new Set<string>();
    const results = dto.rows.map((r, i) => {
      const errors: string[] = [];
      const code = r.code.trim().toUpperCase();
      const kind = r.kind?.trim() ? KIND_ALIAS[r.kind.trim().toUpperCase()] : 'STORAGE';
      if (!CODE_RE.test(code)) errors.push('Kode tidak valid (huruf besar, angka, titik, garis, garis miring; maks 30 karakter)');
      else if (code === UNASSIGNED_CODE) errors.push(`Kode ${UNASSIGNED_CODE} dipakai rak sistem`);
      else if (seen.has(code)) errors.push('Kode muncul dua kali dalam berkas');
      if (!kind) errors.push('Jenis tidak dikenal (Simpan, Penyiapan, Rusak, Karantina)');
      seen.add(code);
      const action = errors.length ? 'ERROR' : exist.has(code) ? 'SKIP' : 'CREATE';
      return { row: i + 1, code, zone: r.zone?.trim() || null, name: r.name?.trim() || null, kind: kind ?? null, action, errors, warnings: action === 'SKIP' ? ['Rak sudah ada; dilewati'] : [] };
    });
    const summary = { total: results.length, create: results.filter((x) => x.action === 'CREATE').length, skip: results.filter((x) => x.action === 'SKIP').length, errors: results.filter((x) => x.action === 'ERROR').length };
    if (dto.dryRun) return { dryRun: true, summary, results };
    if (summary.errors) throw new BadRequestException({ statusCode: 400, message: `Ada ${summary.errors} baris bermasalah; tidak ada rak yang disimpan. Perbaiki lalu impor ulang.`, summary, results });
    await this.db.transaction(async (tx) => {
      const lock = await this.warehouse(tx, u.tenantId, dto.warehouseId, true);
      if (!lock.bins_enabled) throw new BadRequestException('Aktifkan lokasi rak gudang ini dulu');
      for (const r of results.filter((x) => x.action === 'CREATE')) {
        await tx.execute(sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, zone, name, kind, created_by_id) VALUES (${u.tenantId}, ${dto.warehouseId}, ${r.code}, ${r.zone}, ${r.name}, ${r.kind}, ${u.sub}) ON CONFLICT (tenant_id, warehouse_id, code) DO NOTHING`);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WarehouseBin', entityId: dto.warehouseId, data: { warehouse: w.name, imported: summary.create, skipped: summary.skip } });
    });
    return { dryRun: false, summary, results };
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
             s.product_id AS "productId", p.sku, p.name, p.barcode, p.base_uom AS uom, s.lot_id AS "lotId", l.lot_no AS "lotNo", l.expiry_date AS "expiryDate", s.qty
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
  async move(u: AuthUser, dto: MoveBinsDto, opts: { approved?: boolean } = {}) {
    assertWarehouseAccess(u, dto.warehouseId);
    const lines = [...dto.lines].sort((a, b) => a.productId.localeCompare(b.productId));
    // Pindah rak bernilai besar oleh peran selain Pemilik/Admin menunggu persetujuan (batas yang sama dengan penyesuaian stok)
    if (!opts.approved && !this.approvals.isApprover(u.role)) {
      let value = D(0);
      for (const ln of lines) {
        const avg = (await this.db.execute<{ avg_cost: string }>(sql`SELECT avg_cost FROM stock_balances WHERE product_id = ${ln.productId} AND warehouse_id = ${dto.warehouseId}`)).rows[0]?.avg_cost ?? '0';
        value = value.plus(qty4(ln.qty).times(avg));
      }
      const limit = await this.approvals.needs(this.db, u, 'STOCK_ADJUSTMENT', value.toNumber());
      if (limit !== null) {
        const w = await this.warehouse(this.db, u.tenantId, dto.warehouseId);
        const req = await this.approvals.create(this.db, u, { kind: 'BIN_MOVE', refId: null, title: `Pindah rak ${lines.length} barang di ${w.name} (≈ Rp${Math.round(value.toNumber()).toLocaleString('id-ID')})`, amount: value.toNumber(), payload: JSON.parse(JSON.stringify(dto)) });
        throw this.approvals.required(req.id, 'Nilai barang yang dipindah mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan stok dipindah setelah disetujui.');
      }
    }
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

  /**
   * Daftar ambil (picking list): lot yang paling cepat kedaluwarsa lebih dulu (FEFO), di rak yang akan dikurangi sistem saat barang keluar
   * (urutan sama dengan pembukuan), lalu diurutkan menurut zona/kode rak agar petugas berjalan searah. Rak rusak/karantina tidak dipakai.
   */
  async pickPlan(u: AuthUser, q: PickPlanQuery) {
    let warehouseId = q.warehouseId;
    let order: { id: string; number: string } | null = null;
    const need = new Map<string, Dec>();
    if (q.salesOrderId) {
      const o = (await this.db.execute<{ id: string; number: string; warehouse_id: string }>(sql`SELECT id, number, warehouse_id FROM sales_orders WHERE id = ${q.salesOrderId} AND tenant_id = ${u.tenantId}`)).rows[0];
      if (!o) throw new NotFoundException('Pesanan penjualan tidak ditemukan');
      warehouseId = o.warehouse_id;
      order = { id: o.id, number: o.number };
      const r = await this.db.execute<{ product_id: string; base: string }>(sql`
        SELECT sol.product_id, SUM((sol.qty - COALESCE(dl.q, 0)) * sol.uom_factor)::text AS base
        FROM sales_order_lines sol
        LEFT JOIN (SELECT x.order_line_id, SUM(x.qty) AS q FROM delivery_order_lines x JOIN delivery_orders d ON d.id = x.delivery_id WHERE d.sales_order_id = ${q.salesOrderId} AND d.status = 'DELIVERED' GROUP BY x.order_line_id) dl ON dl.order_line_id = sol.id
        WHERE sol.order_id = ${q.salesOrderId} GROUP BY sol.product_id HAVING SUM((sol.qty - COALESCE(dl.q, 0)) * sol.uom_factor) > 0`);
      for (const x of r.rows) need.set(x.product_id, D(x.base));
    } else {
      if (!warehouseId) throw new BadRequestException('Pilih gudang atau pesanan penjualan');
      for (const part of (q.items ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)) {
        const [pid, qty] = part.split(':');
        if (!/^[0-9a-f-]{36}$/i.test(pid ?? '') || !/^\d+(\.\d{1,4})?$/.test(qty ?? '') || D(qty).lte(0)) throw new BadRequestException('Daftar kebutuhan tidak valid');
        need.set(pid, (need.get(pid) ?? D(0)).plus(qty));
      }
    }
    if (!need.size) throw new BadRequestException(q.salesOrderId ? 'Pesanan ini tidak punya barang yang belum dikirim' : 'Isi minimal satu barang');
    assertWarehouseAccess(u, warehouseId!);
    const w = await this.warehouse(this.db, u.tenantId, warehouseId!);
    if (!w.bins_enabled) throw new BadRequestException(`Lokasi rak belum aktif di gudang ${w.name}`);
    const lines: Record<string, unknown>[] = [];
    const shortages: { productId: string; sku: string; name: string; needed: string; available: string }[] = [];
    for (const [productId, want] of need) {
      const p = (await this.db.execute<{ sku: string; name: string; base_uom: string }>(sql`SELECT sku, name, base_uom FROM products WHERE id = ${productId} AND tenant_id = ${u.tenantId}`)).rows[0];
      if (!p) throw new BadRequestException('Ada barang yang tidak ditemukan');
      const rows = await this.db.execute<{ bin_id: string; code: string; zone: string | null; kind: string; lot_id: string | null; lot_no: string | null; expiry_date: string | null; qty: string }>(sql`
        SELECT s.bin_id, b.code, b.zone, b.kind, s.lot_id, l.lot_no, l.expiry_date, s.qty
        FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id LEFT JOIN stock_lots l ON l.id = s.lot_id
        WHERE s.warehouse_id = ${warehouseId} AND s.product_id = ${productId} AND s.qty > 0 AND b.kind IN ('STORAGE', 'STAGING', 'UNASSIGNED')
        ORDER BY (s.lot_id IS NULL), l.expiry_date NULLS LAST, l.received_date, l.id, ${BIN_PICK_TIER}, s.qty, b.code`);
      let left = want;
      let avail = D(0);
      for (const r of rows.rows) {
        avail = avail.plus(r.qty);
        if (left.lte(0)) continue;
        const have = D(r.qty);
        const take = have.lt(left) ? have : left;
        lines.push({ productId, sku: p.sku, name: p.name, uom: p.base_uom, binId: r.bin_id, binCode: r.code, zone: r.zone, binKind: r.kind, lotId: r.lot_id, lotNo: r.lot_no, expiryDate: r.expiry_date, qty: take.toFixed(4), available: have.toFixed(4) });
        left = left.minus(take);
      }
      if (left.gt(0)) shortages.push({ productId, sku: p.sku, name: p.name, needed: want.toFixed(4), available: avail.toFixed(4) });
    }
    // urutan jalan petugas: zona, kode rak (angka dibaca sebagai angka), lalu barang
    const nat = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), 'id', { numeric: true });
    lines.sort((a, b) => (a.zone ? 0 : 1) - (b.zone ? 0 : 1) || nat(a.zone, b.zone) || (a.binKind === 'UNASSIGNED' ? 1 : 0) - (b.binKind === 'UNASSIGNED' ? 1 : 0) || nat(a.binCode, b.binCode) || nat(a.sku, b.sku));
    return {
      warehouse: { id: w.id, code: w.code, name: w.name },
      order,
      lines,
      shortages,
      unplaced: lines.filter((l) => l.binKind === 'UNASSIGNED').length,
    };
  }

  /**
   * Temuan kontrol rak (anti-kecurangan): barang lama belum ditata, rak dengan selisih opname berulang, pindah rak berlebihan oleh satu orang,
   * rak rusak/karantina menumpuk, dan selisih stok rak vs stok gudang. Bentuk sama dengan Kontrol persediaan.
   */
  async controls(tenantId: string, warehouseId?: string) {
    const out: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] }[] = [];
    const add = (key: string, level: 'error' | 'warning' | 'info', title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const wf = warehouseId ? sql`AND w.id = ${warehouseId}` : sql``;
    const enabled = await this.db.execute<{ id: string; code: string }>(sql`SELECT id, code FROM warehouses w WHERE tenant_id = ${tenantId} AND bins_enabled ${wf}`);
    if (!enabled.rows.length) return out;
    const age = (kinds: string[], days: number) => this.db.execute<{ wh: string; code: string; sku: string; qty: string; d: number }>(sql`
      SELECT w.code AS wh, b.code, p.sku, SUM(s.qty)::text AS qty, EXTRACT(DAY FROM now() - MIN(m.created_at))::int AS d
      FROM stock_bin_balances s
      JOIN warehouse_bins b ON b.id = s.bin_id AND b.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      JOIN warehouses w ON w.id = s.warehouse_id
      JOIN products p ON p.id = s.product_id
      LEFT JOIN LATERAL (SELECT MIN(x.created_at) AS created_at FROM bin_moves x WHERE x.to_bin_id = s.bin_id AND x.product_id = s.product_id) m ON true
      WHERE s.tenant_id = ${tenantId} AND s.qty > 0 ${wf}
      GROUP BY w.code, b.code, p.sku
      HAVING MIN(m.created_at) < now() - (${days} || ' days')::interval
      ORDER BY MIN(m.created_at) LIMIT 50`);
    const un = await age(['UNASSIGNED'], UNPLACED_DAYS);
    add('BIN_UNPLACED_OLD', 'warning', `Barang belum ditata di rak > ${UNPLACED_DAYS} hari`, un.rows.map((r) => `${r.wh} · ${r.sku}: ${Number(r.qty)} (${r.d} hari)`), `Barang yang lama berada di ${UNASSIGNED_CODE} sulit dicari dan mudah hilang tanpa terasa. Tata ke rak atau pastikan barangnya ada.`);
    const dm = await age(['DAMAGED', 'QUARANTINE'], DAMAGED_DAYS);
    add('BIN_DAMAGED_OLD', 'warning', `Barang di rak rusak/karantina > ${DAMAGED_DAYS} hari`, dm.rows.map((r) => `${r.wh} · rak ${r.code} · ${r.sku}: ${Number(r.qty)} (${r.d} hari)`), 'Barang rusak yang menumpuk perlu diputuskan: retur ke pemasok, dibuang dengan penyesuaian stok, atau dikembalikan bila ternyata baik. Rak ini rawan dipakai menyembunyikan pencurian.');
    const rep = await this.db.execute<{ wh: string; code: string; n: number }>(sql`
      SELECT w.code AS wh, b.code, COUNT(DISTINCT c.id)::int AS n
      FROM stock_counts c JOIN warehouse_bins b ON b.id = c.bin_id JOIN warehouses w ON w.id = c.warehouse_id
      JOIN stock_count_lines l ON l.count_id = c.id AND l.difference IS NOT NULL AND l.difference <> 0
      WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.posted_at > now() - interval '90 days' ${wf}
      GROUP BY w.code, b.code HAVING COUNT(DISTINCT c.id) >= 2 ORDER BY n DESC LIMIT 50`);
    add('BIN_COUNT_REPEAT', 'warning', 'Rak dengan selisih opname berulang (90 hari)', rep.rows.map((r) => `${r.wh} · rak ${r.code}: ${r.n} kali selisih`), 'Selisih berulang di rak yang sama menandakan kebocoran, salah taruh, atau salah catat yang belum diatasi. Selidiki rak ini.');
    const heavy = await this.db.execute<{ name: string; n: number }>(sql`
      SELECT COALESCE(u.name, 'Tidak diketahui') AS name, COUNT(*)::int AS n FROM bin_moves m LEFT JOIN users u ON u.id = m.created_by_id
      JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.kind = 'MOVE' AND m.created_at > now() - interval '7 days' ${wf}
      GROUP BY u.name HAVING COUNT(*) >= ${HEAVY_MOVES} ORDER BY n DESC LIMIT 20`);
    add('BIN_MOVE_HEAVY', 'info', `Pindah rak sangat sering oleh satu orang (≥ ${HEAVY_MOVES} dalam 7 hari)`, heavy.rows.map((r) => `${r.name}: ${r.n} kali`), 'Pindah rak yang berlebihan bisa wajar saat penataan awal, tetapi juga cara menutupi barang yang hilang. Cocokkan dengan hasil opname rak.');
    const bad: string[] = [];
    for (const w of enabled.rows) {
      const m = await this.db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM stock_balances sb
        FULL JOIN (SELECT product_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${w.id} GROUP BY product_id) x ON x.product_id = sb.product_id AND sb.warehouse_id = ${w.id}
        WHERE (sb.warehouse_id = ${w.id} OR sb.warehouse_id IS NULL) AND COALESCE(sb.qty, 0) <> COALESCE(x.s, 0)`);
      if (m.rows[0]?.n) bad.push(`${w.code}: ${m.rows[0].n} barang`);
    }
    add('BIN_MISMATCH', 'error', 'Stok rak tidak sama dengan stok gudang', bad, 'Stok gudang tetap benar; selisih hanya pada pencatatan letak. Buka Rak gudang › Pemeriksaan untuk rinciannya.');
    return out;
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
