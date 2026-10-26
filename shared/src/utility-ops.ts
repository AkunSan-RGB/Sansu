/**
 * Layanan air — operasional harian di luar tagihan: pengaduan, perintah kerja, aset jaringan, permohonan sambungan, mutasi pelanggan,
 * koreksi tagihan, jaminan, angsuran, rute, meter, penagihan lapangan, pemberitahuan, produksi dan kualitas air.
 * Semua aturan murni (tanpa database) ada di sini supaya sama persis di server, layar, dan tes.
 */

// ------------------------------------------------------------------ Pengaduan & gangguan
export const COMPLAINT_CATEGORIES = ['AIR_MATI', 'AIR_KERUH', 'PIPA_BOCOR', 'TEKANAN_KECIL', 'METER_RUSAK', 'TAGIHAN_SALAH', 'SAMBUNGAN_ILEGAL', 'LAINNYA'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  AIR_MATI: 'Air tidak mengalir',
  AIR_KERUH: 'Air keruh / berbau',
  PIPA_BOCOR: 'Pipa bocor',
  TEKANAN_KECIL: 'Tekanan air kecil',
  METER_RUSAK: 'Meter rusak / tidak berputar',
  TAGIHAN_SALAH: 'Tagihan tidak sesuai',
  SAMBUNGAN_ILEGAL: 'Sambungan liar / pencurian air',
  LAINNYA: 'Lainnya',
};
/** Batas waktu penanganan (jam) menurut kategori, dipersingkat bila prioritas tinggi */
export const COMPLAINT_SLA_HOURS: Record<ComplaintCategory, number> = { AIR_MATI: 24, AIR_KERUH: 24, PIPA_BOCOR: 12, TEKANAN_KECIL: 48, METER_RUSAK: 72, TAGIHAN_SALAH: 72, SAMBUNGAN_ILEGAL: 120, LAINNYA: 72 };
export const PRIORITIES = ['RENDAH', 'NORMAL', 'TINGGI'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { RENDAH: 'Rendah', NORMAL: 'Normal', TINGGI: 'Tinggi' };
export const COMPLAINT_CHANNELS = ['TELEPON', 'DATANG', 'WHATSAPP', 'PORTAL', 'PETUGAS'] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];
export const COMPLAINT_CHANNEL_LABELS: Record<ComplaintChannel, string> = { TELEPON: 'Telepon', DATANG: 'Datang ke kantor', WHATSAPP: 'WhatsApp', PORTAL: 'Portal pelanggan', PETUGAS: 'Temuan petugas' };
export const COMPLAINT_STATUSES = ['BARU', 'DITUGASKAN', 'DIKERJAKAN', 'SELESAI', 'DITUTUP'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = { BARU: 'Baru', DITUGASKAN: 'Ditugaskan', DIKERJAKAN: 'Dikerjakan', SELESAI: 'Selesai dikerjakan', DITUTUP: 'Ditutup' };
export const COMPLAINT_NEXT: Record<ComplaintStatus, ComplaintStatus[]> = { BARU: ['DITUGASKAN'], DITUGASKAN: ['DIKERJAKAN', 'DITUGASKAN'], DIKERJAKAN: ['SELESAI'], SELESAI: ['DITUTUP', 'DIKERJAKAN'], DITUTUP: [] };
export const complaintDueAt = (category: ComplaintCategory, priority: Priority, from: Date): Date => {
  const base = COMPLAINT_SLA_HOURS[category] ?? 72;
  const hours = priority === 'TINGGI' ? Math.max(4, Math.round(base / 2)) : priority === 'RENDAH' ? base * 2 : base;
  return new Date(from.getTime() + hours * 3_600_000);
};

// ------------------------------------------------------------------ Aset jaringan & perintah kerja
export const NETWORK_ASSET_TYPES = ['SUMUR', 'IPA', 'POMPA', 'RESERVOIR', 'PIPA_TRANSMISI', 'PIPA_DISTRIBUSI', 'VALVE', 'HIDRAN', 'METER_INDUK'] as const;
export type NetworkAssetType = (typeof NETWORK_ASSET_TYPES)[number];
export const NETWORK_ASSET_LABELS: Record<NetworkAssetType, string> = { SUMUR: 'Sumur / mata air', IPA: 'Instalasi pengolahan', POMPA: 'Pompa', RESERVOIR: 'Reservoir / bak penampung', PIPA_TRANSMISI: 'Pipa transmisi', PIPA_DISTRIBUSI: 'Pipa distribusi', VALVE: 'Katup / valve', HIDRAN: 'Hidran umum', METER_INDUK: 'Meter induk zona' };
export const ASSET_CONDITIONS = ['BAIK', 'PERLU_PERAWATAN', 'RUSAK'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = { BAIK: 'Baik', PERLU_PERAWATAN: 'Perlu perawatan', RUSAK: 'Rusak' };
export const WORK_ORDER_TYPES = ['PERBAIKAN', 'PERAWATAN', 'PENGGANTIAN', 'PEMASANGAN'] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];
export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = { PERBAIKAN: 'Perbaikan', PERAWATAN: 'Perawatan rutin', PENGGANTIAN: 'Penggantian', PEMASANGAN: 'Pemasangan' };
export const WORK_ORDER_STATUSES = ['DIBUAT', 'DIKERJAKAN', 'SELESAI', 'BATAL'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = { DIBUAT: 'Dibuat', DIKERJAKAN: 'Dikerjakan', SELESAI: 'Selesai', BATAL: 'Dibatalkan' };

// ------------------------------------------------------------------ Permohonan sambungan baru
export const APPLICATION_STATUSES = ['PERMOHONAN', 'SURVEI', 'MENUNGGU_BAYAR', 'DIBAYAR', 'PEMASANGAN', 'AKTIF', 'DITOLAK', 'BATAL'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  PERMOHONAN: 'Permohonan masuk', SURVEI: 'Sudah disurvei', MENUNGGU_BAYAR: 'Menunggu pembayaran', DIBAYAR: 'Sudah dibayar', PEMASANGAN: 'Dipasang', AKTIF: 'Sambungan aktif', DITOLAK: 'Ditolak', BATAL: 'Dibatalkan',
};
/** Urutan langkah yang berjalan maju; DITOLAK/BATAL dapat terjadi sebelum AKTIF */
export const APPLICATION_FLOW: ApplicationStatus[] = ['PERMOHONAN', 'SURVEI', 'MENUNGGU_BAYAR', 'DIBAYAR', 'PEMASANGAN', 'AKTIF'];

// ------------------------------------------------------------------ Mutasi pelanggan
export const CHANGE_KINDS = ['BALIK_NAMA', 'GANTI_TARIF', 'PINDAH_ALAMAT', 'TUTUP_PERMANEN'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = { BALIK_NAMA: 'Balik nama', GANTI_TARIF: 'Ganti golongan tarif', PINDAH_ALAMAT: 'Ubah alamat / lokasi meter', TUTUP_PERMANEN: 'Tutup permanen' };
export const DECISION_STATUSES = ['DIAJUKAN', 'DISETUJUI', 'DITOLAK'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = { DIAJUKAN: 'Menunggu persetujuan', DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak' };

// ------------------------------------------------------------------ Koreksi tagihan
export const ADJUSTMENT_KINDS = ['PEMUTIHAN_DENDA', 'KOREKSI_PEMAKAIAN', 'KOMPENSASI', 'PEMBATALAN'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = { PEMUTIHAN_DENDA: 'Pemutihan denda', KOREKSI_PEMAKAIAN: 'Koreksi pemakaian / tarif', KOMPENSASI: 'Kompensasi gangguan layanan', PEMBATALAN: 'Pembatalan tagihan' };
/** Akun pendapatan yang dikurangi oleh tiap jenis koreksi */
export const ADJUSTMENT_REVENUE_KEY: Record<AdjustmentKind, string> = { PEMUTIHAN_DENDA: 'UTILITY_LATE_FEE_REVENUE', KOREKSI_PEMAKAIAN: 'UTILITY_USAGE_REVENUE', KOMPENSASI: 'UTILITY_USAGE_REVENUE', PEMBATALAN: 'UTILITY_USAGE_REVENUE' };
/** Di atas nilai ini persetujuan harus dari Admin/Pemilik (bukan Keuangan) */
export const ADJUSTMENT_ADMIN_THRESHOLD = 500_000;

/** Pecah pengurangan (termasuk PPN) menjadi bagian DPP dan PPN menurut perbandingan pada faktur */
export function splitReduction(amount: number, invoiceSubtotal: number, invoiceTax: number): { dpp: number; tax: number } {
  const total = invoiceSubtotal + invoiceTax;
  if (total <= 0 || invoiceTax <= 0) return { dpp: round2(amount), tax: 0 };
  const tax = round2((amount * invoiceTax) / total);
  return { dpp: round2(amount - tax), tax };
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------------ Jaminan & angsuran
export const DEPOSIT_MOVEMENTS = ['PENERIMAAN', 'PELUNASAN_TUNGGAKAN', 'PENGEMBALIAN'] as const;
export type DepositMovement = (typeof DEPOSIT_MOVEMENTS)[number];
export const DEPOSIT_MOVEMENT_LABELS: Record<DepositMovement, string> = { PENERIMAAN: 'Diterima', PELUNASAN_TUNGGAKAN: 'Dipakai melunasi tunggakan', PENGEMBALIAN: 'Dikembalikan ke pelanggan' };
export const INSTALLMENT_STATUSES = ['DIAJUKAN', 'AKTIF', 'LUNAS', 'MACET', 'BATAL'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];
export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = { DIAJUKAN: 'Menunggu persetujuan', AKTIF: 'Berjalan', LUNAS: 'Lunas', MACET: 'Macet', BATAL: 'Dibatalkan' };
/** Angsuran dianggap macet bila lewat jatuh tempo sekian hari dan belum tertutup pembayaran */
export const INSTALLMENT_DEFAULT_DAYS = 14;

export interface InstallmentRow { seq: number; dueDate: string; amount: number }
/** Jadwal angsuran: nilai dibagi rata, selisih pembulatan masuk ke angsuran terakhir */
export function buildInstallments(total: number, count: number, firstDue: string, intervalDays: number): InstallmentRow[] {
  const n = Math.max(1, Math.floor(count));
  const each = Math.floor((total / n) * 100) / 100;
  const out: InstallmentRow[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(`${firstDue}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * intervalDays);
    const amount = i === n - 1 ? round2(total - sum) : each;
    sum = round2(sum + amount);
    out.push({ seq: i + 1, dueDate: d.toISOString().slice(0, 10), amount });
  }
  return out;
}
/** Status tiap angsuran dari total yang sudah dibayar sejak rencana dibuat: tertutup berurutan dari yang pertama */
export function installmentProgress(items: InstallmentRow[], paidSinceStart: number, today: string): { seq: number; dueDate: string; amount: number; paid: number; status: 'LUNAS' | 'SEBAGIAN' | 'BELUM' | 'TERLAMBAT' }[] {
  let left = paidSinceStart;
  return items.map((it) => {
    const paid = Math.max(0, Math.min(it.amount, left));
    left = round2(left - paid);
    const status = paid >= it.amount - 0.005 ? 'LUNAS' : it.dueDate < today ? 'TERLAMBAT' : paid > 0 ? 'SEBAGIAN' : 'BELUM';
    return { ...it, paid, status };
  });
}

// ------------------------------------------------------------------ Meter
export const METER_STATUSES = ['STOK', 'TERPASANG', 'RUSAK', 'PENSIUN'] as const;
export type MeterStatus = (typeof METER_STATUSES)[number];
export const METER_STATUS_LABELS: Record<MeterStatus, string> = { STOK: 'Di gudang', TERPASANG: 'Terpasang', RUSAK: 'Rusak', PENSIUN: 'Pensiun' };
export const METER_SIZES = ['1/2"', '3/4"', '1"', '1 1/2"', '2"'] as const;
/** Meter air wajib ditera ulang berkala (bawaan 5 tahun) */
export const METER_CALIBRATION_YEARS = 5;
export const METER_EVENT_LABELS: Record<string, string> = { REGISTRASI: 'Didaftarkan', PASANG: 'Dipasang', LEPAS: 'Dilepas', TERA: 'Ditera ulang', RUSAK: 'Ditandai rusak', PENSIUN: 'Dipensiunkan' };
export const addYears = (date: string, years: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

/**
 * Pemakaian taksiran untuk meter yang tidak terbaca: rata-rata pemakaian nyata terakhir (maksimal 3 periode).
 * Tanpa riwayat sama sekali tidak ditaksir (kembalikan null) — petugas harus mencatat angka nyata.
 */
export function estimateUsage(history: number[]): number | null {
  const h = history.filter((x) => Number.isFinite(x) && x >= 0).slice(0, 3);
  if (!h.length) return null;
  return Math.round((h.reduce((a, b) => a + b, 0) / h.length) * 100) / 100;
}
/**
 * Pemakaian pada pembacaan nyata pertama setelah taksiran: pemakaian sejak pembacaan nyata terakhir dikurangi yang sudah ditagih
 * sebagai taksiran. Tidak pernah negatif (kelebihan taksiran tidak dikreditkan otomatis; koreksi lewat Koreksi tagihan).
 */
export function trueUpUsage(current: number, lastActual: number, estimatedBilled: number): { usage: number; overEstimate: number } {
  const real = current - lastActual;
  const usage = real - estimatedBilled;
  return usage >= 0 ? { usage: round2(usage), overEstimate: 0 } : { usage: 0, overEstimate: round2(-usage) };
}

// ------------------------------------------------------------------ Penagihan lapangan & pemberitahuan
export const VISIT_OUTCOMES = ['BAYAR', 'JANJI_BAYAR', 'TIDAK_ADA', 'MENOLAK', 'PINDAH', 'LAINNYA'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const VISIT_OUTCOME_LABELS: Record<VisitOutcome, string> = { BAYAR: 'Membayar', JANJI_BAYAR: 'Janji bayar', TIDAK_ADA: 'Tidak ada di tempat', MENOLAK: 'Menolak membayar', PINDAH: 'Sudah pindah', LAINNYA: 'Lainnya' };
export const NOTICE_KINDS = ['REKENING', 'PENGINGAT', 'SP1', 'SP2', 'SP3', 'TAUTAN'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = { REKENING: 'Rekening tagihan', PENGINGAT: 'Pengingat jatuh tempo', SP1: 'Surat peringatan 1', SP2: 'Surat peringatan 2', SP3: 'Surat peringatan 3 (pemutusan)', TAUTAN: 'Tautan portal pelanggan' };
export const NOTICE_CHANNELS = ['CETAK', 'WHATSAPP', 'SMS', 'EMAIL'] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];
export const NOTICE_CHANNEL_LABELS: Record<NoticeChannel, string> = { CETAK: 'Dicetak', WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'Email' };
/** Tingkat surat peringatan menurut lama keterlambatan (hari setelah jatuh tempo) */
export const SP_LEVELS: { kind: 'SP1' | 'SP2' | 'SP3'; minDaysLate: number }[] = [{ kind: 'SP1', minDaysLate: 7 }, { kind: 'SP2', minDaysLate: 21 }, { kind: 'SP3', minDaysLate: 35 }];
export function spLevelFor(daysLate: number): 'SP1' | 'SP2' | 'SP3' | null {
  let out: 'SP1' | 'SP2' | 'SP3' | null = null;
  for (const l of SP_LEVELS) if (daysLate >= l.minDaysLate) out = l.kind;
  return out;
}
/** Tautan wa.me berisi pesan; nomor dinormalkan ke format internasional Indonesia */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const intl = digits.startsWith('62') ? digits : digits.startsWith('0') ? `62${digits.slice(1)}` : digits.startsWith('8') ? `62${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

// ------------------------------------------------------------------ Produksi & kualitas air
/** Baku mutu air minum (acuan Permenkes 492/2010, disederhanakan untuk pengujian harian) */
export const WATER_QUALITY_LIMITS = {
  ph: { min: 6.5, max: 8.5, label: 'pH' },
  turbidity: { max: 5, label: 'Kekeruhan (NTU)' },
  chlorine: { min: 0.2, max: 1.0, label: 'Sisa klor (mg/L)' },
  coliform: { max: 0, label: 'Total coliform (/100 mL)' },
  tds: { max: 500, label: 'Zat padat terlarut (mg/L)' },
} as const;
export interface WaterSample { ph?: number | null; turbidity?: number | null; chlorine?: number | null; coliform?: number | null; tds?: number | null }
export function evaluateWaterQuality(s: WaterSample): { ok: boolean; failed: string[] } {
  const failed: string[] = [];
  const L = WATER_QUALITY_LIMITS;
  if (s.ph != null && (s.ph < L.ph.min || s.ph > L.ph.max)) failed.push('ph');
  if (s.turbidity != null && s.turbidity > L.turbidity.max) failed.push('turbidity');
  if (s.chlorine != null && (s.chlorine < L.chlorine.min || s.chlorine > L.chlorine.max)) failed.push('chlorine');
  if (s.coliform != null && s.coliform > L.coliform.max) failed.push('coliform');
  if (s.tds != null && s.tds > L.tds.max) failed.push('tds');
  return { ok: failed.length === 0, failed };
}
/** Air tak berekening (NRW) = (air didistribusikan − air terjual) / air didistribusikan; batas wajar menurut PDAM 20–30% */
export function nonRevenueWater(distributed: number, billed: number): { volume: number; pct: number | null } {
  const volume = round2(distributed - billed);
  return { volume, pct: distributed > 0 ? round2((volume / distributed) * 100) : null };
}
export const NRW_WARN_PCT = 30;
