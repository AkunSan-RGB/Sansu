

export const KEY = 'bins';

export const UNASSIGNED_CODE = 'BELUM-DITEMPATKAN';

export const KIND: Record<string, { label: string; color?: string }> = {
  STORAGE: { label: 'Simpan', color: 'blue' },
  STAGING: { label: 'Penyiapan', color: 'cyan' },
  DAMAGED: { label: 'Rusak', color: 'red' },
  QUARANTINE: { label: 'Karantina', color: 'orange' },
  UNASSIGNED: { label: 'Belum ditempatkan', color: 'gold' },
};
