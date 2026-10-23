# Wawasan & saran di Beranda

Panel "Wawasan & saran" di Beranda (Pemilik, Admin, Keuangan, Akuntan; tidak untuk akun yang dibatasi cabang). Isinya ringkasan kondisi, grafik penjualan dan laba kotor 6 bulan, dan kartu saran. **Saran bersifat masukan untuk dipertimbangkan, bukan keharusan**, dan dapat disembunyikan 7 hari per pengguna (disimpan di peramban).

API: `GET /dashboard/insights` (`backend/src/modules/dashboard/dashboard-insights.ts`; aturan murni dan teruji di `insight-rules.ts`).

## Cara kerja
Aturan **deterministik dan dapat dijelaskan**, bukan model AI dan bukan prediksi. Tiap kartu memuat judul, fakta berangka, nilai uang terkait, satu saran, dan tautan ke data. Penjualan, laba kotor, dan beban diambil dari **pembukuan** (kelompok akun yang sama dengan Laporan Laba Rugi); piutang/hutang dari faktur; stok dari saldo, lot, dan mutasi. Kegagalan satu pengumpul data dilewati tanpa mengganggu kartu lain. Maksimal 10 kartu, diurutkan menurut prioritas, dan sedikitnya satu "kabar baik" ikut tampil bila ada.

## Aturan dan ambang
| Kartu | Muncul bila | Nada |
|---|---|---|
| Kas & daya tahan | kas ÷ biaya rata-rata 3 bulan penuh (HPP + beban usaha): < 1 bln / < 3 bln = peringatan; 3–6 info; ≥ 6 kabar baik; kas ≤ 0 = peringatan | ⚠/ℹ/✓ |
| Tren penjualan | bulan berjalan dibanding periode yang sama bulan lalu; turun ≥ 15% peringatan, naik ≥ 15% kabar baik, ±10% diabaikan; butuh ≥ hari ke-5 dan ≥ 2 bulan berjualan; lonjakan > 4× dibaca "kali lipat" | ⚠/✓ |
| Margin kotor | turun ≥ 3 poin dari rata-rata 3 bulan sebelumnya (peringatan, dengan nilai laba yang tergerus) atau naik ≥ 3 poin | ⚠/✓ |
| Piutang lewat jatuh tempo | ada piutang jatuh tempo; ≥ 20% dari total = peringatan; menyebut 3 pelanggan terbesar dan rata-rata hari tagih | ⚠/ℹ |
| Hutang pemasok | jatuh tempo ≤ 14 hari ≥ 70% kas (mendesak) atau ada yang lewat jatuh tempo | ⚠ |
| Beban usaha naik | bulan lalu ≥ 120% rata-rata 3 bulan sebelumnya dan ≥ Rp1 juta; menyebut akun dengan kenaikan terbesar | ⚠ |
| Stok tidak bergerak | nilai stok tanpa penjualan/pemakaian selama jendela jenis usaha (≥ 60 hari) ≥ 5% nilai stok dan ≥ Rp1 juta; ≥ 15% peringatan | ⚠/ℹ |
| Kedaluwarsa | lot kedaluwarsa atau akan kedaluwarsa ≤ 30 hari | ⚠ |
| Stok minimum | produk di bawah stok minimum | ⚠ |
| Ketergantungan pelanggan | satu pelanggan ≥ 35% penjualan faktur 90 hari (≥ 3 pelanggan) | ⚠ |
| Pelanggan lama | pelanggan yang membeli 61–180 hari lalu tetapi tidak 60 hari terakhir, nilai ≥ Rp1 juta | peluang |
| Produk bermargin tipis | dari baris faktur 90 hari: margin < 5% dengan penjualan ≥ Rp500 ribu (atau 1% penjualan) | ⚠ |
| Produk andalan | 3 produk penyumbang laba kotor terbesar (butuh ≥ 6 produk berlaba) | peluang |

## Batas yang perlu diketahui
- Bukan prediksi dan bukan nasihat keuangan profesional; ambang bersifat umum, bukan kalibrasi per usaha.
- Margin produk memakai baris faktur saja (harga kasir sudah termasuk PPN sehingga tidak sebanding); penjualan kasir tetap ikut di angka penjualan, tren, dan produk andalan.
- Usaha yang baru mulai melihat sedikit kartu; data demo bisa memunculkan angka ekstrem karena riwayat bulanannya sengaja dipadatkan.
- Belum ada: perkiraan arus kas ke depan, perbandingan antar cabang, dan target/anggaran (sudah ada di modul Anggaran).
