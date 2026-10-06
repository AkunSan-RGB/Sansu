# Pengujian & kontrol integritas

SANSU diuji berlapis. Semua tes e2e berjalan pada **PostgreSQL 18** sungguhan (bukan tiruan), karena transaksi,
penguncian baris, dan `uuidv7()` adalah bagian dari perilaku yang diuji.

```bash
npm run db:up                       # PostgreSQL 18 (Docker)
npm test                            # unit (api, web)
npm run test:e2e                    # e2e api: mereset dan memigrasi database `akurata_test` lalu menjalankan semua
```

## Lapisan

| Lapisan | Berkas | Yang dijaga |
| --- | --- | --- |
| Unit | `*.spec.ts` | Aturan murni: PPh 21 TER, PTKP, Pasal 17/31E, penyusutan, tenggat pajak, ukuran usaha UMKM, ambang pajak, NPWP |
| Alur bisnis e2e | `test/*.e2e-spec.ts` | Siklus penuh jual-beli-stok-kas-pajak-gaji per fitur |
| **Uji acak invarian** | `integrity-fuzz` | Ratusan operasi campuran; hukum pembukuan tidak pernah dilanggar |
| **Penyisiran rute** | `garbage-input`, `input-bounds` | Masukan sembarang ke semua rute tidak pernah menghasilkan 5xx |
| **Isolasi & hak akses** | `security`, `role-access` | Perusahaan lain tidak bisa membaca/mengubah data; peran hanya melihat yang perlu |
| **Konkurensi** | `concurrency` | Permintaan serentak tidak melanggar pembukuan |
| Jejak audit | `journal-immutable` | Jurnal terposting tidak bisa diubah/dihapus (trigger database) |
| Kalender pajak & PPN | `tax-calendar-vat` | Tenggat digeser ke hari kerja berikutnya; pembulatan PPN ke rupiah penuh |
| Bagan akun per jenis usaha | `coa-per-model` | Akun khusus, nama inti, dan akun tidak relevan per jenis usaha; nama buatan pengguna tidak tertimpa |
| Saldo awal | `opening-balance` | Akun kontrol (piutang, utang, persediaan, penyeimbang) tidak bisa diisi manual; ringkasan kesiapan dan peringatan |

## Uji acak invarian

Menjalankan urutan operasi acak berbenih tetap: pembelian, penjualan, pembayaran, retur, penyesuaian dan transfer
stok, kasir, jurnal manual dan pembaliknya, tagihan, aset dan penyusutan, produksi, penggajian, setoran pajak,
dokumen bertanggal mundur, lalu tutup buku tahun lalu. Setelah **setiap langkah** diperiksa langsung di database:

- setiap jurnal seimbang (debit = kredit); neraca saldo dan persamaan akuntansi seimbang
- piutang dan utang di buku besar = saldo dokumen (faktur penjualan / pembelian)
- persediaan di buku besar (1-1400) = nilai stok; persediaan dalam perjalanan (1-1410) nol bila tidak ada transfer berjalan
- stok tidak negatif; pembayaran + retur tidak melebihi tagihan; status dokumen konsisten
- tidak ada respons 5xx; penolakan bisnis (4xx) wajar
- di akhir: tidak ada cek kesehatan berstatus ERROR; setelah tutup buku, akun sementara tahun itu nol tetapi
  laporan tahun itu tetap terbaca dan neraca akhir tahun seimbang

```bash
# ulangi satu temuan persis
FUZZ_SEED=1013 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
# kampanye besar
FUZZ_SEEDS=$(seq -s, 3001 3040) FUZZ_STEPS=150 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
# lihat alasan penolakan bisnis per jenis operasi
FUZZ_WHY=1 FUZZ_SEED=101 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
```

Tes ini menggunakan database `akurata_test`; jangan diarahkan ke database berisi data nyata.

## Menambah fitur

- **Rute baru otomatis ikut teruji** oleh `security` (isolasi perusahaan) dan `garbage-input` (masukan sembarang).
  Bila sebuah rute memang harus dikecualikan, jelaskan alasannya di daftar `SKIP` pada tes tersebut.
- Bila fitur membuat jurnal, tambahkan operasinya ke `integrity-fuzz` agar invariannya ikut dijaga.
- Aturan perpajakan taruh sebagai **fungsi murni** di `packages/shared` (contoh: `taxDueDate`, `recommendProfile`,
  `evaluateThresholds`) lalu uji pada nilai batas: tepat di batas, satu rupiah di atas, dan pergantian tahun.
- Data sensitif per peran: tambahkan `@Roles(...)` pada rute dan masukkan ke `role-access`.

## Catatan

- Aturan yang bergantung pada peraturan (tarif, tenggat, batas) diberi rujukan di komentar kode. Peraturan berubah:
  tinjau ulang bersama konsultan pajak secara berkala, terutama tabel TER, batas upah BPJS, dan aturan PPh final.
- Tenggat yang jatuh di akhir pekan digeser otomatis; hari libur nasional dan cuti bersama diisi pengguna di Pengaturan perusahaan tiap tahun (tidak ditanam di kode karena berubah-ubah).
