import { D, Dec, DecValue, qty4 } from '../../common/utils/money';

/**
 * HPP rata-rata bergerak (moving average).
 * Barang masuk mengubah rata-rata; barang keluar memakai rata-rata saat itu.
 */
export function movingAverage(oldQty: DecValue, oldAvg: DecValue, inQty: DecValue, inCost: DecValue): Dec {
  const q0 = D(oldQty);
  const q1 = D(inQty);
  // Jika stok sebelumnya nol/negatif, rata-rata baru = biaya barang masuk
  if (q0.lte(0)) return qty4(inCost);
  const total = q0.plus(q1);
  if (total.isZero()) return qty4(oldAvg);
  return qty4(q0.times(oldAvg).plus(q1.times(inCost)).div(total));
}
