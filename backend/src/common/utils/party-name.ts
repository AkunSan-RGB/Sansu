/** Kunci perbandingan nama pemasok/pelanggan: huruf kecil, tanpa bentuk badan usaha, tanda baca, dan spasi */
export function partyNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pt|cv|ud|pd|tbk|toko|firma|koperasi|persero)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}
