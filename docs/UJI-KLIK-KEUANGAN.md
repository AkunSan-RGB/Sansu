# Uji klik keuangan

Dijalankan lewat browser (Playwright) dan API pada peran Pemilik, Keuangan, dan Akuntan, di layar PC (1280) dan HP (390), untuk 7 jenis usaha demo.

## Yang diuji
- Penelusuran 29 halaman keuangan (kas, kas kecil, opname, jurnal, buku besar, bagan akun, saldo awal, tutup buku, laporan, penyesuaian, kurs, neraca lajur, PPN, aset tetap, bank, pajak, uang muka pemasok, kontrol).
- Alur: kas keluar, jurnal manual (tidak seimbang dan seimbang), setoran pajak, impor mutasi bank (termasuk file yang sama dua kali), klik ganda.
- Nilai ekstrem lewat API: nol, negatif, teks, angka sangat besar, tanggal jauh ke depan.
- Konsistensi laporan: neraca seimbang, Aktiva = Kewajiban + Ekuitas, laba berjalan neraca = laba Laba Rugi, arus kas awal + perubahan = akhir = saldo kas/bank buku besar.

## Temuan dan perbaikan
| Temuan | Perbaikan |
|---|---|
| Tanggal salah ketik (mis. 2099) diterima di kas, jurnal manual, setoran pajak, kurs, perolehan aset; nomor dokumen dan laporan bergeser | Ditolak bila lebih dari 31 hari ke depan |
| Kunci periode ke 2099-12-31 membekukan seluruh pembukuan; hanya Pemilik bisa membuka | Kunci paling lambat hari ini |
| Tiga klik cepat pada Posting membuat tiga transaksi kas yang sama | `useAction` hanya menjalankan satu permintaan pada satu waktu |
| Halaman Pajak di HP melebar 56 px | Kepala kartu membungkus di layar sempit |

## Yang sudah baik (tidak diubah)
Jumlah nol/negatif/teks ditolak server; kas keluar dari kas kecil, opname, dan akun induk dijaga; impor mutasi bank dengan periode yang sama ditolak; laporan konsisten di ketujuh jenis usaha.

## Catatan yang sengaja tidak diubah
- Kas keluar melebihi saldo diizinkan secara bawaan (pengaturan "Tolak saldo negatif" opsional); saldo negatif tetap ditandai merah di Kontrol keuangan.
- Peringatan dev AntD ("useForm tidak terhubung", `Descriptions span`) hanya muncul di mode pengembangan.
