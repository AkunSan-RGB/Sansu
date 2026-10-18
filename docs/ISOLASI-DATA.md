# Isolasi data antar perusahaan dan jenis usaha

Prinsip: **satu perusahaan = satu jenis usaha = satu kumpulan data yang terpisah total.**

## Lapisan pengaman
1. **RLS per perusahaan** (sudah ada): koneksi aplikasi memakai peran `sansu_app`; baris perusahaan lain tidak terlihat meski query lupa menyaring `tenant_id`.
2. **Pengaman foreign key lintas perusahaan** (baru, migrasi 0070): foreign key bawaan PostgreSQL melewati RLS, sehingga UUID milik perusahaan lain bisa tersimpan bila kode lupa memeriksa. Trigger `sansu_tenant_guard` di tiap tabel menolak baris yang menunjuk ke baris perusahaan lain (`Data lintas perusahaan ditolak`). Tabel baris anak (baris faktur, baris jurnal, slip gaji, dst.) memakai perusahaan induknya.
3. **RLS tabel anak** (baru): tabel tanpa `tenant_id` (`journal_lines`, `invoice_lines`, `payslips`, ...) ikut dibatasi lewat baris induknya.
4. **Kunci jenis usaha** (baru): jenis usaha boleh diubah selama perusahaan belum punya transaksi/dokumen apa pun. Setelah ada, mengganti ke jenis lain ditolak (HTTP 409) untuk semua jenis usaha (Dagang, Ritel, Jasa, FMCG, Manufaktur, F&B). Untuk jenis usaha lain, buat perusahaan baru (data terpisah). Perusahaan lama yang belum pernah memilih jenis usaha (nilai bawaan) boleh memilih satu kali.
5. **Penulisan pengaturan atomik**: pengaturan perusahaan ditulis per kunci (`jsonb_set`), bukan menimpa seluruh dokumen hasil baca lama, sehingga dua penyimpanan yang berdekatan tidak saling menghapus.

## Untuk pengembang
Migrasi yang menambah tabel baru harus memanggil `SELECT sansu_install_tenant_guards();` di akhir. Tes `isolasi-perusahaan` gagal bila ada foreign key lintas-tabel tanpa pengaman atau tabel anak tanpa RLS.

## Batasan
- Satu email = satu perusahaan. Membuat perusahaan lain berarti mendaftar dengan email lain (satu pengguna dengan beberapa perusahaan belum ada).
- Perusahaan demo: jenis usaha berganti lewat "Buat demo baru", bukan mengganti jenis di perusahaan yang sama.
