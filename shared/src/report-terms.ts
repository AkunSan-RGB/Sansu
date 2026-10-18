/**
 * Istilah & teks laporan keuangan menurut jenis usaha. Dipakai Laporan Laba Rugi dan CALK agar
 * perusahaan jasa tidak membaca "penjualan barang dagang" dan perusahaan produksi memakai
 * istilah beban pokok produksi. Angka tidak berubah; hanya label dan kalimat penjelasan.
 */
import type { BusinessModel } from './apps.js';

export interface ReportTerms {
  /** Label baris pendapatan di laba rugi */
  revenueLabel: string;
  /** Label baris beban pokok di laba rugi */
  cogsLabel: string;
  /** Kegiatan usaha bawaan untuk CALK bagian Umum */
  activity: string;
  /** "berasal dari ..." untuk catatan piutang dan pendapatan */
  revenueSource: string;
  /** Kalimat catatan Pendapatan usaha */
  revenueNote: string;
  /** Kalimat catatan Piutang usaha */
  receivableNote: string;
  /** Kalimat awal catatan Persediaan (bila ada persediaan) */
  inventoryNote: string;
  /** Kalimat catatan Beban pokok */
  cogsNote: string;
  /** Kalimat catatan Utang usaha */
  payableNote: string;
  /** Kalimat kebijakan pengakuan pendapatan dan beban */
  recognitionPolicy: string;
}

const TRADING_RECOGNITION =
  'Pendapatan dari penjualan barang diakui pada saat pengendalian atas barang berpindah kepada pelanggan, yaitu saat barang diserahkan dan faktur diterbitkan, sebesar nilai wajar imbalan setelah dikurangi retur dan potongan. Beban diakui pada saat terjadinya (dasar akrual).';

const TRADING_COGS =
  'Beban pokok penjualan dihitung dari biaya rata-rata tertimbang barang yang terjual, termasuk selisih hasil perhitungan fisik persediaan.';

const PAYABLE = (source: string) => `Utang usaha merupakan utang kepada ${source}, tanpa jaminan dan tanpa bunga, dengan jangka waktu kredit 14–60 hari.`;

export const REPORT_TERMS: Record<BusinessModel, ReportTerms> = {
  DAGANG: {
    revenueLabel: 'Pendapatan usaha',
    cogsLabel: 'Beban pokok penjualan',
    activity: 'perdagangan besar (distribusi) barang konsumsi',
    revenueSource: 'penjualan barang dagang',
    revenueNote: 'Seluruh pendapatan berasal dari penjualan barang dagang di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan barang kepada pihak ketiga.',
    inventoryNote: 'Persediaan terdiri dari barang dagang yang siap dijual.',
    cogsNote: TRADING_COGS,
    payableNote: PAYABLE('pemasok barang dagang'),
    recognitionPolicy: TRADING_RECOGNITION,
  },
  RITEL: {
    revenueLabel: 'Pendapatan usaha',
    cogsLabel: 'Beban pokok penjualan',
    activity: 'perdagangan eceran (ritel) barang kebutuhan konsumen melalui toko',
    revenueSource: 'penjualan barang dagang',
    revenueNote: 'Seluruh pendapatan berasal dari penjualan eceran barang dagang kepada konsumen, terutama melalui kasir toko, di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan barang secara kredit kepada pihak ketiga; penjualan kasir diterima tunai atau melalui pembayaran digital.',
    inventoryNote: 'Persediaan terdiri dari barang dagang yang siap dijual di toko.',
    cogsNote: TRADING_COGS,
    payableNote: PAYABLE('pemasok barang dagang'),
    recognitionPolicy:
      'Pendapatan dari penjualan eceran diakui pada saat barang diserahkan kepada pembeli di kasir dan pembayaran diterima, sebesar nilai wajar imbalan setelah dikurangi retur dan potongan. Selisih kas kasir diakui sebagai beban pada periode terjadinya. Beban diakui pada saat terjadinya (dasar akrual).',
  },
  UTILITAS: {
    revenueLabel: 'Pendapatan layanan utilitas',
    cogsLabel: 'Beban pokok layanan',
    activity: 'penyediaan layanan utilitas berlangganan (pemakaian terukur dan abonemen) kepada pelanggan',
    revenueSource: 'tagihan layanan utilitas',
    revenueNote: 'Pendapatan berasal dari tagihan pemakaian terukur, abonemen, biaya sambung baru, dan denda keterlambatan kepada pelanggan di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari tagihan layanan bulanan kepada pelanggan; tunggakan lama dipantau lewat umur piutang dan penyisihan.',
    inventoryNote: 'Persediaan terdiri dari bahan pemasangan dan perawatan jaringan (pipa, kabel, meter, bahan pengolahan).',
    cogsNote: 'Beban pokok layanan terdiri dari pembelian energi/air baku, bahan pengolahan, dan biaya langsung operasi jaringan.',
    payableNote: PAYABLE('pemasok energi, air baku, dan bahan jaringan'),
    recognitionPolicy:
      'Pendapatan pemakaian diakui pada periode pemakaian berdasarkan catatan meter yang telah diverifikasi, sebesar tarif yang berlaku; abonemen diakui per periode layanan. Biaya sambung baru diakui saat sambungan aktif. Denda keterlambatan diakui saat dikenakan. Beban diakui pada saat terjadinya (dasar akrual).',
  },
  JASA: {
    revenueLabel: 'Pendapatan jasa',
    cogsLabel: 'Beban pokok pendapatan',
    activity: 'penyediaan jasa kepada pelanggan',
    revenueSource: 'penyerahan jasa',
    revenueNote: 'Seluruh pendapatan berasal dari penyerahan jasa dan pekerjaan kepada pelanggan di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penagihan jasa dan pekerjaan kepada pihak ketiga.',
    inventoryNote: 'Persediaan terdiri dari perlengkapan dan bahan yang digunakan dalam penyelesaian pekerjaan.',
    cogsNote:
      'Beban pokok pendapatan terdiri dari biaya langsung penyelesaian pekerjaan, antara lain bahan, upah langsung, dan subkontraktor, yang dibebankan pada pekerjaan atau proyek terkait.',
    payableNote: PAYABLE('pemasok dan subkontraktor'),
    recognitionPolicy:
      'Pendapatan jasa diakui berdasarkan tahap penyelesaian pekerjaan (persentase kemajuan) dan ditagih per termin. Selisih antara pendapatan yang telah diakui dan yang telah ditagih disajikan sebagai pendapatan belum ditagih (aset kontrak) atau pendapatan diterima dimuka (liabilitas kontrak). Uang muka pelanggan disajikan sebagai liabilitas sampai dipakai melunasi tagihan. Beban diakui pada saat terjadinya (dasar akrual).',
  },
  FMCG: {
    revenueLabel: 'Penjualan neto',
    cogsLabel: 'Harga pokok penjualan',
    activity: 'distribusi dan penjualan barang konsumen cepat laku kepada toko dan outlet',
    revenueSource: 'penjualan barang konsumen kepada outlet dan pelanggan usaha',
    revenueNote: 'Seluruh pendapatan berasal dari penjualan barang konsumen kepada toko, outlet, dan pelanggan usaha di dalam negeri, disajikan neto setelah potongan penjualan dan retur.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan barang kepada outlet dan pelanggan usaha pihak ketiga.',
    inventoryNote: 'Persediaan terdiri dari barang jadi konsumen yang dibeli untuk dijual kembali, dinilai per lot dan ditelaah masa kedaluwarsanya.',
    cogsNote:
      'Harga pokok penjualan terdiri dari harga perolehan barang yang terjual, termasuk barang bonus yang diberikan sebagai bagian dari promosi penjualan, dihitung dengan biaya rata-rata tertimbang atau FIFO sesuai kebijakan Perusahaan.',
    payableNote: PAYABLE('prinsipal dan pemasok barang'),
    recognitionPolicy: TRADING_RECOGNITION,
  },
  MANUFAKTUR: {
    revenueLabel: 'Pendapatan usaha',
    cogsLabel: 'Beban pokok produksi dan penjualan',
    activity: 'industri manufaktur (pengolahan bahan baku bertahap menjadi barang jadi) dan penjualan barang jadi',
    revenueSource: 'penjualan barang hasil manufaktur',
    revenueNote: 'Seluruh pendapatan berasal dari penjualan barang jadi hasil manufaktur Perusahaan di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan barang jadi hasil manufaktur kepada pihak ketiga.',
    inventoryNote: 'Persediaan terdiri dari bahan baku, bahan penolong dan kemasan, barang dalam proses, barang setengah jadi, dan barang jadi.',
    cogsNote:
      'Beban pokok produksi dan penjualan terdiri dari bahan baku, upah langsung, dan overhead pabrik yang dibebankan pada barang jadi yang terjual, dihitung dengan biaya rata-rata tertimbang. Biaya konversi dibebankan ke persediaan berdasarkan tarif standar; selisih antara biaya konversi sesungguhnya dan yang dibebankan, serta selisih pemakaian bahan dan hasil produksi, diakui sebagai beban pokok pada periode terjadinya.',
    payableNote: PAYABLE('pemasok bahan baku, bahan penolong, dan barang'),
    recognitionPolicy: TRADING_RECOGNITION,
  },
  FNB: {
    revenueLabel: 'Pendapatan usaha',
    cogsLabel: 'Beban pokok penjualan',
    activity: 'penyediaan makanan dan minuman (kafe, restoran, katering) yang diolah dari bahan dan dijual kepada konsumen',
    revenueSource: 'penjualan makanan dan minuman',
    revenueNote: 'Seluruh pendapatan berasal dari penjualan makanan dan minuman kepada konsumen, terutama melalui kasir outlet, di dalam negeri.',
    receivableNote: 'Piutang usaha seluruhnya dalam Rupiah dan berasal dari penjualan secara kredit (mis. katering) serta pembayaran digital yang belum dicairkan.',
    inventoryNote: 'Persediaan terdiri dari bahan makanan dan minuman, bahan penolong dan kemasan, serta barang setengah jadi (mis. saus dan adonan).',
    cogsNote: 'Beban pokok penjualan dihitung dari biaya bahan sesuai resep atas menu yang terjual, ditambah bahan terbuang (basi, kedaluwarsa, tumpah) pada periode terjadinya.',
    payableNote: PAYABLE('pemasok bahan makanan dan minuman'),
    recognitionPolicy:
      'Pendapatan dari penjualan makanan dan minuman diakui pada saat pesanan diserahkan kepada pembeli di kasir dan pembayaran diterima, sebesar nilai wajar imbalan setelah dikurangi retur dan potongan. Bahan terpakai diakui sebagai beban pokok penjualan pada saat menu terjual. Selisih kas kasir diakui sebagai beban pada periode terjadinya. Beban diakui pada saat terjadinya (dasar akrual).',
  },
};

/** Teks kegiatan usaha bawaan semua model — dipakai mengenali bahwa pengguna belum mengubahnya */
export const DEFAULT_ACTIVITIES: readonly string[] = Object.values(REPORT_TERMS).map((t) => t.activity);

/**
 * Kegiatan usaha untuk CALK: teks yang diisi pengguna dipakai apa adanya; bila masih berupa teks bawaan
 * (model mana pun) maka mengikuti model usaha yang berlaku sekarang.
 */
export function activityFor(model: BusinessModel, saved: string | null | undefined): string {
  const text = (saved ?? '').trim();
  return !text || DEFAULT_ACTIVITIES.includes(text) ? REPORT_TERMS[model].activity : text;
}
