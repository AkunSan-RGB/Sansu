<p align="center">
  <img src="apps/web/public/favicon.svg" width="72" alt="SANSU" />
</p>

<h1 align="center">SANSU</h1>
<p align="center"><b>ERP distribusi yang akurat sampai rupiah terakhir</b><br/>
Sistem bisnis terpadu untuk UKM dagang, ritel, jasa, dan produksi: penjualan, kasir, stok multi-gudang, faktur, piutang, akuntansi, pajak, dan penggajian.</p>

---

## Aplikasi

SANSU adalah platform modular seperti Odoo: perusahaan mengaktifkan aplikasi yang dibutuhkan di **Pengaturan → Aplikasi**
(dependensi ikut aktif otomatis), dan menu, halaman, serta API mengikuti pilihan itu dan peran pengguna.

| Aplikasi | Isi |
| --- | --- |
| CRM | Pipeline kanban (seret antar tahap), aktivitas & agenda follow-up, tombol WhatsApp, penawaran harga → Sales Order |
| Penjualan | Sales order, faktur, piutang & umur piutang, limit kredit, retur penjualan |
| Kasir (POS) | Sesi kasir, scan barcode, tunai/QRIS/debit, struk thermal, tutup kasir & jurnal selisih kas |
| Pembelian | Purchase order, faktur supplier, hutang & umur hutang, retur pembelian |
| Inventori | Produk multi-satuan & barcode, stok per gudang, kartu stok, HPP rata-rata, opname |
| Akuntansi (inti) | Jurnal, buku besar, laba rugi, neraca, arus kas, PPN, saldo awal, kunci periode, tutup buku |
| Kas & Bank | Saldo per rekening, kas masuk/keluar, transfer |
| Karyawan | Data karyawan & PTKP, absensi berbasis pengecualian, cuti & saldo cuti |
| Penggajian | BPJS (plafon dapat diatur), lembur, PPh 21 TER (PP 58/2023) + perhitungan tahunan Desember, slip gaji, jurnal & pembayaran gaji, rekap PPh 21 |

## Tech stack

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Database | **PostgreSQL 18.6** | ACID, `uuidv7()` bawaan untuk primary key berurutan waktu, `NUMERIC` presisi tinggi, row locking (`FOR UPDATE`), JSONB |
| ORM & migrasi | **Drizzle ORM** + drizzle-kit | 100% TypeScript, SQL eksplisit (penting untuk penguncian & laporan), tanpa binary engine |
| Backend | **NestJS 11** (TypeScript) | Modular monolith dengan batas modul tegas, DI, guard peran, Swagger otomatis |
| Presisi uang | **decimal.js** | Tidak ada galat float; pembulatan half-up |
| Frontend | **React 18 + Vite** | Ekosistem enterprise terbesar, build cepat |
| UI kit | **Ant Design 5** + tema SANSU | Tabel, form berlapis, tree, date picker siap pakai |
| Data fetching | **TanStack Query** | Cache, refetch, dan status loading/error konsisten |
| Kontrak bersama | **@sansu/shared** | Enum, label, dan tipe API dipakai backend & frontend sekaligus |
| Monorepo | **npm workspaces + Turborepo** | Build berurutan & ter-cache |
| Test | Jest + Supertest pada PostgreSQL sungguhan | Menguji transaksi, penguncian, dan isolasi tenant yang nyata |
| Deploy | Docker multi-stage + Nginx | Satu perintah untuk db + api + web |

## Struktur

```
sansu/
├─ packages/
│  └─ shared/                 @sansu/shared — enum domain, label Indonesia, tipe respons API, brand
├─ apps/
│  ├─ api/                    @sansu/api — NestJS
│  │  ├─ drizzle/             migrasi SQL (ikut di-commit)
│  │  ├─ src/db/              schema.ts, koneksi, migrate, seed
│  │  ├─ src/common/          auth & peran, penomoran dokumen, audit log, util uang/tanggal, filter error
│  │  ├─ src/modules/         auth · master-data · inventory · sales · accounting · dashboard · health
│  │  ├─ test/                test e2e
│  │  └─ Dockerfile
│  └─ web/                    @sansu/web — React
│     ├─ src/brand/           logo & tema SANSU
│     ├─ src/api/             klien HTTP & hook data
│     ├─ src/features/        satu folder per modul bisnis
│     ├─ nginx.conf
│     └─ Dockerfile
├─ docs/ARCHITECTURE.md       diagram & keputusan arsitektur
├─ docs/PENGUJIAN.md          lapisan tes, uji acak invarian, cara menjalankan
├─ docker-compose.yml         PostgreSQL untuk development
├─ docker-compose.prod.yml    layanan online: caddy (HTTPS) + web + api + db + backup
├─ deploy/                    install.sh, Caddyfile, layanan backup
├─ sansu.sh                 alat kelola server (status, backup, restore, update)
└─ turbo.json
```

## Menjalankan (development)

Prasyarat: **Node.js 20+** dan **Docker Desktop** (atau PostgreSQL 18.6 lokal). Database development memakai port **5434** agar tidak bentrok dengan PostgreSQL lain.

```bash
npm install                 # juga membangun @sansu/shared
npm run db:up               # PostgreSQL: database lokal `akurata` & `akurata_test` (nama teknis lama dipertahankan agar data tidak hilang)

# Windows: copy apps\api\.env.example apps\api\.env
# Mac/Linux: cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run db:seed

npm run dev                 # API :3000 (docs: /api/docs) + web :5173 sekaligus
```

Login demo (kata sandi semua `demo12345`): **admin@demo.id** (Pemilik), **kasir@demo.id** (Kasir), **hrd@demo.id** (SDM).

## Layanan online (produksi)

Pasang di VPS Ubuntu dengan satu perintah — HTTPS otomatis, backup harian terverifikasi (+ salinan offsite terenkripsi), firewall:

```bash
sudo bash deploy/install.sh
./sansu.sh status
```

Panduan lengkap (backup offsite, pemulihan, keamanan, checklist sebelum jualan): **[docs/PANDUAN-SERVER.md](docs/PANDUAN-SERVER.md)**.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | API + web dengan hot reload |
| `npm run build` | Build semua paket (Turborepo, ter-cache) |
| `npm run typecheck` | Cek tipe seluruh monorepo |
| `npm test` | Unit test (jurnal, HPP, harga & PPN) |
| `npm run test:e2e` | Alur lengkap terhadap `akurata_test` (salin `.env.test.example` → `.env.test`) |
| `npm run db:generate` | Buat migrasi SQL setelah mengubah `schema.ts` |

## Prinsip inti

1. **Uang tidak pernah `float`** — `NUMERIC(18,2)` / `NUMERIC(18,4)` + decimal.js.
2. **Satu dokumen = satu transaksi database** — stok, faktur, jurnal tersimpan bersama atau tidak sama sekali.
3. **Jurnal tidak bisa diedit** — koreksi lewat jurnal balik; jurnal tidak seimbang ditolak.
4. **Tanpa race condition** — baris stok, order, faktur dikunci saat diproses.
5. **Nomor dokumen tanpa celah** — `SO/2026/10/0001`, `INV/…`, `PAY/…`, `JU/…`.
6. **Multi-tenant** — setiap tabel bisnis ber-`tenant_id`, setiap query difilter dari token.
7. **Satu sumber enum** — status & peran didefinisikan sekali di `@sansu/shared`.

Detail alur, diagram, dan cara menambah modul: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Strategi pengujian dan kontrol integritas pembukuan: [docs/PENGUJIAN.md](docs/PENGUJIAN.md).

## PostgreSQL 18.6

Proyek ini membutuhkan **PostgreSQL 18** (diuji dengan seri 18; image Docker dipatok ke `postgres:18.6`). Primary key memakai `uuidv7()` bawaan PG 18, dan `npm run db:migrate` akan berhenti dengan pesan jelas bila server lebih lama.

**Sudah pernah menjalankan versi PostgreSQL 16 lewat Docker?** Image PG 18 menyimpan data di lokasi baru, jadi compose kini memakai volume baru (`*-pg18-data`) dan database dimulai kosong. Jika data lama perlu dipindahkan:

```bash
# 1. Sebelum upgrade (container lama masih PG 16): ekspor data
docker exec <container-db> pg_dump -U <user> -Fc <database> > backup.dump
# 2. Jalankan PG 18.6, lalu impor
npm run db:up
docker exec -i <container-db> pg_restore -U <user> -d <database> --clean --if-exists < backup.dump
```

Jika belum ada data penting, cukup `npm run db:up`, lalu `npm run db:migrate` dan `npm run db:seed`.
