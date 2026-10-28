import { D, Dec, money, ZERO } from '../../../common/utils/money';

export interface SplitLine {
  description: string;
  qty?: string;
  price: string;
}

/**
 * Pecah satu tagihan termin menjadi tagihan jalan (setelah dipotong retensi) dan jumlah retensi.
 * Harga tiap baris dikalikan (100 − retensi)%, dibulatkan 2 desimal; retensi = selisih total baris sebelum dan sesudah,
 * sehingga jumlah kedua tagihan persis sama dengan tagihan semula (tanpa selisih pembulatan di DPP).
 */
export function splitRetention<T extends SplitLine>(lines: T[], pct: string | Dec): { main: T[]; retention: Dec } {
  const r = D(pct);
  if (r.lte(0) || r.gte(100)) return { main: lines, retention: ZERO };
  let gross = ZERO;
  let net = ZERO;
  const main = lines.map((l) => {
    const qty = D(l.qty ?? '1');
    const price = money(l.price);
    const mainPrice = money(price.times(D(100).minus(r)).div(100));
    gross = gross.plus(money(qty.times(price)));
    net = net.plus(money(qty.times(mainPrice)));
    return { ...l, price: mainPrice.toFixed(2) };
  });
  return { main, retention: money(gross.minus(net)) };
}
