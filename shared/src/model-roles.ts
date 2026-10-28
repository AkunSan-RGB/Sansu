import type { BusinessModel } from './apps';
import { ROLES, ROLE_LABELS, type Role } from './domain';

/**
 * Katalog peran per jenis usaha. Peran dasar (hak akses) sama di semua jenis usaha dan ditegakkan di server; yang berbeda per jenis usaha
 * hanya **sebutan** dan **peran mana yang ditawarkan** saat membuat pengguna. Tiap perusahaan dapat menyesuaikannya lagi untuk dirinya
 * sendiri (`RoleCustomization`) tanpa mengubah hak akses dan tanpa memengaruhi perusahaan lain.
 */
export interface RoleCustomization {
  /** Sebutan peran khusus perusahaan ini (menimpa sebutan jenis usaha) */
  labels?: Partial<Record<Role, string>>;
  /** Peran yang tidak ditawarkan lagi di perusahaan ini (pengguna yang sudah memegangnya tidak berubah) */
  hidden?: Role[];
  /** Peran tambahan yang ditawarkan walau jenis usahanya tidak menawarkannya */
  extra?: Role[];
}

interface ModelRoles {
  /** Sebutan yang berbeda dari bawaan */
  labels: Partial<Record<Role, string>>;
  /** Keterangan pekerjaan peran ini di jenis usaha tersebut */
  desc: Partial<Record<Role, string>>;
  /** Peran yang tidak ditawarkan untuk jenis usaha ini (Kasir ikut tersedia bila aplikasi Kasir menyala) */
  notOffered: Role[];
}

const NO_COUNTER: Role[] = ['CASHIER'];

export const MODEL_ROLES: Record<BusinessModel, ModelRoles> = {
  DAGANG: {
    labels: { SALES: 'Penjualan', PURCHASING: 'Pembelian', WAREHOUSE: 'Gudang' },
    desc: { SALES: 'Pesanan, penawaran, dan tagihan pelanggan', WAREHOUSE: 'Penerimaan, pengiriman, dan stok barang' },
    notOffered: NO_COUNTER,
  },
  RITEL: {
    labels: { SALES: 'Pramuniaga', WAREHOUSE: 'Staf gudang toko' },
    desc: { CASHIER: 'Melayani pembeli di layar kasir', WAREHOUSE: 'Stok, rak, dan opname toko' },
    notOffered: [],
  },
  JASA: {
    labels: { SALES: 'Pemasaran & kontrak', WAREHOUSE: 'Koordinator lapangan', PURCHASING: 'Pembelian & subkontrak', CASHIER: 'Kasir layanan' },
    desc: {
      SALES: 'Calon klien, penawaran, kontrak; mendaftarkan peserta dan mengatur jadwal (tanpa menagih)',
      WAREHOUSE: 'Mengatur jadwal tim/jaga di lapangan dan bahan habis pakai (tanpa menagih)',
      PURCHASING: 'Belanja bahan dan pesanan ke subkontraktor',
      CASHIER: 'Menjual layanan di kasir',
    },
    notOffered: [],
  },
  FMCG: {
    labels: { SALES: 'Sales lapangan', WAREHOUSE: 'Gudang & distribusi', PURCHASING: 'Pembelian dari prinsipal' },
    desc: { SALES: 'Kunjungan outlet, pesanan, dan target', WAREHOUSE: 'Lot, kedaluwarsa, dan pengiriman' },
    notOffered: NO_COUNTER,
  },
  MANUFAKTUR: {
    labels: { SALES: 'Penjualan', WAREHOUSE: 'Gudang & produksi', PURCHASING: 'Pembelian bahan' },
    desc: { WAREHOUSE: 'Bahan baku, barang setengah jadi, dan barang jadi' },
    notOffered: NO_COUNTER,
  },
  FNB: {
    labels: { SALES: 'Pelayan & katering', WAREHOUSE: 'Gudang & dapur', PURCHASING: 'Belanja bahan' },
    desc: { CASHIER: 'Kasir kafe/restoran', WAREHOUSE: 'Stok bahan dan dapur' },
    notOffered: [],
  },
  UTILITAS: {
    labels: { SALES: 'Pelayanan pelanggan', WAREHOUSE: 'Petugas lapangan', CASHIER: 'Kasir loket', PURCHASING: 'Pembelian bahan' },
    desc: { SALES: 'Permohonan, pengaduan, dan layanan pelanggan', WAREHOUSE: 'Baca meter dan perintah kerja lapangan' },
    notOffered: [],
  },
};

/** Peran yang selalu ada: pemilik dan pengelola tidak boleh disembunyikan */
export const ALWAYS_OFFERED: readonly Role[] = ['OWNER', 'ADMIN'];
const MAX_LABEL = 40;

/** Sebutan peran: penyesuaian perusahaan › sebutan jenis usaha › sebutan bawaan */
export function roleLabelFor(role: Role, model: string | null | undefined, custom?: RoleCustomization | null): string {
  const own = custom?.labels?.[role]?.trim();
  if (own) return own;
  return MODEL_ROLES[model as BusinessModel]?.labels[role] ?? ROLE_LABELS[role];
}

export interface RoleOption {
  role: Role;
  label: string;
  desc?: string;
  offered: boolean;
}

/** Semua peran dengan sebutan dan status ditawarkan; `apps` = aplikasi yang aktif (Kasir tersedia bila aplikasi Kasir menyala) */
export function roleCatalog(model: string | null | undefined, custom?: RoleCustomization | null, apps: readonly string[] = []): RoleOption[] {
  const def = MODEL_ROLES[model as BusinessModel];
  const hidden = new Set(custom?.hidden ?? []);
  const extra = new Set(custom?.extra ?? []);
  return ROLES.map((role) => {
    const base = !def?.notOffered.includes(role) || (role === 'CASHIER' && apps.includes('pos'));
    const offered = ALWAYS_OFFERED.includes(role) || ((base || extra.has(role)) && !hidden.has(role));
    return { role, label: roleLabelFor(role, model, custom), desc: def?.desc[role], offered };
  });
}

/**
 * Peran yang diblokir untuk pengguna baru: hanya yang disembunyikan perusahaan itu sendiri (keputusan eksplisit klien).
 * Daftar bawaan jenis usaha (`notOffered`) hanya menyederhanakan pilihan di layar dan tidak ditegakkan di server,
 * supaya alur lama (mis. membuat Kasir sebelum aplikasi Kasir dinyalakan) tidak tiba-tiba ditolak.
 */
export const isRoleBlocked = (role: Role, custom?: RoleCustomization | null): boolean => !ALWAYS_OFFERED.includes(role) && !!custom?.hidden?.includes(role);

export const isRoleOffered = (role: Role, model: string | null | undefined, custom?: RoleCustomization | null, apps: readonly string[] = []): boolean =>
  roleCatalog(model, custom, apps).find((r) => r.role === role)?.offered ?? false;

/** Memeriksa penyesuaian peran dari perusahaan: bentuk, panjang sebutan, dan peran yang tidak boleh disembunyikan. Mengembalikan pesan galat atau null. */
export function validateRoleCustomization(c: RoleCustomization): string | null {
  for (const [r, l] of Object.entries(c.labels ?? {})) {
    if (!(ROLES as readonly string[]).includes(r)) return `Peran tidak dikenal: ${r}`;
    if (typeof l !== 'string' || l.trim().length < 2 || l.trim().length > MAX_LABEL) return `Sebutan ${r} harus 2–${MAX_LABEL} huruf`;
  }
  for (const r of [...(c.hidden ?? []), ...(c.extra ?? [])]) if (!(ROLES as readonly string[]).includes(r)) return `Peran tidak dikenal: ${r}`;
  for (const r of c.hidden ?? []) if (ALWAYS_OFFERED.includes(r)) return `Peran ${ROLE_LABELS[r]} tidak boleh disembunyikan`;
  const labels = Object.values(c.labels ?? {}).map((l) => l.trim().toLowerCase());
  if (new Set(labels).size !== labels.length) return 'Sebutan peran tidak boleh kembar';
  return null;
}
