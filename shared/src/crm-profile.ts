/**
 * CRM per jenis usaha: tahap pipeline bawaan, sumber prospek, dan alasan kalah yang masuk akal untuk jenis usaha itu
 * (mis. Jasa: survei kebutuhan → penawaran → kontrak; FMCG: kunjungan outlet → sampel → listing/PO pertama; F&B: pesanan besar/katering).
 * Semua pilihan berupa daftar tertutup; alasan lain ditulis dengan awalan "Lainnya: ".
 */
import type { BusinessModel } from './apps.js';

export interface CrmProfile {
  /** Sebutan satu prospek di layar */
  noun: string;
  /** Contoh judul prospek */
  titleExample: string;
  stages: { name: string; probability: number }[];
  sources: string[];
  lostReasons: string[];
}

export const CRM_PROFILES: Record<BusinessModel, CrmProfile> = {
  DAGANG: {
    noun: 'Calon pelanggan',
    titleExample: 'Toko Makmur — pasok barang bulanan',
    stages: [{ name: 'Prospek baru', probability: 10 }, { name: 'Sudah dihubungi', probability: 25 }, { name: 'Penawaran harga dikirim', probability: 50 }, { name: 'Negosiasi harga & termin', probability: 75 }],
    sources: ['Kunjungan sales', 'Referensi pelanggan', 'Telepon masuk', 'WhatsApp', 'Marketplace', 'Pameran', 'Website'],
    lostReasons: ['Harga kompetitor lebih murah', 'Barang tidak tersedia', 'Termin pembayaran tidak cocok', 'Belum butuh sekarang', 'Tidak bisa dihubungi'],
  },
  RITEL: {
    noun: 'Calon pelanggan grosir / langganan',
    titleExample: 'Warung Bu Sari — beli grosir mingguan',
    stages: [{ name: 'Minat awal', probability: 10 }, { name: 'Sudah dihubungi', probability: 25 }, { name: 'Penawaran paket / harga grosir', probability: 50 }, { name: 'Siap beli', probability: 75 }],
    sources: ['Datang ke toko', 'WhatsApp', 'Media sosial', 'Referensi pelanggan', 'Marketplace'],
    lostReasons: ['Harga kurang murah', 'Barang tidak tersedia', 'Lokasi terlalu jauh', 'Belum butuh sekarang', 'Tidak bisa dihubungi'],
  },
  UTILITAS: {
    noun: 'Calon pelanggan sambungan',
    titleExample: 'Perumahan Griya Asri blok C — 24 sambungan baru',
    stages: [{ name: 'Permintaan masuk', probability: 10 }, { name: 'Survei lokasi', probability: 30 }, { name: 'Penawaran biaya sambung', probability: 55 }, { name: 'Biaya dibayar & jadwal pasang', probability: 85 }],
    sources: ['Datang ke kantor', 'Telepon / WhatsApp', 'Referensi pelanggan', 'Pengembang / pengelola perumahan', 'Website', 'Spanduk / brosur'],
    lostReasons: ['Biaya sambung terlalu mahal', 'Jaringan belum menjangkau lokasi', 'Memilih penyedia lain', 'Tidak jadi pasang', 'Tidak bisa dihubungi'],
  },
  JASA: {
    noun: 'Calon klien',
    titleExample: 'PT Maju — renovasi kantor lantai 3',
    stages: [{ name: 'Prospek baru', probability: 10 }, { name: 'Survei / diskusi kebutuhan', probability: 25 }, { name: 'Penawaran dikirim', probability: 50 }, { name: 'Negosiasi & kontrak', probability: 75 }],
    sources: ['Referensi klien', 'Tender / lelang', 'Website', 'Media sosial', 'Kemitraan', 'Telepon masuk'],
    lostReasons: ['Harga / anggaran tidak cocok', 'Klien memilih penyedia lain', 'Proyek ditunda', 'Lingkup pekerjaan tidak sesuai', 'Tidak ada respon'],
  },
  FMCG: {
    noun: 'Calon outlet',
    titleExample: 'Toko Sumber Rejeki — listing produk baru',
    stages: [{ name: 'Outlet baru', probability: 10 }, { name: 'Kunjungan pertama', probability: 25 }, { name: 'Sampel & penawaran harga', probability: 50 }, { name: 'Listing / PO pertama', probability: 75 }],
    sources: ['Kunjungan sales', 'Referensi outlet', 'Pameran / bazar', 'Distributor lain', 'WhatsApp'],
    lostReasons: ['Margin kurang menarik', 'Sudah pakai merek lain', 'Outlet tutup / pindah', 'Termin pembayaran tidak cocok', 'Tidak bisa dihubungi'],
  },
  MANUFAKTUR: {
    noun: 'Calon pembeli / permintaan',
    titleExample: 'CV Karya — 5.000 kemasan custom',
    stages: [{ name: 'Permintaan baru', probability: 10 }, { name: 'Spesifikasi & sampel', probability: 25 }, { name: 'Penawaran harga', probability: 50 }, { name: 'Negosiasi & kontrak', probability: 75 }],
    sources: ['Referensi pelanggan', 'Tender / lelang', 'Pameran industri', 'Website', 'Telepon masuk'],
    lostReasons: ['Harga tidak cocok', 'Spesifikasi tidak terpenuhi', 'Jumlah minimum / lead time tidak cocok', 'Memilih pabrik lain', 'Proyek dibatalkan'],
  },
  FNB: {
    noun: 'Pesanan besar / katering',
    titleExample: 'Arisan keluarga Bu Rina — 60 porsi',
    stages: [{ name: 'Pertanyaan masuk', probability: 10 }, { name: 'Penawaran menu dikirim', probability: 40 }, { name: 'Negosiasi menu & harga', probability: 65 }, { name: 'Uang muka (DP) diterima', probability: 90 }],
    sources: ['WhatsApp', 'Instagram / media sosial', 'Referensi pelanggan', 'Reservasi langsung', 'Aplikasi pesan antar'],
    lostReasons: ['Harga terlalu tinggi', 'Tanggal tidak tersedia', 'Kapasitas dapur penuh', 'Memilih katering lain', 'Acara dibatalkan'],
  },
};

export const OTHER_REASON_PREFIX = 'Lainnya: ';

/** Alasan kalah yang sah: salah satu pilihan jenis usaha ini (atau daftar yang diberikan, mis. gabungan profil layanan Jasa), atau "Lainnya: …" dengan keterangan */
export function isValidLostReason(model: BusinessModel, reason: string, allowed: readonly string[] = CRM_PROFILES[model].lostReasons): boolean {
  if (allowed.includes(reason)) return true;
  return reason.startsWith(OTHER_REASON_PREFIX) && reason.slice(OTHER_REASON_PREFIX.length).trim().length >= 3;
}
