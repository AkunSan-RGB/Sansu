/**
 * Barcode produk. Dibuat sistem (EAN-13 internal) agar tidak ada ketikan manual yang salah atau kembar; barcode pabrikan
 * hanya diterima bila angka pemeriksanya benar (hasil scan) dan tidak memakai awalan "2" yang dicadangkan untuk pemakaian internal toko.
 */
export const INTERNAL_BARCODE_PREFIX = '2';

/** Angka pemeriksa GS1 untuk deretan digit (tanpa angka pemeriksa), panjang 7, 11, atau 12 */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  const rev = [...digits].reverse();
  rev.forEach((d, i) => {
    sum += Number(d) * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10;
}

/** EAN-13, EAN-8, atau UPC-A dengan angka pemeriksa benar */
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/** Barcode internal toko: "2" + nomor urut 11 digit + angka pemeriksa (EAN-13) */
export function internalBarcode(seq: number): string {
  const base = `${INTERNAL_BARCODE_PREFIX}${String(seq).padStart(11, '0')}`;
  return base + gs1CheckDigit(base);
}

export const isInternalBarcode = (code: string) => code.length === 13 && code.startsWith(INTERNAL_BARCODE_PREFIX) && isValidBarcode(code);
