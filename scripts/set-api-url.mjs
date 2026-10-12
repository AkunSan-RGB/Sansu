#!/usr/bin/env node
/**
 * Mengganti alamat API di SEMUA berkas konfigurasi deploy tampilan web sekaligus
 * (vercel.json, frontend/vercel.json, netlify.toml).
 *
 *   npm run deploy:set-api -- https://sansu-api.onrender.com
 *
 * Boleh dijalankan ulang untuk pindah ke alamat API yang lain.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['vercel.json', 'frontend/vercel.json', 'netlify.toml'];
const PLACEHOLDER = 'https://GANTI-DENGAN-ALAMAT-API-ANDA.onrender.com';

const arg = (process.argv[2] ?? '').trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^\s/]+$/.test(arg)) {
  console.error('Pemakaian: npm run deploy:set-api -- https://alamat-api-anda  (tanpa garis miring & tanpa /api di akhir)');
  process.exit(1);
}

// Cari alamat yang sedang terpasang (placeholder atau alamat lama) di pola ".../api/..."
const pattern = /https?:\/\/[^\s"']+?(?=\/api\/(?::path\*|:splat))/g;
for (const f of files) {
  const p = join(root, f);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(pattern, arg);
  if (!after.includes(arg) && !before.includes(PLACEHOLDER)) {
    console.warn(`! ${f}: tidak ada aturan /api yang ditemukan`);
    continue;
  }
  writeFileSync(p, after);
  console.log(`✓ ${f}`);
}
console.log(`\nAlamat API sekarang: ${arg}\nCommit & push; Vercel/Netlify akan deploy ulang.`);
