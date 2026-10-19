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

## Dagang — rute pengiriman dan harga per segmen (`backend/src/modules/sales/deliveries/delivery-trips.ts`)
Berlaku juga untuk FMCG dan Manufaktur (menu Penjualan › Rute pengiriman).
- **Rencana pengiriman:** satu rute = satu kendaraan dan pengemudi pada satu tanggal, membawa beberapa surat jalan. Nomor otomatis `RTE/…`.
- **Aturan:** hanya surat jalan terkirim (bukan batal) yang boleh dimasukkan, dan satu surat jalan hanya di satu rute yang masih berlaku (indeks unik di database); stop yang gagal boleh dijadwalkan ulang di rute lain. Susunan stop hanya bisa diubah selagi rute berstatus *Direncanakan*.
- **Urutan stop:** manual (naik/turun) atau otomatis dari titik terdekat memakai koordinat pelanggan; stop pertama menjadi titik awal, stop tanpa koordinat di belakang.
- **Alur status:** Direncanakan → Dalam perjalanan (berangkat, minimal satu stop) → Selesai (semua stop sudah diputuskan). Rute yang belum berangkat dapat dibatalkan dengan alasan.
- **Bukti terima:** stop terkirim wajib memuat nama penerima, stop gagal wajib memuat alasan; hasil yang sudah dicatat tidak bisa diubah. Semuanya tercatat di jejak audit.
- **Kontrol:** surat jalan hari sebelumnya yang belum dijadwalkan, rute berangkat yang belum selesai, dan stop gagal yang belum dijadwalkan ulang muncul sebagai peringatan di halaman rute.
- **Peran:** Admin dan Gudang membuat dan menjalankan rute (Pemilik selalu boleh); Keuangan, Sales, dan Akuntan hanya melihat.
- **Daftar harga per segmen** (sebelumnya hanya FMCG) kini juga tersedia untuk Dagang: grosir, toko, atau proyek dapat memiliki harga berbeda; pelanggan menunjuk satu daftar harga dan pesanan memakainya otomatis. Promo dan bonus barang tetap khusus FMCG.
- **Kendaraan & kapasitas:** daftar kendaraan (plat, kapasitas kg, pengemudi bawaan) di tombol *Kendaraan*. Muatan = jumlah (qty × berat produk per satuan dasar) surat jalan yang belum gagal. Muatan melebihi kapasitas memblok keberangkatan; hanya Pemilik/Admin yang dapat mengizinkan, dengan alasan tertulis yang masuk jejak audit. Produk tanpa berat dihitung 0 kg dan diberi peringatan. Hanya berat (bukan volume).
- **Jarak jalan:** bila `ROUTING_URL` diisi (server kompatibel OSRM, disarankan dipasang sendiri; server demo publik tidak untuk produksi) urutan dan jarak memakai jarak jalan; bila kosong/gagal otomatis garis lurus dan ditandai.
- **Lokasi petugas:** tombol *Bagikan lokasi* mengirim posisi terakhir (maks. tiap 45 detik) selagi rute berjalan; server hanya menyimpan posisi terakhir, tanpa riwayat.
- **Bukti:** saat terkirim, lokasi perangkat dibandingkan dengan koordinat pelanggan (> 300 m diberi tanda dan muncul di kontrol), plus foto (dikompres) dan tanda tangan opsional. Disimpan sebagai gambar di database (dibatasi ukurannya); tampil lewat *Lihat bukti* dengan pembatasan peran.
- **Belum ada:** pelacakan terus-menerus dengan riwayat jalur, kapasitas berdasarkan volume, dan penyimpanan bukti di penyimpanan objek terpisah.

## Utilitas — impor/API meter, petugas lapangan, loket (`backend/src/modules/utility/utility-field.module.ts`)
Semua jalur masuk angka meter (input manual, lapangan, impor, API) berakhir sebagai pencatatan **menunggu verifikasi** lewat aturan yang sama: angka tidak turun kecuali meter diganti, satu periode satu pencatatan, tanda janggal, verifikasi oleh orang lain. Tidak ada jalur yang langsung menjadi tagihan.
- **Impor CSV** (tab *Impor & alat meter*): tempel `nomor_sambungan, angka` (maks. 500 baris); tiap baris gagal sendiri-sendiri dengan alasan.
- **Kunci API alat meter:** Admin/Pemilik membuat kunci (hanya hash tersimpan, tampil sekali). Alat mengirim `POST /api/ingest/utility/readings` dengan header `X-Api-Key`; kunci hanya bisa mengirim angka, dibatasi laju, dan dicabut kapan saja. Pencatat tercatat atas nama pembuat kunci, sehingga verifikasi tetap harus orang lain.
- **Petugas lapangan** (tab *Petugas lapangan*, layout HP): daftar sambungan yang belum dicatat, lokasi perangkat dan foto meter (dikompres) ikut tersimpan. Lokasi > 500 m dari koordinat pelanggan menandai pencatatan *Dicatat jauh dari lokasi pelanggan* — pemeriksa wajib menulis catatan. Foto tidak ikut daftar; dibuka lewat endpoint khusus.
- **Loket (tunai):** cari tagihan utilitas, terima pembayaran memakai alur pelunasan faktur yang ada (jurnal Kas/Piutang dan persetujuan pemisahan fungsi tetap berlaku) dan dicatat sebagai penerimaan milik petugas. Petugas menyetor total tunai harian; selisih dengan hitungan fisik wajib dijelaskan; setoran dikonfirmasi/disengketakan **orang lain** (Pemilik dikecualikan). Kontrol: pembayaran bertanda Loket tanpa catatan penerimaan, penerimaan > 1 hari belum disetor, setoran > 2 hari belum dikonfirmasi, setoran berselisih. Semua tercatat di jejak audit.
- **Batasan:** tidak ada integrasi perangkat keras/protokol meter pintar tertentu (alat harus mampu memanggil API di atas); loket hanya tunai (QRIS/transfer lewat pelunasan biasa); setoran adalah pencocokan kas fisik dan tidak membuat jurnal pemindahan ke bank (catat lewat Kas & Bank); foto disimpan sebagai gambar di database dengan batas ukuran; loket memerlukan peran Admin/Keuangan.
