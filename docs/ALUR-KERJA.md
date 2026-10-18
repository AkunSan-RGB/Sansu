# Alur kerja operasional per jenis usaha

Menu **Alur kerja** menjalankan pipeline operasional yang berbeda untuk tiap jenis usaha. Satu *kasus* = satu proses dari awal sampai selesai
(mis. satu proyek jasa, satu order outlet). Definisi tahap ada di `shared/src/workflow.ts`; mesin yang menegakkannya di `backend/src/modules/workflow`.

## Alur per jenis usaha
| Jenis usaha | Alur | Tahap |
|---|---|---|
| Dagang | Penjualan | Pesanan masuk → Pesanan dikonfirmasi → Terkirim → Ditagih → Lunas |
| Dagang | Pembelian | Kebutuhan barang → Dipesan → Diterima → Tagihan masuk → Dibayar |
| Dagang | Retur penjualan dan retur pembelian | Pengajuan → Diperiksa gudang → Disetujui keuangan → Retur dicatat |
| Ritel | Restok toko | Stok menipis → Dipesan → Diterima → Tagihan masuk → Dibayar |
| Ritel | Shift kasir | Shift dibuka → Ditutup → Uang diperiksa (orang lain) → Disetor |
| Ritel | Retur pembelian | Pengajuan → Diperiksa gudang → Disetujui keuangan → Retur dicatat (retur penjualan ritel lewat kasir) |
| Jasa | Proyek jasa | Survei → Penawaran → Kontrak → Pengerjaan → Serah terima → Ditagih → Retensi → Selesai |
| Jasa | Pembelian / subkontraktor | Kebutuhan → Dipesan → Diterima → Tagihan masuk → Dibayar |
| FMCG | Order outlet | Order sales → Disetujui (kredit & promo) → Terkirim ke outlet → Ditagih → Lunas |
| FMCG | Kanvas (van sales) | Muat → Kunjungan → Setoran → Verifikasi orang lain |
| FMCG | Klaim prinsipal | Disusun → Diajukan → Disetujui prinsipal → Dana diterima |
| FMCG | Pembelian, retur penjualan, retur pembelian | seperti Dagang |
| Manufaktur | Produksi | Permintaan → Bahan siap → Produksi berjalan → QC → Barang jadi → Dikirim → Selesai (QC gagal kembali ke Produksi) |
| Manufaktur | Pengadaan bahan, retur pembelian | seperti Dagang (pembelian) |
| F&B | Pengadaan bahan | Kebutuhan bahan → Dipesan → Diterima → Tagihan masuk → Dibayar |
| F&B | Shift kasir | Shift dibuka → Ditutup → Uang diperiksa (orang lain) → Disetor |
| F&B | Retur pembelian | seperti Dagang |
| F&B | Pesanan online | Diterima → Diproses → Diantar → Dibayar/dicairkan |

Jenis usaha dikunci per perusahaan (lihat `ISOLASI-DATA.md`), jadi perusahaan hanya melihat dan memakai alur jenis usahanya; alur jenis lain ditolak server.

## Aturan yang ditegakkan server
- **Urutan**: kasus hanya maju ke tahap berikutnya yang sah; tidak bisa loncat. Mundur hanya oleh Admin/Pemilik dengan alasan.
- **Peran per tahap**: tiap tahap menyebut peran yang boleh memindahkan kasus ke sana (mis. penerimaan barang oleh Gudang, pelunasan oleh Keuangan). Pemilik selalu boleh.
- **Dokumen terkait yang nyata**: tahap tertentu mewajibkan dokumen (pesanan, faktur, penerimaan, proyek, sesi kasir, dst.) yang benar-benar ada di perusahaan ini dan tidak dibatalkan. Satu dokumen hanya boleh dipakai satu kasus.
- **Catatan / bukti**: tahap tertentu wajib catatan (nomor kontrak, nomor berita acara, hasil QC, hasil hitung uang, slip setoran).
- **Pemisahan fungsi (SoD)**: tahap pemeriksaan (uang kasir, QC, penerimaan, tagihan, serah terima, pelepasan retensi) tidak boleh dilakukan orang yang memindahkan kasus ke tahap saat ini (kecuali Pemilik).
- **Bukti di dokumen**: tahap yang bisa dibuktikan dari status dokumen (mis. faktur lunas, sesi kasir ditutup) tidak bisa diklaim manual tanpa bukti.
- **Otomatis**: saat daftar dibuka atau dokumen ditautkan, kasus maju sendiri selama bukti di dokumen sudah ada. Tahap yang butuh catatan/keputusan manusia tidak pernah dilompati.
- **Terkunci**: kasus selesai/dibatalkan tidak bisa diubah. Pembatalan wajib alasan dan hanya Admin/Pemilik.
- **Peringatan**: kasus macet melebihi batas hari tahap, tenggat lewat, atau dokumen terkait yang dibatalkan/hilang.
- **Jejak**: setiap langkah tercatat di riwayat kasus dan jejak audit. Data kasus terpisah per perusahaan (RLS + pengaman foreign key).

## Otomatisasi (tanpa perlu ada yang membuka kasus)
- **Kasus dibuka otomatis** dari dokumen baru: pesanan penjualan, pesanan pembelian, penawaran (Jasa), sesi kasir, perintah produksi, klaim prinsipal, kanvas, pesanan online F&B. Hanya dokumen yang dibuat sejak fitur ini pertama dipakai perusahaan (riwayat lama tidak dibanjiri); satu dokumen tidak pernah membuka dua kasus.
- **Restok otomatis**: barang yang posisi stoknya (gudang + sedang dipesan + sedang diminta) di bawah stok minimum membuka kasus restok, lengkap dengan saran jumlah dan pemasok terakhir (Dagang/Ritel/FMCG/Manufaktur/F&B/Jasa pembelian). Kasus yang belum dikerjakan ditutup sendiri bila stok pulih.
- **Dokumen turunan tertaut sendiri**: faktur dari pesanan, surat jalan, penerimaan barang, dan tagihan pemasok langsung masuk ke kasus yang sama; tahap maju bila buktinya sudah ada.
- Berjalan tiap 10 menit di server dan juga setiap kali daftar/kasus dibuka. Bisa dimatikan di *Pengaturan alur*.

## Penyesuaian per perusahaan (hanya memperketat)
Admin dapat mengatur di **Alur kerja → Pengaturan alur**: mempersempit peran suatu tahap, mewajibkan catatan, mewajibkan pemeriksa berbeda, memperpendek batas hari, dan mengganti nama tahap. Server menolak penyesuaian yang melonggarkan aturan bawaan (menambah peran, mematikan catatan/pemeriksa wajib, memperpanjang/menghapus batas hari). Perubahan tercatat di jejak audit.

## Alur wajib (opsional)
Bila dinyalakan, dokumen berisiko yang sudah punya kasus diperiksa terhadap tahapnya: **bayar tagihan pemasok** ditolak bila kasus dibatalkan atau belum sampai tahap *Diterima*; **mulai produksi** ditolak bila belum sampai *Bahan siap*; **selesaikan produksi** ditolak sebelum tahap *QC* (pemeriksaan mutu oleh orang lain); **kirim barang** ditolak bila pesanan belum disetujui atau piutang pelanggan melebihi batas kredit. Dokumen yang tidak punya kasus tidak dihalangi. Halaman pesanan, faktur, dan PO menampilkan lencana tahap alurnya.

## Peringatan tambahan
- **Batas kredit**: piutang pelanggan melebihi batas kredit saat kasus penjualan masih berjalan.
- **Selisih kas**: sesi kasir yang uangnya tidak sama dengan hitungan sistem.
- **Jual rugi**: baris faktur yang dijual di bawah harga pokok (harga, diskon, atau salah input).

## Batasan
- Alur membaca status dokumen di modul masing-masing dan hanya menegakkan di empat aksi berisiko (bayar tagihan pemasok, mulai dan selesaikan produksi, kirim barang); modul lain tetap memakai status dokumennya sendiri.
- Gerbang "alur wajib" untuk tagihan pemasok jarang menahan karena tagihan biasanya memerlukan penerimaan barang; ia terutama berguna bila kasus dibatalkan.
- Penyesuaian tahap belum bisa menambah/menghapus tahap atau mengubah urutan (sengaja, agar kontrol bawaan tidak bisa dilemahkan).
- Pesanan online F&B bergantung pada pesanan yang masuk lewat kanal yang sudah ada (kunci API/manual); tidak ada API resmi GoFood/GrabFood/ShopeeFood.
- Belum diuji pada pengguna nyata; tinjauan akuntan untuk tahap yang berkaitan dengan pembukuan masih diperlukan.
