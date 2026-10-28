# Kustomisasi per klien (peran dan sebutan)

Tujuan: satu klien dapat menyesuaikan jenis usahanya untuk dirinya sendiri, tanpa memengaruhi klien lain, dan tanpa membuat cabang kode.

## Prinsip
1. **Konfigurasi, bukan fork.** Semua klien menjalankan kode yang sama. Perbedaan klien adalah data konfigurasi di pengaturan perusahaannya (`tenants.settings`), yang sudah terisolasi antar perusahaan (RLS).
2. **Tiga lapis, urutan prioritas dari bawah ke atas.**
   1. Kode (bawaan): peran dasar dan **hak aksesnya** (`@Roles`, matriks izin). Tidak dapat diubah oleh klien.
   2. Katalog jenis usaha (`shared/src/model-roles.ts`): sebutan peran dan peran yang ditawarkan untuk Dagang, Ritel, Jasa, FMCG, Manufaktur, F&B, Utilitas. Berubah lewat rilis produk.
   3. Penyesuaian klien (`settings.roleCustomization`): sebutan sendiri, peran disembunyikan, peran tambahan. Hanya berlaku untuk klien itu.
3. **Hanya yang aman.** Penyesuaian **tidak** mengubah hak akses, pemisahan fungsi uang vs pembukuan, atau aturan akuntansi/pajak. Ia hanya mengatur nama dan siapa yang bisa diberi peran apa. Pemilik dan Admin tidak dapat disembunyikan. Sebutan harus 2–40 huruf dan tidak kembar.
4. **Pembaruan produk tidak menimpa klien.** Bawaan jenis usaha di rilis baru berlaku untuk klien yang belum menyesuaikan; nilai yang sudah diatur klien tetap. Klien dapat kembali ke bawaan (`DELETE /settings/customization/roles`).
5. **Tercatat.** Setiap perubahan masuk jejak audit (sebelum dan sesudah) dengan kategori Pengaturan.

## Alur teknis
- `GET /settings/customization/roles` → katalog berlaku + bawaan jenis usaha (untuk perbandingan). `PUT` (Admin) menyimpan, `DELETE` (Admin) mereset.
- `/auth/me` membawa `roleCustomization`; frontend memakai `roleLabelFor` dan `roleCatalog` dari `@sansu/shared` (satu sumber yang sama dengan backend).
- Backend menegakkan penawaran peran saat membuat pengguna dan saat mengganti peran (`RoleOfferService`). Pengguna yang sudah memegang peran yang disembunyikan tidak berubah.
- Kasir ditawarkan di jenis usaha yang punya kasir, atau bila aplikasi Kasir menyala.

## Contoh
- Bimbel (Jasa): Sales disebut "Admin akademik", Pembelian disembunyikan.
- Distributor (Dagang) yang punya counter: menambahkan peran Kasir walau Dagang tidak menawarkannya.

## Batas yang disengaja
- Peran dasar baru (nilai enum `role`) tidak dapat dibuat klien: itu perubahan kode dan migrasi. Peran dengan hak lebih sempit sudah ada lewat **Peran khusus** (Pemilik, hanya mempersempit).
- Belum dapat dikustomisasi per klien: menu, istilah antarmuka, tahap alur kerja (yang terakhir sudah dapat dipersempit di pengaturan alur kerja), bagan akun bawaan. Pola yang sama (kunci baru di `settings`, validasi di `@sansu/shared`, jejak audit, tombol kembali ke bawaan) dipakai bila nanti ditambah.
- Fitur khusus satu klien (kode baru) bukan kustomisasi dan memerlukan sakelar fitur per perusahaan; belum ada.
