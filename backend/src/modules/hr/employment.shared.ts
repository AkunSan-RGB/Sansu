

export const EMPLOYMENT_TYPES = ['TETAP', 'KONTRAK', 'HARIAN', 'TENAGA_LEPAS', 'MAGANG', 'MITRA'] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  TETAP: 'Karyawan tetap',
  KONTRAK: 'Kontrak (PKWT)',
  HARIAN: 'Harian',
  TENAGA_LEPAS: 'Tenaga lepas (per pekerjaan)',
  MAGANG: 'Magang',
  MITRA: 'Mitra / konsultan',
};

/** Dibayar lewat catatan kerja, bukan gaji tetap; tidak absen harian */
export const isPerJob = (t: string) => t === 'TENAGA_LEPAS' || t === 'MITRA';
