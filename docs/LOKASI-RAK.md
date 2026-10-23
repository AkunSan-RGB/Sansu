# Lokasi rak gudang (tahap 1)

Rencana lengkap ada di `docs/RENCANA-LOKASI-RAK.md`. Dokumen ini menjelaskan yang **sudah ada** di tahap 1.

## Yang bisa dilakukan
- Aktifkan lokasi rak **per gudang** (Persediaan › Rak gudang; Admin/Keuangan). Gudang tanpa rak berjalan persis seperti sebelumnya.
- Buat rak (kode seperti `A-01-03`, zona, jenis `Simpan`/`Penyiapan`/`Rusak`/`Karantina`), termasuk pembuatan deret otomatis.
- Stok awal gudang disalin ke rak sistem `BELUM-DITEMPATKAN`, lalu ditata dengan **Pindahkan antar rak** (bisa sebagian, per lot).
- Cari "barang ini ada di rak mana" (kode, nama, atau barcode), lengkap dengan lot dan kedaluwarsa.
- Riwayat setiap perpindahan (siapa, kapan, dari/ke rak, catatan) dan pemeriksaan konsistensi.

## Cara kerja
- Rak adalah **lapisan lokasi**. `StockService.move()` tetap satu-satunya pintu mutasi stok; setelah stok gudang dan lot diperbarui, `trackBins()` (di `modules/inventory/bin-tracker.ts`) mencatat letaknya pada transaksi yang sama. Kuantitas gudang, HPP, dan jurnal tidak disentuh.
- Barang masuk tanpa rak tujuan → `BELUM-DITEMPATKAN`. Barang keluar → diambil dari rak simpan, lalu `BELUM-DITEMPATKAN`, lalu rak rusak/karantina (lot mengikuti FEFO seperti biasa).
- Transfer antar gudang, retur, pembatalan penerimaan, dan QC ikut tercatat; lot yang ikut berpindah juga ikut berpindah rak.
- **Invarian**: Σ stok semua rak = stok gudang, per barang dan per lot. Dijaga di kode, diuji acak, dan terlihat di tab Pemeriksaan. Bila suatu saat selisih, transaksi stok tidak diblokir (stok gudang tetap benar); selisih hanya terlihat sebagai temuan.

## Kontrol
- Mengeluarkan stok dari rak **rusak/karantina** hanya Pemilik/Admin; memindah ke rak itu boleh Gudang dan menyertakan catatan.
- Menonaktifkan rak gudang atau satu rak diblokir selama masih ada stok di rak (kecuali `BELUM-DITEMPATKAN`).
- Riwayat pindah rak tidak dapat diubah atau dihapus (trigger database), dan tercatat di jejak audit.
- Semua tabel dilindungi RLS per perusahaan; gudang yang dibatasi per pengguna tetap berlaku.

## Tahap 2: alur dan daftar ambil
- **Pilihan rak** (opsional) pada penerimaan barang dari PO, penyesuaian stok (masuk: rak tujuan; keluar: rak yang diutamakan), dan transfer gudang (rak asal; rak tujuan untuk kirim langsung atau saat diterima). Rak harus milik gudang yang bersangkutan dan aktif; pilihan yang salah menolak seluruh dokumen. Kosong = otomatis seperti tahap 1.
- **Daftar ambil** (`GET /inventory/bins/pick-plan`): dari sisa pesanan penjualan yang belum dikirim atau daftar ketikan. Urutan: lot paling cepat kedaluwarsa (FEFO), rak yang dikurangi sistem (simpan/penyiapan, lalu BELUM-DITEMPATKAN; rak rusak/karantina dilewati), lalu diurutkan menurut zona dan kode rak agar petugas berjalan searah. Kekurangan stok dilaporkan. Dapat dicetak.
- Urutan pengambilan di pembukuan (`takeFrom`) dan di daftar ambil memakai ketentuan yang sama (`BIN_PICK_TIER`), sehingga rak yang disarankan = rak yang berkurang.
- Pembatalan surat jalan mengembalikan barang ke BELUM-DITEMPATKAN (bukan rak asal); tata ulang lewat Pindah rak.

## Belum ada (tahap berikutnya)
Stock opname per rak, persetujuan pindah bernilai besar, laporan kontrol (barang lama belum ditata, dsb.), label rak QR/barcode, pindai lewat HP, impor rak dari Excel, dan pilihan rak di jalur terima-dan-faktur sekaligus.

## Berkas
Migrasi `0102_lokasi_rak.sql`; `backend/src/modules/inventory/bin-tracker.ts`, `bins.ts`; hook di `stock.service.ts`, `stock-lots.ts` (mengembalikan perubahan lot), `production/qc.ts`; tes `backend/test/lokasi-rak.e2e-spec.ts`; tampilan `frontend/src/features/inventory/BinsPage.tsx`.
