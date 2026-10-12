const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function words(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`;
  if (n < 200) return `seratus ${words(n - 100)}`;
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`;
  if (n < 2000) return `seribu ${words(n - 1000)}`;
  if (n < 1e6) return `${words(Math.floor(n / 1000))} ribu ${words(n % 1000)}`;
  if (n < 1e9) return `${words(Math.floor(n / 1e6))} juta ${words(n % 1e6)}`;
  if (n < 1e12) return `${words(Math.floor(n / 1e9))} miliar ${words(n % 1e9)}`;
  return `${words(Math.floor(n / 1e12))} triliun ${words(n % 1e12)}`;
}

/** 1250500 → "Satu juta dua ratus lima puluh ribu lima ratus rupiah" (sen diabaikan) */
export function terbilang(value: number | string): string {
  const n = Math.floor(Math.abs(Number(value) || 0));
  const w = n === 0 ? 'nol' : words(n).replace(/\s+/g, ' ').trim();
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} rupiah`;
}
