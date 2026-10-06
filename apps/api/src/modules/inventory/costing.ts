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

export interface CostLayer {
  id: string;
  qty: DecValue;
  unitCost: DecValue;
}

/**
 * Konsumsi lapisan biaya MPKP/FIFO: barang keluar diambil dari lapisan paling lama.
 * `layers` harus sudah terurut dari yang paling lama. Mengembalikan biaya total yang dibebankan dan sisa tiap lapisan.
 */
export function consumeLayers(layers: CostLayer[], outQty: DecValue): { cost: Dec; remaining: { id: string; qty: Dec }[]; shortfall: Dec } {
  let need = D(outQty);
  let cost = D(0);
  const remaining: { id: string; qty: Dec }[] = [];
  for (const l of layers) {
    const q = D(l.qty);
    if (need.lte(0)) {
      remaining.push({ id: l.id, qty: q });
      continue;
    }
    const take = q.lt(need) ? q : need;
    cost = cost.plus(take.times(l.unitCost));
    need = need.minus(take);
    remaining.push({ id: l.id, qty: q.minus(take) });
  }
  return { cost, remaining, shortfall: need.gt(0) ? need : D(0) };
}
