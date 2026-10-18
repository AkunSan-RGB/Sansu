/**
 * Satuan upah kerja per jenis usaha. Satu mesin catatan kerja (tarif → catatan → persetujuan orang lain → slip gaji) dipakai semua jenis
 * usaha, tetapi satuan yang masuk akal berbeda: jasa dibayar per jam/sesi/komisi, toko & kafe & pabrik per shift, pabrik & gudang per hasil.
 * Lembur karyawan bergaji tetap tetap lewat Absensi (jam lembur), bukan dari sini, agar tidak terbayar dua kali.
 */
import type { BusinessModel } from './apps.js';

export const WORK_UNITS = ['HOUR', 'SESSION', 'JOB', 'PERCENT', 'SHIFT', 'PIECE'] as const;
export type WorkUnit = (typeof WORK_UNITS)[number];

export const WORK_UNIT_LABELS: Record<WorkUnit, string> = {
  HOUR: 'per jam',
  SESSION: 'per sesi',
  JOB: 'per pekerjaan (borongan)',
  PERCENT: 'komisi % dari faktur jasa',
  SHIFT: 'per shift',
  PIECE: 'per hasil (unit/koli)',
};

export const WORK_UNITS_BY_MODEL: Record<BusinessModel, WorkUnit[]> = {
  UTILITAS: ['JOB', 'SHIFT'],
  JASA: ['HOUR', 'SESSION', 'JOB', 'PERCENT'],
  RITEL: ['SHIFT', 'JOB'],
  FNB: ['SHIFT', 'JOB'],
  MANUFAKTUR: ['PIECE', 'JOB', 'SHIFT'],
  DAGANG: ['PIECE', 'JOB'],
  FMCG: ['PIECE', 'JOB'],
};

/** Nama menu & judul halaman per jenis usaha */
export const WORK_PAGE_TITLE: Record<BusinessModel, string> = {
  UTILITAS: 'Upah petugas lapangan (pasang & catat meter)',
  JASA: 'Upah jasa (jam, sesi, komisi)',
  RITEL: 'Premi shift & borongan',
  FNB: 'Premi shift & borongan katering',
  MANUFAKTUR: 'Upah borongan & per hasil',
  DAGANG: 'Upah borongan gudang',
  FMCG: 'Upah borongan gudang',
};

export const WORK_LIMITS = { shiftPerDay: 2, maxPieceQty: 100000 } as const;
