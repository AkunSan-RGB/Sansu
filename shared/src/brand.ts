/** Identitas brand SANSU — dipakai UI, dokumentasi API, dan dokumen cetak. */
export const BRAND = {
  name: 'SANSU',
  /** Badan usaha pemilik merek SANSU */
  company: 'PT SANSU GLOBAL INTI',
  tagline: 'Alur Bisnis Terhubung dalam Satu Sistem',
  /** Posisi produk (meta, dokumentasi API, materi pemasaran) */
  positioning: 'Sistem bisnis terpadu untuk UKM dagang, ritel, jasa, FMCG, manufaktur, dan F&B',
  /** Nilai di balik nama SANSU — ditampilkan di halaman awal */
  values: [
    { letter: 'S', word: 'Synergy', text: 'Mengintegrasikan seluruh proses bisnis dalam satu platform.' },
    { letter: 'A', word: 'Adaptive', text: 'Sistem yang fleksibel dan dinamis mengikuti perkembangan serta kebutuhan operasional bisnis.' },
    { letter: 'N', word: 'Nimble', text: 'Sistem yang cepat, ringan, dan responsif untuk kelancaran operasional sehari-hari.' },
    { letter: 'S', word: 'Simple', text: 'Antarmuka yang intuitif dan mudah digunakan oleh siapa saja tanpa pelatihan rumit.' },
    { letter: 'U', word: 'Ultimate', text: 'Menjadi solusi menyeluruh dan terpercaya untuk keberlanjutan bisnis.' },
  ],
  colors: {
    /** Warna utama: biru navy logo SANSU (teks putih di atasnya kontras >10:1) */
    primary: '#111111',
    primaryHover: '#2B2B2B',
    /** Latar lembut untuk sorotan / pilihan aktif */
    primarySoft: '#F2F2F2',
    /** Navy pekat persis seperti tanda "S" */
    mark: '#0A0A0A',
    /** Navigasi & latar gelap */
    ink: '#0A0A0A',
    inkSoft: '#1A1A1A',
    /** Aksen: hijau zamrud garis diagonal logo */
    accent: '#16A37B',
    surface: '#F5F7FA',
  },
  font: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;
