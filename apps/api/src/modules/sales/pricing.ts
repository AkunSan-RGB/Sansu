import { D, Dec, DecValue, money, ZERO } from '../../common/utils/money';

export interface PriceLineInput {
  qty: DecValue;
  price: DecValue;
  discountPct?: DecValue;
}

/** Nilai baris = qty x harga x (1 - diskon%), dibulatkan 2 desimal. */
export function lineTotal(l: PriceLineInput): Dec {
  const disc = D(l.discountPct);
  return money(D(l.qty).times(l.price).times(D(100).minus(disc)).div(100));
}

/** Subtotal (DPP), PPN, dan total dokumen. PPN dihitung dari subtotal, bukan per baris. */
export function documentTotals(lines: PriceLineInput[], ppnRate: DecValue) {
  const subtotal = lines.reduce<Dec>((a, l) => a.plus(lineTotal(l)), ZERO);
  const taxAmount = money(subtotal.times(ppnRate).div(100));
  return { subtotal, taxAmount, total: subtotal.plus(taxAmount) };
}

/**
 * Harga sudah termasuk PPN (harga rak kasir): total = jumlah baris; DPP = total × 100 / (100 + tarif),
 * PPN = total − DPP. Pembulatan diserap PPN agar total yang dibayar pembeli tetap sama dengan harga rak.
 */
export function inclusiveTotals(lines: PriceLineInput[], ppnRate: DecValue) {
  const total = lines.reduce<Dec>((a, l) => a.plus(lineTotal(l)), ZERO);
  const subtotal = money(total.times(100).div(D(100).plus(ppnRate)));
  return { subtotal, taxAmount: total.minus(subtotal), total };
}

/**
 * Dokumen penjualan dengan harga diinput termasuk PPN (penawaran / pesanan).
 * Tiap baris disimpan sebagai DPP agar faktur, retur, Coretax, dan laporan tetap memakai DPP:
 *  - DPP baris = bruto baris × 100/(100+tarif)
 *  - harga satuan DPP dibulatkan ke atas (2 desimal) agar qty × harga − diskon ≥ DPP baris
 *  - total dokumen = jumlah bruto (sama dengan yang dijanjikan ke pembeli); PPN = total − DPP
 */
export function inclusiveDocument<L extends PriceLineInput & { price: Dec }>(lines: L[], ppnRate: DecValue) {
  const r = D(100).plus(ppnRate);
  let total: Dec = ZERO;
  const out = lines.map((l) => {
    const gross = lineTotal(l);
    total = total.plus(gross);
    const net = money(gross.times(100).div(r));
    const effQty = D(l.qty).times(D(100).minus(D(l.discountPct))).div(100);
    const netPrice = effQty.gt(0) ? net.div(effQty).toDecimalPlaces(2, 0 /* ROUND_UP */) : money(l.price.times(100).div(r));
    return { ...l, priceInclVat: l.price, price: netPrice, lineTotal: net };
  });
  const subtotal = out.reduce<Dec>((a, l) => a.plus(l.lineTotal), ZERO);
  return { lines: out, subtotal, taxAmount: total.minus(subtotal), total };
}
