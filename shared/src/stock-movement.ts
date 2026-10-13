/**
 * Analisis perputaran stok: barang cepat keluar (fast moving) dan lambat (slow / mati).
 * Ukurannya "hari cakupan" = stok sekarang ÷ rata-rata keluar per hari. Ambang disesuaikan jenis usaha:
 * toko/ritel berputar cepat (hitungan minggu), dagang/grosir hitungan bulan, produksi menyesuaikan siklus bahan,
 * jasa memakai bahan kerja yang jarang keluar.
 */
import type { BusinessModel } from './apps.js';

export const MOVEMENT_CLASSES = ['FAST', 'NORMAL', 'SLOW', 'DEAD', 'NEW', 'OUT', 'EMPTY'] as const;
export type MovementClass = (typeof MOVEMENT_CLASSES)[number];

export const MOVEMENT_LABELS: Record<MovementClass, string> = {
  FAST: 'Cepat keluar',
  NORMAL: 'Normal',
  SLOW: 'Lambat',
  DEAD: 'Tidak bergerak',
  NEW: 'Baru (belum cukup riwayat)',
  OUT: 'Habis padahal laku',
  EMPTY: 'Kosong',
};

export interface MovementProfile {
  /** Rentang hari yang dihitung untuk kecepatan keluar */
  windowDays: number;
  /** Stok cukup untuk ≤ sekian hari → cepat keluar */
  fastCoverDays: number;
  /** ≤ sekian hari → normal; lebih → lambat */
  normalCoverDays: number;
  /** Tidak ada barang keluar selama sekian hari → tidak bergerak */
  deadDays: number;
  /** Istilah keluar menurut usaha */
  outWord: string;
  actions: Partial<Record<MovementClass, string>>;
}

export const MOVEMENT_PROFILES: Record<BusinessModel, MovementProfile> = {
  RITEL: {
    windowDays: 30,
    fastCoverDays: 14,
    normalCoverDays: 45,
    deadDays: 60,
    outWord: 'terjual lewat kasir',
    actions: {
      FAST: 'Jaga stok rak, pesan ulang lebih sering agar tidak kosong.',
      SLOW: 'Beri diskon, bundling, atau pindah ke rak depan; tahan pembelian berikutnya.',
      DEAD: 'Obral / retur ke pemasok bila bisa; pertimbangkan penurunan nilai persediaan.',
      OUT: 'Segera pesan: barang ini laku tetapi stoknya habis.',
    },
  },
  DAGANG: {
    windowDays: 90,
    fastCoverDays: 30,
    normalCoverDays: 90,
    deadDays: 120,
    outWord: 'terjual ke pelanggan',
    actions: {
      FAST: 'Pertahankan stok pengaman dan negosiasi harga beli lebih baik (volume tinggi).',
      SLOW: 'Tawarkan promo ke pelanggan langganan; tahan pembelian berikutnya.',
      DEAD: 'Obral atau retur ke pemasok; pertimbangkan penurunan nilai persediaan.',
      OUT: 'Segera buat Purchase Order: barang laku tetapi stok habis.',
    },
  },
  PRODUKSI: {
    windowDays: 90,
    fastCoverDays: 30,
    normalCoverDays: 90,
    deadDays: 150,
    outWord: 'terjual atau dipakai produksi',
    actions: {
      FAST: 'Pastikan pasokan bahan/produk ini tidak terputus; jadwalkan produksi lebih rutin.',
      SLOW: 'Kurangi produksi atau belanja bahan ini; sesuaikan resep & jadwal.',
      DEAD: 'Hentikan pembelian/produksi; jual sisa, ganti pemakaian, atau nilai ulang persediaan.',
      OUT: 'Segera beli bahan atau jadwalkan produksi: barang dipakai/dijual tetapi stok habis.',
    },
  },
  MANUFAKTUR: {
    windowDays: 90,
    fastCoverDays: 45,
    normalCoverDays: 120,
    deadDays: 180,
    outWord: 'terjual atau dipakai produksi',
    actions: {
      FAST: 'Amankan pasokan lewat perencanaan kebutuhan bahan (MRP); pertimbangkan kontrak pemasok.',
      SLOW: 'Kurangi pesanan bahan di MRP; tinjau ukuran lot produksi.',
      DEAD: 'Stop pembelian; cari pemakaian lain, jual sisa, atau nilai ulang persediaan.',
      OUT: 'Segera beli atau produksi: ada pemakaian/penjualan tetapi stok habis.',
    },
  },
  JASA: {
    windowDays: 180,
    fastCoverDays: 60,
    normalCoverDays: 180,
    deadDays: 270,
    outWord: 'dipakai untuk pekerjaan',
    actions: {
      SLOW: 'Beli bahan seperlunya per proyek, bukan menimbun.',
      DEAD: 'Bahan tidak terpakai: bebankan ke proyek berikutnya atau jual/retur.',
      OUT: 'Beli bahan sebelum pekerjaan berikutnya dimulai.',
    },
  },
};

export interface MovementInput {
  /** Stok sekarang (satuan dasar) */
  onHand: number;
  /** Barang keluar bersih (penjualan + pemakaian produksi − retur) dalam rentang */
  netOut: number;
  /** Umur barang di sistem (hari sejak mutasi pertama) */
  ageDays: number;
  /** Berapa hari lalu barang terakhir keluar (null = belum pernah) */
  lastOutDaysAgo: number | null;
}

export interface MovementResult {
  cls: MovementClass;
  /** Rata-rata keluar per hari */
  perDay: number;
  /** Stok cukup untuk berapa hari (null bila tidak ada keluaran) */
  coverDays: number | null;
}

export function classifyMovement(model: BusinessModel | undefined, x: MovementInput): MovementResult {
  const p = MOVEMENT_PROFILES[model ?? 'DAGANG'] ?? MOVEMENT_PROFILES.DAGANG;
  const netOut = Math.max(0, x.netOut);
  // barang baru: pakai umur sebagai pembagi agar tidak terlihat lambat hanya karena baru masuk
  const span = Math.max(7, Math.min(p.windowDays, x.ageDays));
  const perDay = netOut / span;
  if (x.onHand <= 0) return { cls: netOut > 0 ? 'OUT' : 'EMPTY', perDay, coverDays: 0 };
  if (netOut <= 0) {
    const idle = x.lastOutDaysAgo ?? x.ageDays;
    if (x.ageDays < p.deadDays) return { cls: 'NEW', perDay: 0, coverDays: null };
    return { cls: idle > p.deadDays ? 'DEAD' : 'SLOW', perDay: 0, coverDays: null };
  }
  const cover = x.onHand / perDay;
  const cls: MovementClass = cover <= p.fastCoverDays ? 'FAST' : cover <= p.normalCoverDays ? 'NORMAL' : 'SLOW';
  return { cls, perDay, coverDays: cover };
}
