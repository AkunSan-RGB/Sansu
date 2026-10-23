/** Isi kode QR label rak: `RAK:<kode gudang>:<kode rak>`. Pemindai (kamera atau alat keyboard) bisa juga memberi kode rak polos. */
export const buildBinQr = (warehouseCode: string, binCode: string) => `RAK:${warehouseCode}:${binCode}`;

export interface ScannedBin {
  warehouseCode?: string;
  code: string;
}

/** Baca hasil pindai: format label `RAK:GUDANG:KODE` atau kode rak polos; huruf dibesarkan, spasi di ujung dibuang */
export function parseBinScan(text: string): ScannedBin | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^RAK:([^:]+):(.+)$/i.exec(t);
  if (m) return { warehouseCode: m[1].trim().toUpperCase(), code: m[2].trim().toUpperCase() };
  return { code: t.toUpperCase() };
}

/** Cocokkan hasil pindai ke daftar rak satu gudang; kembalikan pesan galat bila tidak cocok */
export function resolveBin<T extends { code: string }>(scan: string, warehouseCode: string, bins: T[]): { bin?: T; error?: string } {
  const p = parseBinScan(scan);
  if (!p) return { error: 'Kode rak kosong' };
  if (p.warehouseCode && p.warehouseCode !== warehouseCode.toUpperCase()) return { error: `Label ini milik gudang ${p.warehouseCode}, bukan ${warehouseCode}` };
  const bin = bins.find((b) => b.code.toUpperCase() === p.code);
  return bin ? { bin } : { error: `Rak ${p.code} tidak ditemukan di gudang ini` };
}
