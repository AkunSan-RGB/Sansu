# Rencana: lokasi rak/bin untuk persediaan

Status: **rencana, belum dikerjakan.** Dokumen ini menjawab "persediaan bisa ditelusuri sampai rak mana?".

## 1. Kondisi sekarang
- Stok dicatat per **produk × gudang** (`stock_balances`, HPP rata-rata) dan per **lot/kedaluwarsa** (`stock_lots`, FEFO).
- Semua pergerakan stok lewat satu pintu: `StockService.move()` (`backend/src/modules/inventory/stock.service.ts`), yang juga mengisi `stock_moves` dan memicu jurnal persediaan.
- Opname (`stock_counts`) dan mutasi antar gudang (`stock_transfers`) bekerja di tingkat gudang.
- Tidak ada konsep rak/bin/zona. Solusi sementara: membuat gudang kecil per rak (tidak rapi di atas ±20 rak).

## 2. Prinsip desain
1. **Rak adalah lapisan lokasi, bukan lapisan nilai.** Pindah rak tidak mengubah kuantitas gudang, HPP, maupun jurnal. Risiko merusak pembukuan yang sudah teruji menjadi kecil.
2. **Invarian utama:** untuk gudang yang rak-nya aktif, `Σ stok semua rak = stock_balances.qty` per produk (dan per lot). Dijaga di kode, diuji acak, dan dicek di "Cek kesehatan".
3. **Aktif per gudang (opt-in).** Gudang tanpa rak berjalan persis seperti sekarang. Kasir ritel/F&B tidak terkena beban tambahan.
4. **Tidak ada stok "hilang"**: barang yang masuk tanpa rak ditaruh otomatis di rak sistem **BELUM-DITEMPATKAN**, dan laporan menandainya.
5. **Anti-kecurangan sejak awal** (lihat §5).

## 3. Model data (migrasi 0102 dst., semua dengan RLS + tenant guard)
- `warehouse_bins`: id, tenant_id, warehouse_id, kode (mis. `A-01-03`), zona, jenis (`SIMPAN` · `PENERIMAAN` · `STAGING` · `RUSAK` · `KARANTINA`), kapasitas opsional, aktif. Unik (tenant, gudang, kode). Satu rak sistem `BELUM-DITEMPATKAN` per gudang.
- `stock_bin_balances`: tenant_id, product_id, warehouse_id, bin_id, lot_id (boleh kosong), qty. CHECK qty ≥ 0.
- `bin_moves` (riwayat, tidak bisa diubah): dari_rak, ke_rak, produk, lot, qty, jenis (`PENEMPATAN` · `PINDAH` · `AMBIL` · `TERIMA` · `OPNAME`), rujukan dokumen, pelaku, waktu.
- `warehouses.bins_enabled` (boolean), `product_default_bins` (rak utama per produk per gudang, untuk saran penempatan).
- `stock_count_lines.bin_id` (opsional) agar opname bisa per rak.

## 4. Titik integrasi
| Alur | Perubahan |
|---|---|
| `StockService.move()` | Parameter opsional `binId`. Setelah stok gudang berubah, panggil `BinService.apply(tx, move)` di transaksi yang sama. Masuk tanpa rak → `BELUM-DITEMPATKAN`. Keluar tanpa rak → diambil otomatis mengikuti lot FEFO lalu rak terisi paling lama. |
| Penerimaan barang | Pilihan rak tujuan; saran = rak utama produk. |
| Penjualan/pengiriman | Daftar ambil (picking list) berurutan zona→rak, mengikuti FEFO. Ambil di luar saran boleh tetapi tercatat dengan alasan. |
| Mutasi antar gudang | Rak asal dan rak tujuan opsional. |
| Opname | Lembar hitung per rak; selisih diposting lewat penyesuaian yang sudah ada, lalu saldo rak ikut dikoreksi. |
| Retur/rusak | Otomatis ke rak jenis `RUSAK`/`KARANTINA` bila ada. |
| Migrasi data | Saat gudang diaktifkan: seluruh stok dan lot yang ada dimasukkan ke `BELUM-DITEMPATKAN`, lalu ditata bertahap. |

## 5. Kontrol anti-kecurangan
- Pindah barang bernilai besar antar rak, atau keluar dari rak `RUSAK`/`KARANTINA`, butuh **persetujuan orang lain** (mesin persetujuan yang ada; batas dari pengaturan).
- Penghitung opname ≠ pemosting selisih (sudah ada, diperluas ke rak).
- Pemindahan rak tidak boleh lewat tanpa jejak: setiap baris `bin_moves` menyimpan pelaku, dan tercatat di jejak audit.
- Laporan kontrol: barang lama di `BELUM-DITEMPATKAN`, rak dengan selisih opname berulang, ambil di luar saran FEFO, pindah rak berkali-kali oleh satu orang.
- Peran: gudang menata dan mengambil; hanya Admin/Keuangan yang mengaktifkan rak dan mengubah master rak.

## 6. Tahapan (satu PR per tahap)
1. **Dasar**: master rak, aktivasi per gudang, saldo rak, penempatan dan pindah rak manual, layar "Stok di rak" dan "Barang ini ada di rak mana", migrasi data awal, tes invarian.
2. **Integrasi alur**: penerimaan, picking list FEFO, mutasi gudang, retur/rusak.
3. **Opname per rak** + laporan kontrol §5 + persetujuan.
4. **Kemudahan lapangan**: label rak cetak (QR/barcode), pindai dari kamera HP, impor rak dari Excel.

Urutan target: **FMCG/Dagang dahulu** (gudang besar, ribuan SKU). Ritel dan F&B tetap nonaktif secara bawaan. Manufaktur menyusul bila ada permintaan.

## 7. Pengujian
- e2e: aktivasi gudang, barang masuk → rak sistem → ditata; pindah rak; keluar mengikuti FEFO; opname per rak; isolasi antar perusahaan; peran.
- Uji acak: urutan acak masuk/keluar/pindah, setelah tiap langkah `Σ rak = saldo gudang` dan tidak ada rak negatif.
- Tes regresi: gudang tanpa rak harus menghasilkan stok, HPP, dan jurnal **identik** dengan sebelumnya.
- Uji kinerja: `move()` pada gudang dengan rak tidak lebih dari ±15% lebih lambat.

## 8. Risiko dan cara menekan
| Risiko | Penanganan |
|---|---|
| Merusak jalur stok/HPP | Rak hanya mencatat lokasi; ada tes regresi identik; opt-in per gudang |
| Perlombaan (dua orang ambil rak yang sama) | Kunci baris dengan urutan yang sama seperti `stock_balances` |
| Data rak tidak disiplin di lapangan | Rak `BELUM-DITEMPATKAN` + laporan umur + opname per rak |
| Terlalu rumit untuk usaha kecil | Fitur tidak muncul sebelum gudang diaktifkan |
| Melebar jadi WMS penuh | Di luar cakupan: wave picking, optimasi slotting, RFID, bongkar-muat dermaga |

## 9. Di luar cakupan
Optimasi tata letak otomatis, penjadwalan tenaga gudang, integrasi alat pemindai khusus, hierarki lorong→level→posisi sebagai tabel terpisah (cukup kode `A-01-03` dengan kolom zona).

## 10. Hal yang perlu diputuskan pemilik
1. Apakah ada calon pelanggan yang benar-benar butuh rak? (jika tidak, tunda; kerjakan setelah pilot)
2. Lacak sampai **lot per rak** (disarankan untuk FMCG) atau cukup produk per rak?
3. Ambang persetujuan pindah rak (nominal).
