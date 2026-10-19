/** Perkecil foto (sisi terpanjang maks. `maxSide` px) dan ubah ke data URL JPEG; kualitas diturunkan sampai muat di batas karakter server. */
export async function compressImage(file: File, maxSide = 1024, maxChars = 420_000): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung pengolahan gambar');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  for (const q of [0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  throw new Error('Foto terlalu besar; coba foto dengan resolusi lebih kecil');
}
