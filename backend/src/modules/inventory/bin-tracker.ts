/**
 * Lokasi rak: pencatatan di atas mutasi stok (tidak mengubah kuantitas gudang, HPP, atau jurnal).
 *
 * Untuk gudang yang rak-nya aktif, setiap mutasi di StockService.move() juga dicatat per rak dan per lot:
 *  - barang masuk tanpa rak tujuan → rak sistem BELUM-DITEMPATKAN (atau rak yang dipilih),
 *  - barang keluar → diambil dari rak yang paling wajar (rak pilihan, lalu rak simpan, lalu BELUM-DITEMPATKAN, rak rusak/karantina terakhir).
 * Invarian: Σ stok semua rak per barang = stok gudangnya. Selisih tidak pernah memblokir transaksi stok; terdeteksi lewat pemeriksaan konsistensi.
 */
import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { D, Dec } from '../../common/utils/money';
import { Tx } from '../../db/db';
import type { LotDelta } from './stock-lots';
import {
  queryBinMove,
  queryStockBinBalance,
  queryWarehouseBin,
  queryStockBinBalanceForTakeFrom,
  queryTakeFrom,
  queryStockBinBalanceForTakeFrom2,
  queryWarehouse,
  queryWarehouseBinForTrackBins,
  queryStockBinBalanceForRelabelAsLot,
  BIN_PICK_TIER,
} from './bin-tracker.repository';
export { BIN_PICK_TIER } from './bin-tracker.repository';

export const BIN_KINDS = ['STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE', 'UNASSIGNED'] as const;
export type BinKind = (typeof BIN_KINDS)[number];
export const UNASSIGNED_CODE = 'BELUM-DITEMPATKAN';

export interface BinTrackInput {
  tenantId: string;
  productId: string;
  warehouseId: string;
  /** Bertanda: positif masuk, negatif keluar (satuan dasar) */
  qty: Dec;
  refType: string;
  refId: string;
  /** Rak tujuan (masuk) atau rak yang diutamakan (keluar) */
  binId?: string;
  lotDeltas: LotDelta[];
}

interface Part {
  lotId: string | null;
  qty: Dec;
}

/** Pecah jumlah mutasi menjadi bagian per lot + sisanya tanpa lot */
function parts(total: Dec, deltas: LotDelta[]): Part[] {
  const out: Part[] = [];
  let used = D(0);
  for (const d of deltas) {
    const q = d.qty.abs();
    if (q.isZero()) continue;
    out.push({ lotId: d.lotId, qty: q });
    used = used.plus(q);
  }
  const rest = total.abs().minus(used);
  if (rest.gt(0)) out.push({ lotId: null, qty: rest });
  return out;
}

export async function logBinMove(
  tx: Tx,
  m: {
    tenantId: string;
    warehouseId: string;
    productId: string;
    lotId: string | null;
    fromBinId: string | null;
    toBinId: string | null;
    qty: Dec;
    kind: 'SEED' | 'RECEIVE' | 'ISSUE' | 'MOVE';
    refType?: string | null;
    refId?: string | null;
    note?: string | null;
  },
) {
  await queryBinMove(
    tx,
    m.tenantId,
    m.warehouseId,
    m.productId,
    m.lotId,
    m.fromBinId,
    m.toBinId,
    m.qty.toFixed(4),
    m.kind,
    m.refType,
    m.refId,
    m.note,
  );
}

export async function addToBin(
  tx: Tx,
  m: { tenantId: string; warehouseId: string; productId: string; binId: string; lotId: string | null; qty: Dec },
) {
  await queryStockBinBalance(tx, m.tenantId, m.warehouseId, m.binId, m.productId, m.lotId, m.qty);
}

export async function unassignedBinId(tx: Tx, warehouseId: string): Promise<string> {
  const r = await queryWarehouseBin(tx, warehouseId);
  if (!r.rows[0])
    throw new BadRequestException(
      'Rak sistem BELUM-DITEMPATKAN tidak ditemukan; nonaktifkan lalu aktifkan lagi lokasi rak gudang ini.',
    );
  return r.rows[0].id;
}

/** Ambil sebanyak mungkin dari rak; kembalikan sisa yang tidak terpenuhi */
async function takeFrom(
  tx: Tx,
  m: BinTrackInput,
  need: Dec,
  cond: ReturnType<typeof sql>,
  prefer: string | null,
  lotForLog: string | null,
  kind: 'ISSUE',
): Promise<Dec> {
  const rows = await queryStockBinBalanceForTakeFrom(tx, m.warehouseId, m.productId, cond, prefer);
  let left = need;
  for (const r of rows.rows) {
    if (left.lte(0)) break;
    const have = D(r.qty);
    const take = have.lt(left) ? have : left;
    await queryTakeFrom(tx, have, take, r.id);
    await queryStockBinBalanceForTakeFrom2(tx, r.id);
    await logBinMove(tx, {
      tenantId: m.tenantId,
      warehouseId: m.warehouseId,
      productId: m.productId,
      lotId: r.lot_id ?? lotForLog,
      fromBinId: r.bin_id,
      toBinId: null,
      qty: take,
      kind,
      refType: m.refType,
      refId: m.refId,
    });
    left = left.minus(take);
  }
  return left;
}

/** Dipanggil StockService.move() setelah stok gudang dan lot diperbarui, di transaksi yang sama */
export async function trackBins(tx: Tx, m: BinTrackInput): Promise<void> {
  // FOR SHARE: pengaktifan/penonaktifan rak (FOR UPDATE) menunggu mutasi yang sedang berjalan, dan mutasi baru melihat status terbaru
  const w = await queryWarehouse(tx, m.warehouseId);
  if (!w.rows[0]?.enabled) return;

  if (m.qty.isPositive()) {
    let target: string;
    if (m.binId) {
      const b = await queryWarehouseBinForTrackBins(tx, m.binId, m.warehouseId, m.tenantId);
      if (!b.rows[0]) throw new BadRequestException('Rak tujuan tidak ditemukan di gudang ini');
      if (!b.rows[0].is_active) throw new BadRequestException(`Rak ${b.rows[0].code} nonaktif`);
      target = b.rows[0].id;
    } else target = await unassignedBinId(tx, m.warehouseId);
    for (const p of parts(
      m.qty,
      m.lotDeltas.filter((d) => d.qty.isPositive()),
    )) {
      await addToBin(tx, {
        tenantId: m.tenantId,
        warehouseId: m.warehouseId,
        productId: m.productId,
        binId: target,
        lotId: p.lotId,
        qty: p.qty,
      });
      await logBinMove(tx, {
        tenantId: m.tenantId,
        warehouseId: m.warehouseId,
        productId: m.productId,
        lotId: p.lotId,
        fromBinId: null,
        toBinId: target,
        qty: p.qty,
        kind: 'RECEIVE',
        refType: m.refType,
        refId: m.refId,
      });
    }
    return;
  }

  const prefer = m.binId ?? null;
  const strict = (lotId: string | null) => (lotId ? sql`s.lot_id = ${lotId}` : sql`s.lot_id IS NULL`);
  for (const p of parts(
    m.qty,
    m.lotDeltas.filter((d) => d.qty.isNegative()),
  )) {
    let left = await takeFrom(tx, m, p.qty, strict(p.lotId), prefer, p.lotId, 'ISSUE');
    // lot di rak tidak cukup (mis. lot lama yang belum tercatat per rak): ambil dari catatan lain barang yang sama agar total tetap sama dengan stok gudang
    if (left.gt(0))
      left = await takeFrom(
        tx,
        m,
        left,
        p.lotId ? sql`s.lot_id IS DISTINCT FROM ${p.lotId}` : sql`s.lot_id IS NOT NULL`,
        prefer,
        null,
        'ISSUE',
      );
  }
}

/** Lot dibuat setelah mutasi (mis. QC): jumlahnya dipindahkan dari catatan tanpa lot ke catatan lot di rak yang sama */
export async function relabelAsLot(
  tx: Tx,
  m: { tenantId: string; warehouseId: string; productId: string; lotId: string; qty: Dec },
): Promise<void> {
  const w = await queryWarehouse(tx, m.warehouseId);
  if (!w.rows[0]?.enabled) return;
  const rows = await queryStockBinBalanceForRelabelAsLot(tx, m.warehouseId, m.productId);
  let left = m.qty;
  for (const r of rows.rows) {
    if (left.lte(0)) break;
    const have = D(r.qty);
    const take = have.lt(left) ? have : left;
    await queryTakeFrom(tx, have, take, r.id);
    await queryStockBinBalanceForTakeFrom2(tx, r.id);
    await addToBin(tx, {
      tenantId: m.tenantId,
      warehouseId: m.warehouseId,
      productId: m.productId,
      binId: r.bin_id,
      lotId: m.lotId,
      qty: take,
    });
    left = left.minus(take);
  }
}
