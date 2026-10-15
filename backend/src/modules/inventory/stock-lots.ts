/**
 * Lot dan tanggal kedaluwarsa bahan: pencatatan informatif di atas mutasi stok (tidak mengubah nilai persediaan, biaya, atau jurnal).
 *  - Barang masuk boleh membawa nomor lot dan tanggal kedaluwarsa → baris lot baru.
 *  - Barang keluar mengurangi lot yang paling cepat kedaluwarsa lebih dulu (FEFO); lot tanpa tanggal terakhir.
 *  - Transfer gudang membawa lotnya ke gudang tujuan; pembatalan penerimaan menghapus lot dari penerimaan itu.
 * Jumlah semua lot satu barang di satu gudang tidak pernah melebihi stoknya (barang tanpa lot dianggap tidak dilacak).
 */
import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { D, Dec, qty4 } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { StockMoveType } from '../../db/schema';

export interface LotInput {
  lotNo?: string | null;
  /** YYYY-MM-DD */
  expiryDate?: string | null;
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
  excludeLotNos?: string[];
  reverseCost?: boolean;
}

/** Jenis mutasi keluar yang mengurangi lot (FEFO) */
const DEPLETING: StockMoveType[] = ['SALE', 'ADJUSTMENT_OUT', 'PRODUCTION_ISSUE', 'PURCHASE_RETURN', 'TRANSFER_OUT'];
/** Jenis mutasi masuk yang boleh membawa lot baru */
const RECEIVING: StockMoveType[] = ['PURCHASE', 'ADJUSTMENT_IN', 'PRODUCTION_OUTPUT'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validasi lot masukan; kembalikan lot bersih atau null bila kosong */
export function cleanLot(lot: LotInput | undefined, receivedDate: string): { lotNo: string | null; expiryDate: string | null } | null {
  if (!lot) return null;
  const lotNo = lot.lotNo?.trim() || null;
  const expiryDate = lot.expiryDate?.trim() || null;
  if (!lotNo && !expiryDate) return null;
  if (lotNo && lotNo.length > 40) throw new BadRequestException('Nomor lot maksimal 40 karakter');
  if (expiryDate) {
    if (!ISO.test(expiryDate) || Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`))) throw new BadRequestException('Tanggal kedaluwarsa tidak valid (format TTTT-BB-HH)');
    if (expiryDate < receivedDate) throw new BadRequestException(`Barang sudah kedaluwarsa saat diterima (kedaluwarsa ${expiryDate})`);
  }
  return { lotNo, expiryDate };
}

export async function trackLots(tx: Tx, m: LotMove): Promise<void> {
  const q = m.qty;
  if (q.isPositive()) {
    if (RECEIVING.includes(m.type)) {
      const lot = cleanLot(m.lot, m.date);
      if (lot) {
        await tx.execute(sql`
          INSERT INTO stock_lots (tenant_id, product_id, warehouse_id, lot_no, expiry_date, received_date, qty_received, qty_remaining, source_type, source_ref)
          VALUES (${m.tenantId}, ${m.productId}, ${m.warehouseId}, ${lot.lotNo}, ${lot.expiryDate}, ${m.date}, ${q.toFixed(4)}, ${q.toFixed(4)}, ${m.refType}, ${m.refId})`);
      }
    } else if (m.type === 'TRANSFER_IN' && m.refType === 'STOCK_TRANSFER') {
      // lot yang dikirim ikut pindah (juga saat kiriman dibatalkan dan kembali ke gudang asal)
      const pieces = await tx.execute<{ id: string; lot_no: string | null; expiry_date: string | null; received_date: string; qty_left: string }>(sql`
        SELECT id, lot_no, expiry_date, received_date, qty_left FROM stock_lot_transit
        WHERE ref_id = ${m.refId} AND product_id = ${m.productId} AND qty_left > 0
        ORDER BY expiry_date NULLS LAST, id FOR UPDATE`);
      let need = q;
      for (const p of pieces.rows) {
        if (need.lte(0)) break;
        const left = D(p.qty_left);
        const take = left.lt(need) ? left : need;
        await tx.execute(sql`
          INSERT INTO stock_lots (tenant_id, product_id, warehouse_id, lot_no, expiry_date, received_date, qty_received, qty_remaining, source_type, source_ref)
          VALUES (${m.tenantId}, ${m.productId}, ${m.warehouseId}, ${p.lot_no}, ${p.expiry_date}, ${p.received_date}, ${take.toFixed(4)}, ${take.toFixed(4)}, ${m.refType}, ${m.refId})`);
        await tx.execute(sql`UPDATE stock_lot_transit SET qty_left = ${qty4(left.minus(take)).toFixed(4)} WHERE id = ${p.id}`);
        need = need.minus(take);
      }
    }
    return;
  }

  const out = q.abs();
  // pembatalan penerimaan: hapus lot dari penerimaan itu (bukan lot lain yang kebetulan lebih dulu kedaluwarsa)
  if (m.reverseCost && m.refType === 'GOODS_RECEIPT_CANCEL') {
    await deplete(tx, m, out, sql`AND source_ref = ${m.refId} AND source_type = 'GOODS_RECEIPT'`, false);
    return;
  }
  if (m.lotId) {
    await deplete(tx, m, out, sql`AND id = ${m.lotId}`, false);
    return;
  }
  if (!DEPLETING.includes(m.type)) return;
  const exclude = m.excludeLotNos?.length ? sql`AND (lot_no IS NULL OR lot_no NOT IN (${sql.join(m.excludeLotNos.map((n) => sql`${n}`), sql`, `)}))` : sql``;
  await deplete(tx, m, out, exclude, m.type === 'TRANSFER_OUT');
}

async function deplete(tx: Tx, m: LotMove, out: Dec, extra: ReturnType<typeof sql>, toTransit: boolean) {
  const lots = await tx.execute<{ id: string; lot_no: string | null; expiry_date: string | null; received_date: string; qty_remaining: string }>(sql`
    SELECT id, lot_no, expiry_date, received_date, qty_remaining FROM stock_lots
    WHERE product_id = ${m.productId} AND warehouse_id = ${m.warehouseId} AND qty_remaining > 0 ${extra}
    ORDER BY expiry_date NULLS LAST, received_date, id FOR UPDATE`);
  let need = out;
  for (const l of lots.rows) {
    if (need.lte(0)) break;
    const have = D(l.qty_remaining);
    const take = have.lt(need) ? have : need;
    await tx.execute(sql`UPDATE stock_lots SET qty_remaining = ${qty4(have.minus(take)).toFixed(4)} WHERE id = ${l.id}`);
    // jejak keluar per lot (dasar penelusuran penarikan produk); pembatalan penerimaan bukan pengeluaran ke pihak lain
    if (m.refType !== 'GOODS_RECEIPT_CANCEL') {
      await tx.execute(sql`
        INSERT INTO stock_lot_issues (tenant_id, lot_id, product_id, warehouse_id, qty, move_type, ref_type, ref_id, date)
        VALUES (${m.tenantId}, ${l.id}, ${m.productId}, ${m.warehouseId}, ${take.toFixed(4)}, ${m.type}, ${m.refType}, ${m.refId}, ${m.date})`);
    }
    if (toTransit) {
      await tx.execute(sql`
        INSERT INTO stock_lot_transit (tenant_id, ref_id, product_id, lot_no, expiry_date, received_date, qty_left)
        VALUES (${m.tenantId}, ${m.refId}, ${m.productId}, ${l.lot_no}, ${l.expiry_date}, ${l.received_date}, ${take.toFixed(4)})`);
    }
    need = need.minus(take);
  }
}
