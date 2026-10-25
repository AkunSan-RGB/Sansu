# Uang muka pemasok (DP pembelian)

Uang yang dibayarkan ke pemasok **sebelum** barang atau faktur datang. Menu: Pembelian › Uang muka pemasok.

## Pembukuan
| Kejadian | Jurnal |
| --- | --- |
| Bayar DP | Dr Uang Muka Pembelian (1-1720) · Cr Kas/Bank |
| Perhitungkan ke faktur | Dr Hutang Usaha · Cr Uang Muka Pembelian (faktur terbayar sebesar yang dipakai) |
| Pemasok mengembalikan | Dr Kas/Bank · Cr Uang Muka Pembelian |
| Batal (belum dipakai/dikembalikan) | jurnal dibalik |

PPN masukan tidak dicatat saat DP; diakui pada faktur pembelian seperti biasa. Akun 1-1720 dibuat otomatis bila belum ada.

## Kontrol (uang keluar tanpa barang adalah titik rawan)
- Hak: bayar, perhitungkan, dan kembalikan oleh Admin/Keuangan; batal oleh Admin/Pemilik; Akuntan dan Pembelian hanya melihat.
- Staf (selain Pemilik/Admin) menunggu persetujuan bila: nilai mencapai batas persetujuan pembayaran, **tanpa pesanan pembelian**, **di atas 30% nilai pesanan**, rekening pemasok baru diubah (masa tahan kebijakan), atau pembayaran pertama ke pemasok (bila kebijakan menyalakannya). Setelah disetujui, uang muka dicatat atas nama pemohon.
- DP untuk satu pesanan tidak boleh melebihi nilai pesanan; hanya pesanan yang sudah dikonfirmasi dan belum difakturkan; pesanan mata uang asing belum didukung.
- DP milik pesanan hanya diperhitungkan ke faktur dari pesanan itu; pemasok harus sama; tanggal pemakaian tidak sebelum tanggal DP; tidak melebihi sisa DP maupun sisa hutang faktur.
- Pengembalian wajib alasan; batal ditolak bila sudah dipakai/dikembalikan atau sudah dicocokkan dengan mutasi bank.
- Semua tindakan (buat, pakai, kembalikan, batal) masuk jejak audit; dokumen sumber jurnal dapat dibuka dari buku besar.
- Tab **Kontrol**: DP lebih dari 60 hari belum dipakai, DP tanpa pesanan, DP pada pesanan yang sudah difakturkan, dan pemasok yang punya faktur terbuka padahal DP belum diperhitungkan.
- Dialog "Bayar hutang" memperingatkan bila pemasok masih punya DP terbuka.

## Belum didukung
Faktur/pesanan mata uang asing, PPN atas DP (faktur pajak DP), pembatalan pemakaian DP yang sudah diperhitungkan (koreksi lewat retur/jurnal), dan DP untuk pembelian biaya (tagihan tanpa pesanan dapat dipakai bila pemasoknya sama).
