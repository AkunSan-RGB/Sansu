/**
 * Profil layanan untuk jenis usaha Jasa: satu perusahaan jasa memilih satu atau lebih profil sesuai pekerjaannya.
 * Profil hanya mengatur apa yang tampil (menu, Ruang kerja, bantuan); akun, pajak, dan SDM sama untuk semua profil.
 */
export const SERVICE_PROFILE_KEYS = ['KONSULTAN', 'KONTRAKTOR', 'PENDIDIKAN', 'ALIH_DAYA', 'BENGKEL'] as const;
export type ServiceProfile = (typeof SERVICE_PROFILE_KEYS)[number];

export const SERVICE_PROFILES: Record<ServiceProfile, { label: string; desc: string }> = {
  KONSULTAN: { label: 'Konsultan / agensi / profesional', desc: 'Proyek, jam kerja klien, retainer bulanan.' },
  KONTRAKTOR: { label: 'Kontraktor / proyek', desc: 'Proyek bertermin, retensi, BoQ/RAB, biaya proyek.' },
  PENDIDIKAN: { label: 'Pendidikan / kursus', desc: 'Kelas, peserta, SPP bulanan per wali.' },
  ALIH_DAYA: { label: 'Alih daya per lokasi (kebersihan, keamanan)', desc: 'Kontrak per lokasi, pos jaga, jadwal jaga, tagihan bulanan.' },
  BENGKEL: { label: 'Bengkel / salon / layanan di kasir', desc: 'Layanan dijual di kasir dengan petugas, bahan habis pakai.' },
};

/** Perusahaan Jasa baru mulai sederhana; perusahaan lama (belum memilih) tetap melihat semuanya */
export const NEW_SERVICE_PROFILES: ServiceProfile[] = ['KONSULTAN'];
export const ALL_SERVICE_PROFILES: ServiceProfile[] = [...SERVICE_PROFILE_KEYS];

export function isServiceProfile(v: unknown): v is ServiceProfile {
  return (SERVICE_PROFILE_KEYS as readonly string[]).includes(v as string);
}
