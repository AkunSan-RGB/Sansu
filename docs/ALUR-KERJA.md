# Alur kerja operasional per jenis usaha

Menu **Alur kerja** menjalankan pipeline operasional yang berbeda untuk tiap jenis usaha. Satu *kasus* = satu proses dari awal sampai selesai
(mis. satu proyek jasa, satu order outlet). Definisi tahap ada di `shared/src/workflow.ts`; mesin yang menegakkannya di `backend/src/modules/workflow`.

## Alur per jenis usaha
| Jenis usaha | Alur | Tahap |
|---|---|---|
| Dagang | Penjualan | Pesanan masuk → Pesanan dikonfirmasi → Terkirim → Ditagih → Lunas |
| Dagang | Pembelian | Kebutuhan barang → Dipesan → Diterima → Tagihan masuk → Dibayar |
| Ritel | Restok toko | Stok menipis → Dipesan → Diterima → Tagihan masuk → Dibayar |
| Ritel | Shift kasir | Shift dibuka → Ditutup → Uang diperiksa (orang lain) → Disetor |
| Jasa | Proyek jasa | Survei → Penawaran → Kontrak → Pengerjaan → Serah terima → Ditagih → Retensi → Selesai |
| FMCG | Order outlet | Order sales → Disetujui (kredit & promo) → Terkirim ke outlet → Ditagih → Lunas |
| FMCG | Klaim prinsipal | Disusun → Diajukan → Disetujui prinsipal → Dana diterima |
| Manufaktur | Produksi | Permintaan → Bahan siap → Produksi berjalan → QC → Barang jadi → Dikirim → Selesai (QC gagal kembali ke Produksi) |
| F&B | Pengadaan bahan | Kebutuhan bahan → Dipesan → Diterima → Tagihan masuk → Dibayar |
| F&B | Shift kasir | Shift dibuka → Ditutup → Uang diperiksa (orang lain) → Disetor |

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

## Batasan
- Kasus dibuka manual (bukan otomatis untuk setiap dokumen); dokumen ditautkan lewat daftar pilihan.
- Alur bawaan per jenis usaha; perusahaan belum bisa mengubah tahapnya sendiri.
- Alur belum menggantikan status dokumen di masing-masing modul — keduanya berjalan berdampingan dan alur membaca status dokumen.
- Pipeline lain (mis. pesanan online F&B, kanvas FMCG, retur) dapat ditambahkan di `workflow.ts` tanpa mengubah mesin.
