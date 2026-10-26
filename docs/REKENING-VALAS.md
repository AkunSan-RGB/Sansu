# Rekening kas/bank valas

Berlaku untuk semua jenis usaha (Ritel, Dagang, Jasa, FMCG, Manufaktur, F&B, Utilitas). Menu: **Kas & Bank › Valas & kurs**
(`/cash/foreign`; alamat lama `/fx` dialihkan). Menu "Mata uang asing" di Akuntansi disembunyikan.

## Data
- `accounts.currency` (`IDR` bawaan, atau kode valas): hanya akun kas/bank, tidak bisa diubah setelah dibuat (migrasi `0108`).
- `journal_lines.foreign_amount`: jumlah valas positif; arah mengikuti sisi debit/kredit. Wajib untuk baris ke akun valas,
  dilarang untuk akun Rupiah. Dijaga di satu tempat: `PostingService.post` (`assertForeignAmount`), jadi alur yang belum
  mengenal valas ditolak dengan pesan jelas, tidak menulis saldo valas yang salah. Jurnal balik menyalin `foreign_amount`.
- `cash_transactions.currency` / `amount_foreign`: transaksi kas valas (`amount` tetap nilai Rupiah).

## Nilai Rupiah: biaya rata-rata tertimbang
`ForeignCashService.costOut` menilai valas yang keluar pada nilai Rupiah tercatat ÷ saldo valas (pengeluaran yang menghabiskan
saldo mengambil seluruh nilai tercatat → tanpa sisa pembulatan). Selisih terhadap nilai transaksi = laba/rugi kurs terealisasi
(`FX_GAIN` / `FX_LOSS`). Rekening dikunci per akun (advisory lock) dan saldo negatif ditolak (pengaturan Kontrol kas).

## Alur
| Alur | Perilaku |
|---|---|
| Pelunasan faktur USD ke rekening USD | uang masuk apa adanya; nilai Rupiah = jumlah × kurs hari bayar; selisih terhadap piutang → laba/rugi kurs |
| Bayar pemasok USD dari rekening USD | Rupiah keluar = biaya rata-rata; selisih terhadap utang → laba/rugi kurs |
| `POST /cash/foreign` kind `BUY` / `SELL` / `MOVE` / `IN` / `OUT` | beli/jual valas, pindah antar rekening valas sejenis, terima/bayar valas dengan akun lawan |
| Alur lain (kasir, gaji, pajak, aset, dsb.) | `resolveCashAccount` menolak rekening valas kecuali alurnya mengizinkan (`allowForeign`) |

Transaksi valas bernilai ≥ batas persetujuan hanya boleh dicatat Pemilik/Admin (tanpa antrean persetujuan).

## Penilaian ulang akhir periode
`FxService.revalue` kini menilai juga saldo rekening valas pada kurs penutup. Selisih belum terealisasi masuk akun
**1-1205 Penyesuaian Kurs Kas & Bank Valas** (`FX_REVAL_CASH`, kelompok Kas dan setara kas), dibalik otomatis esok harinya.
Tenant lama mendapat akun ini otomatis saat pertama dipakai (`ensureSystemAccounts`).

## Rekening koran & rekonsiliasi
Nilai baris buku untuk rekening valas = jumlah valasnya (`BOOK_DEBIT/BOOK_CREDIT` di `bank.repository.ts`), sehingga pencocokan
otomatis/manual dan rekonsiliasi bekerja dalam valas. Jurnal otomatis dari mutasi (`createFromLine`, aturan) tidak
dibuat untuk rekening valas karena butuh kurs: catat lewat Transaksi valas lalu cocokkan.

## Batasan
Uang muka pada faktur valas, pembelian cepat, tagihan biaya/aset dan faktur jasa dalam valas belum didukung (tidak berubah).
Jurnal berulang ke akun valas belum mengenal jumlah valas.
