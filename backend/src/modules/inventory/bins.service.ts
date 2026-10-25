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
import { BinsRepository } from './bins.repository';

const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;

const KIND_ALIAS: Record<string, (typeof CREATABLE_KINDS)[number]> = { STORAGE: 'STORAGE', SIMPAN: 'STORAGE', STAGING: 'STAGING', PENYIAPAN: 'STAGING', DAMAGED: 'DAMAGED', RUSAK: 'DAMAGED', QUARANTINE: 'QUARANTINE', KARANTINA: 'QUARANTINE' };

/** Batas hari untuk kontrol rak */
export const UNPLACED_DAYS = 7;

export const DAMAGED_DAYS = 30;

export const HEAVY_MOVES = 30;

const MAX_ROWS = 500;

@Injectable()
export class BinsService {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService, private readonly approvals: ApprovalsService,
    private readonly repo: BinsRepository) {}

  private async warehouse(db: Db | Tx, tenantId: string, id: string, lock = false) {
    const r = await this.repo.queryWarehouse(db, lock, id, tenantId);
    if (!r.rows[0]) throw new BadRequestException('Gudang tidak ditemukan');
    return r.rows[0];
  }

  private async bin(db: Db | Tx, tenantId: string, id: string) {
    const r = await this.repo.queryWarehouseBin(db, id, tenantId);
    if (!r.rows[0]) throw new NotFoundException('Rak tidak ditemukan');
    return r.rows[0];
  }

  /** Daftar gudang beserta status rak (untuk pilihan di layar) */
  async warehouses(u: AuthUser) {
    const allowed = allowedWarehouses(u);
    const r = await this.repo.queryWarehouseForWarehouses(this.db, u.tenantId, allowed);
    return r.rows;
  }

  async list(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    const w = await this.warehouse(this.db, u.tenantId, warehouseId);
    const bins = await this.repo.queryWarehouseBinForList(this.db, u.tenantId, warehouseId);
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
      let uid = (await this.repo.queryWarehouseBinForActivate(tx, warehouseId)).rows[0]?.id;
      if (!uid) {
        uid = (await this.repo.queryWarehouseBinForActivate2(tx, u.tenantId, warehouseId, u.sub)).rows[0].id;
      }
      // bekukan saldo gudang selama penyalinan awal
      await this.repo.queryStockBalance(tx, warehouseId);
      // 1) lot (FEFO), dibatasi sampai saldo barangnya
      await this.repo.queryStockBinBalance(tx, warehouseId, u.tenantId, uid);
      // 2) sisa stok yang tidak bernomor lot
      await this.repo.queryStockBinBalanceForActivate(tx, u.tenantId, warehouseId, uid);
      await this.repo.queryBinMove(tx, u.tenantId, warehouseId, uid, u.sub);
      await this.repo.queryActivate(tx, warehouseId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WarehouseBins', entityId: warehouseId, data: { warehouse: w.name, binsEnabled: true } });
    });
    return this.list(u, warehouseId);
  }

  async deactivate(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    await this.db.transaction(async (tx) => {
      const w = await this.warehouse(tx, u.tenantId, warehouseId, true);
      if (!w.bins_enabled) throw new BadRequestException('Lokasi rak gudang ini belum aktif');
      const used = await this.repo.queryStockBinBalanceForDeactivate(tx, warehouseId);
      if (used.rows.length) throw new BadRequestException(`Masih ada stok di rak ${used.rows.map((r) => r.code).join(', ')}. Pindahkan semuanya ke ${UNASSIGNED_CODE} dulu.`);
      await this.repo.queryStockBinBalanceForDeactivate2(tx, warehouseId);
      await this.repo.queryDeactivate(tx, warehouseId);
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
      const exist = await this.repo.queryWarehouseBinForCreateBins(tx, dto.warehouseId, codes);
      if (exist.rows.length) throw new BadRequestException(`Kode rak sudah ada: ${exist.rows.slice(0, 5).map((r) => r.code).join(', ')}`);
      for (const code of codes) {
        await this.repo.queryWarehouseBinForCreateBins2(tx, u.tenantId, dto, code, u.sub);
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
    const exist = new Set((await this.repo.queryWarehouseBinForImportBins(this.db, dto.warehouseId)).rows.map((r) => r.code));
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
        await this.repo.queryWarehouseBinForImportBins2(tx, u.tenantId, dto.warehouseId, r.code, r.zone, r.name, r.kind, u.sub);
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
        const left = await this.repo.queryStockBinBalanceForUpdateBin(tx, id);
        if (left.rows.length) throw new BadRequestException(`Rak ${b.code} masih berisi stok; pindahkan dulu sebelum dinonaktifkan`);
      }
      await this.repo.queryWarehouseBinForUpdateBin(tx, dto, b.is_active, id, u);
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
    const r = await this.repo.queryBinMoveForHistory(this.db, u, q, allowed);
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
        const avg = (await this.repo.queryStockBalanceForMove(this.db, ln.productId, dto.warehouseId)).rows[0]?.avg_cost ?? '0';
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
        const r = await this.repo.queryWarehouseBinForMove(tx, id, dto.warehouseId, u.tenantId);
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
          await this.repo.queryStockBalanceForMove2(tx, ln.productId, dto.warehouseId);
          locked.add(ln.productId);
        }
        const src = (await tx.execute<{ id: string; qty: string }>(sql`
          SELECT id, qty FROM stock_bin_balances
          WHERE bin_id = ${ln.fromBinId} AND product_id = ${ln.productId} AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(${ln.lotId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          FOR UPDATE`)).rows[0];
        const have = D(src?.qty ?? 0);
        if (!src || have.lt(qty)) {
          const [p] = (await this.repo.queryProduct(tx, ln.productId, u.tenantId)).rows;
          throw new BadRequestException(`Stok ${p?.sku ?? 'barang'} di rak ${from.code} tidak cukup: tersedia ${have.toString()}, dipindah ${qty.toString()}`);
        }
        await this.repo.queryMove(tx, have, qty, src.id);
        await this.repo.queryStockBinBalanceForMove(tx, src.id);
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
      const o = (await this.repo.querySalesOrder(this.db, q.salesOrderId, u.tenantId)).rows[0];
      if (!o) throw new NotFoundException('Pesanan penjualan tidak ditemukan');
      warehouseId = o.warehouse_id;
      order = { id: o.id, number: o.number };
      const r = await this.repo.querySalesOrderLine(this.db, q.salesOrderId);
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
      const p = (await this.repo.queryProductForPickPlan(this.db, productId, u.tenantId)).rows[0];
      if (!p) throw new BadRequestException('Ada barang yang tidak ditemukan');
      const rows = await this.repo.queryStockBinBalanceForPickPlan(this.db, warehouseId, productId);
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
      const m = await this.repo.queryStockBalanceForControls(this.db, w.id);
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
    const prod = await this.repo.queryStockBalanceForCheck(this.db, warehouseId);
    const lots = await this.repo.queryStockLot(this.db, warehouseId);
    const un = (await this.repo.queryStockBinBalanceForCheck(this.db, warehouseId)).rows[0];
    return { enabled: true, ok: prod.rows.length === 0 && lots.rows.length === 0, productMismatches: prod.rows, lotMismatches: lots.rows, unassigned: un };
  }
}
