# Penggajian usaha jasa

Usaha jasa dibayar dengan banyak cara: per jam (konsultan, tutor), per sesi (terapis, instruktur), borongan per pekerjaan
(teknisi, desainer) atau komisi dari faktur jasa. Fitur ini hanya aktif untuk jenis usaha **Jasa** (menu Penggajian →
**Upah jasa**). Gaji tetap, BPJS, lembur dan PPh 21 tetap lewat alur penggajian biasa.

## Alur
1. **Tarif** (Keuangan/Admin): kartu tarif per jam / sesi / borongan / komisi %. HR tidak bisa mengubah tarif.
2. **Catatan kerja** (HR): pilih pegawai, tarif, tanggal, jumlah (atau faktur jasa untuk komisi), proyek (opsional). Nominal dihitung server dari tarif dan disalin ke catatan — mengubah tarif kemudian tidak mengubah catatan lama.
3. **Persetujuan** (Keuangan/Admin, orang lain dari pembuatnya): hanya yang disetujui yang dibayar.
4. **Otomatis masuk gaji**: saat penggajian bulan itu dibuat atau dihitung ulang, catatan yang disetujui (tanggal kerja ≤ akhir periode) masuk kolom *Upah jasa* di slip. Catatan yang disetujui setelah gaji dihitung masuk gaji berikutnya (tidak menyelinap ke slip yang sudah dihitung).
5. **Biaya proyek**: catatan berproyek menjadi biaya langsung proyek saat gaji diposting (laba per proyek, rekonsiliasi fiskal). Gaji tetap pegawai yang ditempatkan di proyek dihitung tanpa upah jasa ini, jadi tidak dobel.

## Pencegahan kecurangan
| Risiko | Pencegahan |
|---|---|
| Mengetik nominal sembarang | Nominal hanya dari kartu tarif × jumlah; HR tidak punya akses ubah tarif |
| Mencatat dan menyetujui sendiri | Pembuat ≠ penyetuju (Pemilik dikecualikan); pegawai tidak mencatat/menyetujui upahnya sendiri (akun pegawai ditautkan di data pegawai) |
| Jam fiktif / berlebihan | Maksimal 16 jam per hari per pegawai, 16 jam per catatan; peringatan > 260 jam sebulan |
| Tanggal palsu | Tidak boleh masa depan, tidak lebih dari 62 hari ke belakang, tidak sebelum bergabung / setelah keluar |
| Bentrok absensi | Ditolak bila absensi hari itu Sakit/Izin/Cuti/Alpa/Libur; peringatan bila absensi diubah belakangan |
| Catatan kembar | Catatan yang sama persis ditolak |
| Komisi fiktif / ganda | Hanya dari faktur jasa **lunas**, tidak dibatalkan, tanpa retur, bukan saldo awal; sekali per pegawai per faktur; total persen satu faktur ≤ 100%; komisi tertahan otomatis bila faktur kemudian dibatalkan/diretur sebelum digaji |
| Mengubah setelah dibayar | Catatan terkunci setelah gaji diposting; saat posting, total catatan dicocokkan lagi dengan slip — selisih menolak posting sampai "Hitung ulang" |
| Jejak | Pembuatan, persetujuan, penolakan, pembatalan, perubahan tarif tercatat di jejak audit |

## Batasan yang perlu diketahui
- Tenaga lepas / bukan pegawai tetap memiliki aturan PPh 21 sendiri (mis. penghasilan harian, bukan pegawai). Sistem menghitung upah jasa sebagai bagian penghasilan bulanan pegawai (TER). Untuk tenaga lepas, minta konsultan pajak memastikan perlakuannya.
- Upah jasa bukan dasar iuran BPJS (variabel); hanya gaji pokok + tunjangan tetap.
- Komisi dihitung dari DPP faktur (sebelum PPN) saat catatan dibuat; retur sebagian membuat komisi tertahan sampai diperiksa.
- Pembagian komisi antar-pegawai dilakukan dengan beberapa catatan (total ≤ 100%).
- Tidak ada pencatatan jam otomatis (timer) atau aplikasi pegawai; HR memasukkan catatan.
- Jam yang bisa ditagihkan ke klien belum otomatis masuk faktur.

## Karyawan usaha jasa (status kepegawaian)
Usaha jasa mempekerjakan orang dengan status berbeda. Status dipilih di Data karyawan dan menentukan cara bayar:

| Status | Cara bayar | Aturan |
|---|---|---|
| Tetap | Gaji pokok + tunjangan bulanan, absensi, BPJS | Gaji pokok > 0; tanpa tanggal akhir |
| Kontrak (PKWT) | Seperti tetap sampai tanggal berakhir | Tanggal akhir wajib, maks. 5 tahun; gaji **prorata dan berhenti otomatis** di tanggal akhir; perpanjangan lewat persetujuan |
| Harian | Upah harian × hari yang **dicatat HADIR** | Hari tanpa catatan absen **tidak** dibayar (berbeda dari karyawan bulanan) |
| Tenaga lepas / Mitra | Hanya dari catatan kerja (menu Upah jasa) | Gaji/tunjangan/upah harian harus 0; BPJS dimatikan; tidak diabsen, tidak cuti; slip hanya muncul bila ada upah jasa bulan itu |
| Magang | Uang saku bulanan | Tanggal akhir wajib |

Status selain Tetap hanya untuk jenis usaha Jasa; usaha lain tidak berubah.

### Pencegahan kecurangan data karyawan
| Risiko | Pencegahan |
|---|---|
| Karyawan fiktif | Karyawan baru dari HR **belum ikut penggajian dan belum bisa dicatat upahnya** sampai diverifikasi Keuangan/Admin (orang lain; Pemilik langsung sah) |
| Rekening dialihkan / gaji dinaikkan diam-diam | Perubahan gaji, tunjangan, rekening, status, kontrak, BPJS, PTKP, NIK/NPWP oleh HR menjadi **permintaan** yang disetujui orang lain; nilai lama→baru tersimpan; permintaan basi (data sudah berubah) ditolak; satu permintaan tertunda per karyawan |
| Karyawan/rekening ganda | NIK, NPWP, nomor rekening yang sama dengan karyawan aktif lain ditolak; tab Peringatan menandai data lama yang ganda |
| Kontrak habis tetap digaji | Gaji dan catatan kerja otomatis berhenti di akhir kontrak; peringatan 30 hari sebelum berakhir |
| Mengaktifkan kembali karyawan keluar | Dianggap perubahan sensitif (perlu persetujuan) |
| Menyetujui data sendiri | Akun yang tertaut ke karyawan tidak memverifikasi/menyetujui datanya sendiri |

### Batasan
- Perlakuan PPh 21 tenaga lepas/mitra berbeda dari pegawai tetap; sistem tetap memakai tarif bulanan (TER) — tinjau dengan konsultan pajak.
- Aturan lama kontrak (maks. 5 tahun) mengikuti ketentuan PKWT umum; hubungan kerja khusus perlu ditinjau ahli ketenagakerjaan.
- Karyawan lama di usaha jasa otomatis berstatus Tetap dan terverifikasi (tidak ada yang berubah sampai diedit).
