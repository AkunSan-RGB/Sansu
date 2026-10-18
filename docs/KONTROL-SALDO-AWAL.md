# Kontrol saldo awal

Saldo awal (Akuntansi › Persiapan › Saldo awal) mengubah seluruh neraca, jadi dijaga:
- Setiap pencatatan masuk **jejak audit** (entitas `OpeningBalance`: tanggal, total debit/kredit, penyeimbang Ekuitas Saldo Awal).
- Bila dicatat oleh selain Pemilik, **Pemilik diberi tahu** (Telegram/email): total dan penyeimbang. Impor massal memakai transaksi luar dan tidak memberi tahu.
- **Cek kesehatan** (`opening-balance`, kategori Kewajaran) berstatus peringatan bila saldo awal dicatat lebih dari 2 kali, atau ada jurnal saldo awal yang dicatat > 14 hari setelah transaksi pertama berjalan. Muncul juga di halaman Kontrol pembukuan & pajak (setelah PR #150 digabung).

Batas jujur: saldo awal tetap bisa dicatat kapan saja oleh Admin/Akuntan tanpa persetujuan; selisih neraca otomatis masuk Ekuitas Saldo Awal (sudah ada peringatan bila tidak wajar di halamannya). Kondisi "dicatat jauh setelah transaksi berjalan" belum diuji otomatis karena tanggal pembuatan jurnal tidak bisa diubah di database uji.
