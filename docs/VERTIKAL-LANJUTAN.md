# Pendalaman per jenis usaha: SDM, CRM, Pembelian, Pajak

Ringkasan fitur yang membedakan modul inti menurut jenis usaha. Kode bersama (satu mesin), pembeda ada pada definisi dan aturan per jenis usaha.

## SDM — upah kerja (`shared/src/work-units.ts`, `backend/src/modules/payroll/service-work.ts`)
Mesin catatan kerja jasa (tarif → catatan → persetujuan orang lain → slip gaji) dipakai semua jenis usaha dengan satuan berbeda:

| Jenis usaha | Satuan upah |
|---|---|
| Jasa | per jam, per sesi, borongan, komisi % faktur jasa |
| Ritel, F&B | premi per shift (maks. 2 per hari), borongan |
| Manufaktur | per hasil (opsional dikaitkan ke perintah produksi; jumlah dibatasi keluarannya), borongan, shift |
| Dagang, FMCG | per hasil/koli, borongan gudang |

Catatan penting:
- Lembur karyawan bergaji tetap tetap lewat **Absensi** (jam lembur), bukan dari sini, supaya tidak terbayar dua kali.
- Upah ini tambahan di atas gaji pokok (mis. premi shift malam). Pegawai tetap non-Jasa tetap berstatus Tetap.
- Komisi sales FMCG sudah ada sendiri di *Target & komisi sales* (dengan jurnal dan PPh 21), tidak digandakan di sini.
- Antifraud sama dengan Jasa: nominal dari tarif (tidak diketik), pembuat ≠ penyetuju, tidak bentrok absensi, catatan kembar ditolak, dikunci setelah gaji diposting; tambahan: hasil per perintah produksi tidak boleh melebihi keluarannya.

## CRM (`shared/src/crm-profile.ts`)
Tahap pipeline bawaan, sumber prospek, dan alasan kalah berbeda per jenis usaha (Jasa: survei → penawaran → kontrak; FMCG: kunjungan → sampel → listing/PO pertama; F&B: pesanan besar/katering sampai DP; dst.). Semua berupa daftar tertutup (alasan lain: "Lainnya: …"). Aplikasi CRM tetap hanya menyala bawaan untuk Jasa (bagan akun kontrak/proyek mengikuti aplikasi ini); jenis usaha lain menyalakannya di menu Aplikasi. Tahap bawaan hanya dibuat untuk perusahaan yang belum punya tahap.

## Pembelian — kontrak harga (`backend/src/modules/purchasing/price-agreements.ts`)
Harga yang disepakati per barang dari pemasok/prinsipal untuk periode tertentu. Menu bernama menurut jenis usaha (FMCG: kontrak harga prinsipal; F&B: harga pemasok bahan; lainnya: kontrak harga pemasok; tidak tampil untuk Jasa).
- Kontrak baru berstatus menunggu dan baru berlaku setelah disetujui orang lain (Keuangan/Admin; Pemilik dikecualikan).
- Periode kontrak barang yang sama dari pemasok yang sama tidak boleh tumpang tindih; maksimal 3 tahun.
- PO (Rupiah) di atas harga kontrak aktif ditolak setelah diskon; Admin/Pemilik boleh melewati dengan jejak audit.
- Kontrak yang harganya >20% di atas harga beli terakhir ditandai.

## Pajak (`shared/src/tax-focus.ts`, `backend/src/modules/tax/tax-focus.ts`)
Kartu "Fokus pajak" di halaman Setoran Pajak: kewajiban yang umumnya relevan per jenis usaha, dan daftar periksa kelengkapan data dari data nyata: PPN masukan dari pemasok tanpa NPWP (barang), faktur jasa tanpa catatan potongan PPh (Jasa), PB1 (F&B), harga kasir dan PPN (Ritel/F&B), NPWP pembeli di faktur ber-PPN (Dagang/FMCG), potongan maklon (Manufaktur). Hanya memeriksa kelengkapan data; tidak menghitung kewajiban pajak. Default pajak per jenis usaha saat mendaftar (PB1 untuk F&B, harga kasir termasuk PPN untuk Ritel) sudah ada sebelumnya.

## Batasan
- Belum diuji pengguna nyata; aturan pajak dan PPh 21 untuk upah borongan/per hasil perlu ditinjau konsultan pajak.
- Pembelian F&B belum punya fitur khusus selain kontrak harga bahan (mis. pemasok bahan segar harian).
- SDM Ritel/F&B belum punya penjadwalan shift (roster); hanya premi per shift dari catatan kerja.

---

# Tahap berikutnya: jadwal shift, daftar belanja, barcode, penyetuju, kotak tugas

## Jadwal shift (Ritel, F&B, Manufaktur) — `backend/src/modules/hr/shifts.ts`
Templat shift (jam, minimal petugas, tarif premi dari kartu tarif per shift milik Keuangan) dan roster per pegawai per tanggal. Server menolak: bentrok jam, istirahat < 8 jam, > 2 shift per hari, > 6 hari berturut-turut, > 58 jam per minggu (peringatan di atas 40 jam), hari cuti yang disetujui, di luar masa kerja/kontrak, tanggal lampau. Pembuat jadwal tidak boleh menjadwalkan dirinya sendiri (Pemilik dikecualikan). **Premi shift otomatis** hanya muncul bila pegawai dijadwalkan DAN tercatat HADIR di Absensi; berstatus menunggu persetujuan Keuangan; satu penugasan satu premi (unik di database). Kekurangan petugas per shift ditandai.
Batasan: belum ada pertukaran shift antar pegawai, dan jam lembur tetap lewat Absensi.

## Daftar belanja harian — `backend/src/modules/purchasing/shopping-list.ts`
Barang di bawah stok minimum (memperhitungkan yang sedang dipesan/diminta) dikelompokkan per pemasok terakhir, dengan jumlah disarankan dan harga beli terakhir; satu klik membuat PO draf (tetap melewati persetujuan nilai besar dan kontrak harga saat dikonfirmasi). Peringatan **lonjakan harga**: harga beli terbaru > 10% di atas rata-rata 90 hari sebelumnya.

## Barcode otomatis — `shared/src/barcode.ts`
Barcode dibuat sistem (EAN-13 internal berawalan 2, urut per perusahaan, tahan balapan, unik) dan **tidak diketik**. Barcode pabrikan hanya diterima bila angka pemeriksanya valid (hasil scan; EAN-13/EAN-8/UPC-A) dan tidak berawalan 2. Barcode otomatis tidak bisa diubah; menggantinya dengan barcode pabrikan hanya sebelum ada mutasi stok. Admin bisa membuatkan barcode untuk produk lama (*Buat barcode otomatis*). Impor Excel memvalidasi barcode yang sama. Batasan: pemindai dan ketikan tidak bisa dibedakan server, jadi pengamannya adalah angka pemeriksa.

## Pilih penyetuju yang berwenang
Pemohon dapat menunjuk satu penyetuju dari daftar yang berwenang (Admin/Pemilik aktif, bukan dirinya). Setelah transaksi menunggu persetujuan, muncul dialog pilih penyetuju (bisa dilewati = semua penyetuju). Yang ditunjuk saja yang diberi tahu (Telegram/email) dan bisa memutuskan; Pemilik tetap berwenang; antrean penyetuju lain tidak memuatnya.

## Kotak tugas & notifikasi menurut pemisahan fungsi
- *Tugas saya* (menu teratas + lonceng + lencana di menu): hanya proses yang boleh diputuskan pengguna itu — persetujuan, permintaan pembelian, catatan upah kerja, perubahan data karyawan, kontrak harga, cuti, penggajian menunggu posting, dan kasus alur kerja. Yang dibuat sendiri tidak tampil (pembuat ≠ pemutus).
- Notifikasi proses (Telegram/email bila terhubung) dikirim ke peran yang harus bertindak, tidak ke pelakunya.
- *Sesuaikan menu*: setiap pengguna dapat menyembunyikan submenu yang tidak dipakai (preferensi pribadi, hak akses tidak berubah).
