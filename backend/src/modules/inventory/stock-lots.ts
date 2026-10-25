/**
 * Lot dan tanggal kedaluwarsa bahan: pencatatan informatif di atas mutasi stok (tidak mengubah nilai persediaan, biaya, atau jurnal).
 *  - Barang masuk boleh membawa nomor lot dan tanggal kedaluwarsa → baris lot baru.
 *  - Barang keluar mengurangi lot yang paling cepat kedaluwarsa lebih dulu (FEFO); lot tanpa tanggal terakhir.
 *  - Transfer gudang membawa lotnya ke gudang tujuan; pembatalan penerimaan menghapus lot dari penerimaan itu.
 * Jumlah semua lot satu barang di satu gudang tidak pernah melebihi stoknya (barang tanpa lot dianggap tidak dilacak).
 */
import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { D, Dec } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { StockMoveType } from '../../db/schema';
import {
  queryStockLot,
  queryStockLotTransit,
  queryStockLotForTrackLots,
  queryTrackLots,
  queryStockLotForDeplete,
  queryDeplete,
  queryStockLotIssue,
  queryStockLotTransitForDeplete,
} from './stock-lots.repository';

export interface LotInput {
  lotNo?: string | null;
  /** YYYY-MM-DD */
  expiryDate?: string | null;
}

/** Perubahan lot akibat satu mutasi: positif = lot baru / bertambah, negatif = lot terpakai (dipakai pencatatan rak) */
export interface LotDelta {
  lotId: string;
  qty: Dec;
}

export interface LotMove {
  tenantId: string;
  productId: string;
  warehouseId: string;
  type: StockMoveType;
  qty: Dec;
  refType: string;
  refId: string;
  date: string;
  lot?: LotInput;
  /** Kurangi hanya lot ini (pembuangan lot tertentu) */
  lotId?: string;
  /** Barang keluar bagian tanpa nomor lot: lot tidak dikurangi */
  noLot?: boolean;
  excludeLotNos?: string[];
  reverseCost?: boolean;
}

/** Jenis mutasi keluar yang mengurangi lot (FEFO) */
const DEPLETING: StockMoveType[] = ['SALE', 'ADJUSTMENT_OUT', 'PRODUCTION_ISSUE', 'PURCHASE_RETURN', 'TRANSFER_OUT'];
/** Jenis mutasi masuk yang boleh membawa lot baru */
const RECEIVING: StockMoveType[] = ['PURCHASE', 'ADJUSTMENT_IN', 'PRODUCTION_OUTPUT'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validasi lot masukan; kembalikan lot bersih atau null bila kosong */
export function cleanLot(
  lot: LotInput | undefined,
  receivedDate: string,
): { lotNo: string | null; expiryDate: string | null } | null {
  if (!lot) return null;
  const lotNo = lot.lotNo?.trim() || null;
  const expiryDate = lot.expiryDate?.trim() || null;
  if (!lotNo && !expiryDate) return null;
  if (lotNo && lotNo.length > 40) throw new BadRequestException('Nomor lot maksimal 40 karakter');
  if (expiryDate) {
    if (!ISO.test(expiryDate) || Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`)))
      throw new BadRequestException('Tanggal kedaluwarsa tidak valid (format TTTT-BB-HH)');
    if (expiryDate < receivedDate)
      throw new BadRequestException(`Barang sudah kedaluwarsa saat diterima (kedaluwarsa ${expiryDate})`);
  }
  return { lotNo, expiryDate };
}

export async function trackLots(tx: Tx, m: LotMove): Promise<LotDelta[]> {
  const q = m.qty;
  const deltas: LotDelta[] = [];
  if (q.isPositive()) {
    if (RECEIVING.includes(m.type)) {
      const lot = cleanLot(m.lot, m.date);
      if (lot) {
        const ins = await queryStockLot(
          tx,
          m.tenantId,
          m.productId,
          m.warehouseId,
          lot.lotNo,
          lot.expiryDate,
          m.date,
          q,
          m.refType,
          m.refId,
        );
        deltas.push({ lotId: ins.rows[0].id, qty: q });
      }
    } else if (m.type === 'TRANSFER_IN' && m.refType === 'STOCK_TRANSFER') {
      // lot yang dikirim ikut pindah (juga saat kiriman dibatalkan dan kembali ke gudang asal)
      const pieces = await queryStockLotTransit(tx, m.refId, m.productId);
      let need = q;
      for (const p of pieces.rows) {
        if (need.lte(0)) break;
        const left = D(p.qty_left);
        const take = left.lt(need) ? left : need;
        const ins = await queryStockLotForTrackLots(
          tx,
          m.tenantId,
          m.productId,
          m.warehouseId,
          p.lot_no,
          p.expiry_date,
          p.received_date,
          take,
          m.refType,
          m.refId,
        );
        deltas.push({ lotId: ins.rows[0].id, qty: take });
        await queryTrackLots(tx, left, take, p.id);
        need = need.minus(take);
      }
    }
    return deltas;
  }

  const out = q.abs();
  // pembatalan penerimaan: hapus lot dari penerimaan itu (bukan lot lain yang kebetulan lebih dulu kedaluwarsa)
  if (m.reverseCost && m.refType === 'GOODS_RECEIPT_CANCEL') {
    await deplete(tx, m, out, sql`AND source_ref = ${m.refId} AND source_type = 'GOODS_RECEIPT'`, false, deltas);
    return deltas;
  }
  if (m.lotId) {
    await deplete(tx, m, out, sql`AND id = ${m.lotId}`, false, deltas);
    return deltas;
  }
  if (!DEPLETING.includes(m.type) || m.noLot) return deltas;
  const exclude = m.excludeLotNos?.length
    ? sql`AND (lot_no IS NULL OR lot_no NOT IN (${sql.join(
        m.excludeLotNos.map((n) => sql`${n}`),
        sql`, `,
      )}))`
    : sql``;
  await deplete(tx, m, out, exclude, m.type === 'TRANSFER_OUT', deltas);
  return deltas;
}

async function deplete(
  tx: Tx,
  m: LotMove,
  out: Dec,
  extra: ReturnType<typeof sql>,
  toTransit: boolean,
  deltas: LotDelta[],
) {
  const lots = await queryStockLotForDeplete(tx, m.productId, m.warehouseId, extra);
  let need = out;
  for (const l of lots.rows) {
    if (need.lte(0)) break;
    const have = D(l.qty_remaining);
    const take = have.lt(need) ? have : need;
    await queryDeplete(tx, have, take, l.id);
    deltas.push({ lotId: l.id, qty: take.negated() });
    // jejak keluar per lot (dasar penelusuran penarikan produk); pembatalan penerimaan bukan pengeluaran ke pihak lain
    if (m.refType !== 'GOODS_RECEIPT_CANCEL') {
      await queryStockLotIssue(
        tx,
        m.tenantId,
        l.id,
        m.productId,
        m.warehouseId,
        take,
        m.type,
        m.refType,
        m.refId,
        m.date,
      );
    }
    if (toTransit) {
      await queryStockLotTransitForDeplete(
        tx,
        m.tenantId,
        m.refId,
        m.productId,
        l.lot_no,
        l.expiry_date,
        l.received_date,
        take,
      );
    }
    need = need.minus(take);
  }
}
