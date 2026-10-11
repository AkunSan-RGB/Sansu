import { roundVat } from '../../modules/sales/pricing';
import type { VatRounding } from '@sansu/shared';
import { D, Dec, DecValue, money, ZERO } from './money';

export interface ForeignLineIn {
  /** Nilai baris dalam mata uang dokumen (qty × harga × (1 − diskon)) */
  lineForeign: Dec;
}

/** Rupiah dari nilai valas pada kurs tertentu, dibulatkan 2 desimal */
export const toIdr = (foreign: DecValue, rate: DecValue): Dec => money(D(foreign).times(rate));

/**
 * Dokumen valas: tiap baris dikonversi ke Rupiah (DPP = jumlah baris rupiah); PPN dihitung dari DPP rupiah (kurs transaksi, seperti
 * ketentuan PPN yang wajib dalam Rupiah), lalu PPN valas = PPN rupiah ÷ kurs agar pembeli membayar DPP + PPN dalam valas.
 */
export function foreignTotals(lineForeign: Dec[], rate: DecValue, ppnRate: DecValue, rounding: VatRounding = 'NONE') {
  const lineIdr = lineForeign.map((f) => toIdr(f, rate));
  const subtotalIdr = lineIdr.reduce<Dec>((a, l) => a.plus(l), ZERO);
  const taxIdr = roundVat(money(subtotalIdr.times(ppnRate).div(100)), rounding);
  const subtotalForeign = lineForeign.reduce<Dec>((a, l) => a.plus(l), ZERO);
  const taxForeign = money(taxIdr.div(rate));
  return { lineIdr, subtotalIdr, taxIdr, totalIdr: subtotalIdr.plus(taxIdr), subtotalForeign, taxForeign, totalForeign: subtotalForeign.plus(taxForeign) };
}

/**
 * Nilai retur dalam mata uang faktur. Retur mengurangi piutang/utang Rupiah pada nilai faktur (kurs faktur); sisi valasnya
 * = nilai Rupiah ÷ kurs faktur, dan retur yang menuntaskan faktur mengambil seluruh sisa valas agar saldo valas tepat nol.
 */
export function returnForeign(p: { returnIdr: Dec; totalIdr: DecValue; paidIdr: DecValue; returnedIdr: DecValue; totalForeign: DecValue; paidForeign: DecValue; returnedForeign: DecValue; rate: DecValue }) {
  const remaining = D(p.totalForeign).minus(p.paidForeign).minus(p.returnedForeign);
  const done = D(p.paidIdr).plus(p.returnedIdr).plus(p.returnIdr).gte(D(p.totalIdr).minus(0.005));
  if (done) return remaining;
  const part = money(p.returnIdr.div(p.rate));
  return part.gt(remaining) ? remaining : part;
}

/**
 * Pelunasan sebagian/penuh faktur valas. `carrying` = nilai Rupiah piutang/utang yang dilunasi (kurs faktur; pelunasan terakhir
 * mengambil seluruh sisa agar saldo Rupiah tepat nol); `cash` = uang yang benar-benar diterima/dibayar (kurs hari bayar).
 */
export function settleForeign(p: { amountForeign: Dec; outstandingForeign: Dec; outstandingIdr: Dec; invoiceRate: DecValue; payRate: DecValue }) {
  const final = p.amountForeign.gte(p.outstandingForeign);
  const carrying = final ? p.outstandingIdr : money(p.amountForeign.times(p.invoiceRate));
  const cash = toIdr(p.amountForeign, p.payRate);
  return { final, carrying, cash, diff: cash.minus(carrying) };
}
