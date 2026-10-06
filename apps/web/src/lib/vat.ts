import type { Me } from '@sansu/shared';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tarif PPN keluaran efektif: 0 bila perusahaan belum PKP */
export function outputVatRate(me?: Pick<Me, 'ppnRate' | 'taxProfile'> | null): number {
  if (me?.taxProfile && !me.taxProfile.pkp) return 0;
  return Number(me?.ppnRate ?? 11);
}

/**
 * Total dokumen dari jumlah baris.
 *  - inclusive=false: PPN ditambahkan di atas subtotal
 *  - inclusive=true : harga sudah termasuk PPN → DPP = total × 100/(100+tarif), PPN = total − DPP
 * Sama persis dengan perhitungan server (sales/pricing.ts).
 */
export function vatTotals(lineSum: number, rate: number, inclusive = false) {
  if (inclusive) {
    const total = r2(lineSum);
    const subtotal = r2((total * 100) / (100 + rate));
    return { subtotal, tax: r2(total - subtotal), total };
  }
  const subtotal = r2(lineSum);
  const tax = Math.round(subtotal * rate) / 100;
  return { subtotal, tax, total: r2(subtotal + tax) };
}
