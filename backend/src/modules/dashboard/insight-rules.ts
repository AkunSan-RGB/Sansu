/**
 * Aturan insight & rekomendasi beranda untuk pimpinan. Murni (tanpa database) agar mudah diuji.
 * Setiap aturan menerima angka yang sudah dihitung dari pembukuan/transaksi dan mengembalikan satu temuan (atau null bila tidak ada
 * yang perlu disampaikan). Bahasa dibuat sebagai SARAN yang dapat diikuti atau diabaikan: bukan perintah dan bukan temuan audit.
 */
export type InsightCategory = 'KAS' | 'PENJUALAN' | 'PIUTANG' | 'HUTANG' | 'MARGIN' | 'BIAYA' | 'PERSEDIAAN' | 'PELANGGAN' | 'PRODUK';
export type InsightTone = 'warning' | 'opportunity' | 'good' | 'info';

export interface DashboardInsight {
  id: string;
  category: InsightCategory;
  tone: InsightTone;
  title: string;
  /** Fakta berangka yang mendasari saran */
  evidence: string;
  /** Saran tindakan (boleh diikuti atau tidak) */
  recommendation: string;
  /** Nilai uang yang terkait, untuk ditonjolkan di kartu */
  impact?: { label: string; amount: number };
  /** Angka kunci yang ditampilkan sebagai label kecil */
  facts?: { label: string; value: string }[];
  link?: string;
  linkLabel?: string;
  /** Prioritas urutan tampil (lebih besar = lebih atas) */
  score: number;
}

/** Rupiah ringkas untuk kalimat: Rp1,2 miliar · Rp350 juta · Rp85 ribu */
export function idr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const one = (v: number) => v.toFixed(1).replace('.', ',').replace(/,0$/, '');
  if (a >= 1e9) return `${sign}Rp${one(a / 1e9)} miliar`;
  if (a >= 1e6) return `${sign}Rp${one(a / 1e6)} juta`;
  if (a >= 1e3) return `${sign}Rp${Math.round(a / 1e3).toLocaleString('id-ID')} ribu`;
  return `${sign}Rp${Math.round(a).toLocaleString('id-ID')}`;
}
export const pctText = (v: number, digits = 0) => `${(v * 100).toFixed(digits).replace('.', ',')}%`;
/** Kenaikan besar dibaca "kali lipat" agar tidak terbaca sebagai ribuan persen */
const riseText = (change: number) => (change > 3 ? `naik ±${(change + 1).toFixed(1).replace('.', ',').replace(/,0$/, '')} kali lipat` : `naik ${pctText(change)}`);
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]}`);

/** Berapa bulan biaya yang dapat ditutup kas saat ini */
export function runwayInsight(i: { cash: number; monthlyCost: number }): DashboardInsight | null {
  if (!(i.monthlyCost > 0)) return null;
  const months = i.cash / i.monthlyCost;
  const facts = [
    { label: 'Saldo kas & bank', value: idr(i.cash) },
    { label: 'Biaya rata-rata/bulan', value: idr(i.monthlyCost) },
  ];
  const link = '/cash';
  if (i.cash <= 0) {
    return { id: 'kas-runway', category: 'KAS', tone: 'warning', title: 'Saldo kas nol atau negatif', evidence: `Saldo kas & bank ${idr(i.cash)}, sedangkan biaya rata-rata sekitar ${idr(i.monthlyCost)} per bulan.`, recommendation: 'Prioritaskan penagihan piutang, tunda belanja yang tidak mendesak, dan pertimbangkan tambahan modal kerja atau penjadwalan ulang pembayaran ke pemasok.', facts, link, linkLabel: 'Buka Kas & Bank', score: 100 };
  }
  const m = months.toFixed(1).replace('.', ',');
  if (months < 1) return { id: 'kas-runway', category: 'KAS', tone: 'warning', title: `Kas hanya cukup ±${m} bulan biaya`, evidence: `Saldo ${idr(i.cash)} dibanding biaya rata-rata ${idr(i.monthlyCost)} per bulan (HPP dan beban usaha, 3 bulan terakhir).`, recommendation: 'Percepat penagihan piutang, tunda belanja non-esensial, dan negosiasikan termin pembayaran pemasok. Pertimbangkan kebutuhan modal kerja sebelum kas menipis.', facts: [...facts, { label: 'Daya tahan kas', value: `±${m} bln` }], link, linkLabel: 'Buka Kas & Bank', score: 95 };
  if (months < 3) return { id: 'kas-runway', category: 'KAS', tone: 'warning', title: `Kas cukup ±${m} bulan biaya`, evidence: `Saldo ${idr(i.cash)} dibanding biaya rata-rata ${idr(i.monthlyCost)} per bulan.`, recommendation: 'Jaga agar kas tidak turun di bawah 3 bulan biaya: tagih piutang tepat waktu dan atur jadwal pembelian besar.', facts: [...facts, { label: 'Daya tahan kas', value: `±${m} bln` }], link, linkLabel: 'Buka Kas & Bank', score: 70 };
  if (months < 6) return { id: 'kas-runway', category: 'KAS', tone: 'info', title: `Kas cukup ±${m} bulan biaya`, evidence: `Saldo ${idr(i.cash)} dibanding biaya rata-rata ${idr(i.monthlyCost)} per bulan.`, recommendation: 'Posisi kas memadai. Pertahankan disiplin penagihan agar tetap di atas 3 bulan biaya.', facts: [...facts, { label: 'Daya tahan kas', value: `±${m} bln` }], link, linkLabel: 'Buka Kas & Bank', score: 20 };
  return { id: 'kas-runway', category: 'KAS', tone: 'good', title: `Kas kuat: cukup ±${m} bulan biaya`, evidence: `Saldo ${idr(i.cash)} dibanding biaya rata-rata ${idr(i.monthlyCost)} per bulan.`, recommendation: 'Ada ruang untuk memanfaatkan kas: misalnya diskon pelunasan dari pemasok, tambahan stok barang laris, atau investasi yang sudah direncanakan. Sisakan cadangan minimal 3 bulan biaya.', facts: [...facts, { label: 'Daya tahan kas', value: `±${m} bln` }], link, linkLabel: 'Buka Kas & Bank', score: 18 };
}

/** Penjualan bulan berjalan dibanding periode yang sama bulan lalu */
export function salesTrendInsight(i: { mtd: number; prevSame: number; daysElapsed: number; daysInMonth: number; monthsWithSales?: number }): DashboardInsight | null {
  // usaha yang baru mulai (kurang dari 2 bulan berjualan) belum punya pembanding yang layak
  if (i.daysElapsed < 5 || !(i.prevSame > 0) || (i.monthsWithSales ?? 3) < 2) return null;
  const change = (i.mtd - i.prevSame) / i.prevSame;
  if (Math.abs(change) < 0.1) return null;
  const projected = (i.mtd / i.daysElapsed) * i.daysInMonth;
  const facts = [
    { label: 'Bulan ini (s.d. hari ini)', value: idr(i.mtd) },
    { label: 'Periode sama bulan lalu', value: idr(i.prevSame) },
    { label: 'Proyeksi akhir bulan', value: idr(projected) },
  ];
  if (change <= -0.15) {
    return { id: 'jual-tren', category: 'PENJUALAN', tone: 'warning', title: `Penjualan turun ${pctText(-change)} dari periode sama bulan lalu`, evidence: `Sampai hari ke-${i.daysElapsed}: ${idr(i.mtd)}, dibanding ${idr(i.prevSame)} pada periode yang sama bulan lalu.`, recommendation: 'Cari tahu penyebabnya: pelanggan besar yang berkurang, barang laris yang kosong, atau musim. Bila sifatnya sementara, dorong dengan promo atau kunjungan ke pelanggan utama.', impact: { label: 'Selisih sementara', amount: i.mtd - i.prevSame }, facts, link: '/reports', linkLabel: 'Lihat laporan', score: 78 };
  }
  if (change >= 0.15) {
    return { id: 'jual-tren', category: 'PENJUALAN', tone: 'good', title: `Penjualan ${riseText(change)} dari periode sama bulan lalu`, evidence: `Sampai hari ke-${i.daysElapsed}: ${idr(i.mtd)}, dibanding ${idr(i.prevSame)}. Bila tren berlanjut, bulan ini berakhir sekitar ${idr(projected)}.`, recommendation: 'Pastikan stok barang laris cukup dan kapasitas layanan memadai agar kenaikan tidak tersendat. Cek juga apakah kenaikan datang dari margin yang sehat.', impact: { label: 'Selisih sementara', amount: i.mtd - i.prevSame }, facts, link: '/reports', linkLabel: 'Lihat laporan', score: 40 };
  }
  return { id: 'jual-tren', category: 'PENJUALAN', tone: change > 0 ? 'good' : 'info', title: `Penjualan ${change > 0 ? 'naik' : 'turun'} ${pctText(Math.abs(change))} dari periode sama bulan lalu`, evidence: `Sampai hari ke-${i.daysElapsed}: ${idr(i.mtd)}, dibanding ${idr(i.prevSame)}.`, recommendation: 'Perubahan masih wajar; pantau terus sampai akhir bulan.', facts, link: '/reports', linkLabel: 'Lihat laporan', score: 12 };
}

/** Margin kotor bulan ini dibanding rata-rata bulan sebelumnya */
export function marginInsight(i: { gm: number; avgPrev: number; sales: number }): DashboardInsight | null {
  if (!(i.sales > 0)) return null;
  const diff = (i.gm - i.avgPrev) * 100; // poin persen
  const facts = [
    { label: 'Margin kotor bulan ini', value: pctText(i.gm, 1) },
    { label: 'Rata-rata 3 bulan lalu', value: pctText(i.avgPrev, 1) },
  ];
  if (diff <= -3) {
    return { id: 'margin-turun', category: 'MARGIN', tone: 'warning', title: `Margin kotor turun ${Math.abs(diff).toFixed(1).replace('.', ',')} poin`, evidence: `Margin kotor bulan ini ${pctText(i.gm, 1)}, dibanding rata-rata ${pctText(i.avgPrev, 1)} pada 3 bulan sebelumnya. Dengan penjualan ${idr(i.sales)}, selisihnya setara sekitar ${idr((Math.abs(diff) / 100) * i.sales)} laba kotor.`, recommendation: 'Periksa kenaikan harga beli dari pemasok, diskon yang diberikan, dan barang yang dijual di bawah harga pokok. Bila perlu, sesuaikan harga jual atau renegosiasi harga beli.', impact: { label: 'Laba kotor yang tergerus', amount: (Math.abs(diff) / 100) * i.sales }, facts, link: '/reports', linkLabel: 'Lihat laporan', score: 72 };
  }
  if (diff >= 3) {
    return { id: 'margin-naik', category: 'MARGIN', tone: 'good', title: `Margin kotor membaik ${diff.toFixed(1).replace('.', ',')} poin`, evidence: `Margin kotor bulan ini ${pctText(i.gm, 1)}, di atas rata-rata ${pctText(i.avgPrev, 1)} pada 3 bulan sebelumnya.`, recommendation: 'Cari tahu penyebabnya (harga jual, bauran produk, atau harga beli) agar bisa dipertahankan.', facts, link: '/reports', linkLabel: 'Lihat laporan', score: 30 };
  }
  return null;
}

/** Piutang yang lewat jatuh tempo */
export function overdueReceivableInsight(i: { ar: number; overdue: number; overdueCount: number; top: { name: string; amount: number }[]; dso: number | null }): DashboardInsight | null {
  if (!(i.overdue > 0) || !(i.ar > 0)) return null;
  const share = i.overdue / i.ar;
  const names = i.top.slice(0, 3).map((t) => `${t.name} (${idr(t.amount)})`);
  return {
    id: 'piutang-lewat',
    category: 'PIUTANG',
    tone: share >= 0.2 ? 'warning' : 'info',
    title: `${idr(i.overdue)} piutang lewat jatuh tempo`,
    evidence: `${i.overdueCount} faktur, ${pctText(share)} dari total piutang ${idr(i.ar)}.${names.length ? ` Terbesar: ${list(names)}.` : ''}`,
    recommendation: 'Hubungi pelanggan dengan tunggakan terbesar lebih dulu, tahan order baru bagi yang melewati batas kredit, dan tawarkan jadwal cicilan bila perlu.',
    impact: { label: 'Tertahan di pelanggan', amount: i.overdue },
    facts: [{ label: 'Total piutang', value: idr(i.ar) }, ...(i.dso != null ? [{ label: 'Rata-rata hari tagih', value: `±${Math.round(i.dso)} hari` }] : [])],
    link: '/invoices',
    linkLabel: 'Lihat faktur',
    score: 60 + Math.min(30, Math.round(share * 60)),
  };
}

/** Hutang jatuh tempo dibanding kas */
export function payableInsight(i: { overdue: number; due14: number; cash: number }): DashboardInsight | null {
  const facts = [{ label: 'Jatuh tempo ≤ 14 hari', value: idr(i.due14) }, { label: 'Saldo kas', value: idr(i.cash) }];
  if (i.due14 > 0 && i.cash > 0 && i.due14 >= i.cash * 0.7) {
    return { id: 'hutang-kas', category: 'HUTANG', tone: 'warning', title: `Hutang jatuh tempo 14 hari ke depan ${i.due14 >= i.cash ? 'melebihi' : 'mendekati'} kas`, evidence: `${i.overdue >= i.due14 * 0.999 ? `${idr(i.due14)} hutang pemasok seluruhnya sudah lewat jatuh tempo` : `${idr(i.due14)} harus dibayar dalam 14 hari${i.overdue > 0 ? ` (${idr(i.overdue)} di antaranya sudah lewat)` : ''}`}, sedangkan kas ${idr(i.cash)}.`, recommendation: 'Susun urutan pembayaran (pemasok kunci lebih dulu), percepat penagihan piutang, atau minta penjadwalan ulang pada pemasok yang fleksibel.', impact: { label: 'Kewajiban 14 hari', amount: i.due14 }, facts, link: '/purchase-invoices', linkLabel: 'Lihat hutang', score: 85 };
  }
  if (i.overdue > 0) {
    return { id: 'hutang-lewat', category: 'HUTANG', tone: 'warning', title: `${idr(i.overdue)} hutang pemasok sudah lewat jatuh tempo`, evidence: `Terlambat bayar dapat menimbulkan denda dan membuat pemasok menahan pengiriman.`, recommendation: 'Bayar yang paling lama lewat lebih dulu, atau komunikasikan jadwal bayar yang jelas ke pemasok.', impact: { label: 'Hutang terlambat', amount: i.overdue }, facts, link: '/purchase-invoices', linkLabel: 'Lihat hutang', score: 68 };
  }
  return null;
}

/** Stok yang tidak bergerak */
export function deadStockInsight(i: { dead: number; total: number; n: number; top: { name: string; value: number }[]; days?: number }): DashboardInsight | null {
  if (!(i.total > 0) || i.dead < 1_000_000) return null;
  const share = i.dead / i.total;
  if (share < 0.05) return null;
  const names = i.top.slice(0, 3).map((t) => `${t.name} (${idr(t.value)})`);
  return {
    id: 'stok-mati',
    category: 'PERSEDIAAN',
    tone: share >= 0.15 ? 'warning' : 'info',
    title: `${idr(i.dead)} modal tertahan di stok yang tidak bergerak`,
    evidence: `${i.n} barang tidak terjual/terpakai dalam ${i.days ?? 90} hari, ${pctText(share)} dari nilai persediaan ${idr(i.total)}.${names.length ? ` Terbesar: ${list(names)}.` : ''}`,
    recommendation: 'Pertimbangkan promo atau paket bundling, retur ke pemasok bila memungkinkan, dan hentikan pembelian ulang barang ini. Modal yang dibebaskan bisa dipakai untuk barang yang lebih laku.',
    impact: { label: 'Modal terparkir', amount: i.dead },
    facts: [{ label: 'Nilai persediaan', value: idr(i.total) }, { label: 'Barang tidak bergerak', value: `${i.n} item` }],
    link: '/inventory/movement',
    linkLabel: 'Lihat perputaran stok',
    score: 50 + Math.min(30, Math.round(share * 100)),
  };
}

/** Barang yang sudah / hampir kedaluwarsa */
export function expiryInsight(i: { expiredValue: number; expiredN: number; soonValue: number; soonN: number; top: string[] }): DashboardInsight | null {
  if (!(i.expiredValue > 0) && !(i.soonValue > 0)) return null;
  const facts = [{ label: 'Sudah kedaluwarsa', value: idr(i.expiredValue) }, { label: 'Kedaluwarsa ≤ 30 hari', value: idr(i.soonValue) }];
  if (i.expiredValue > 0) {
    return { id: 'kedaluwarsa', category: 'PERSEDIAAN', tone: 'warning', title: `Stok senilai ${idr(i.expiredValue)} sudah kedaluwarsa`, evidence: `${i.expiredN} lot sudah lewat tanggal kedaluwarsa${i.soonN ? `, dan ${i.soonN} lot lagi (${idr(i.soonValue)}) akan kedaluwarsa dalam 30 hari` : ''}.${i.top.length ? ` Contoh: ${list(i.top.slice(0, 3))}.` : ''}`, recommendation: 'Pisahkan dan buang yang sudah kedaluwarsa lalu catat sebagai penyesuaian stok agar stok dan laba akurat. Untuk yang hampir kedaluwarsa, jual lebih dulu (FEFO), beri diskon, atau retur.', impact: { label: 'Nilai kedaluwarsa', amount: i.expiredValue }, facts, link: '/inventory/expiry', linkLabel: 'Lihat kedaluwarsa', score: 82 };
  }
  return { id: 'kedaluwarsa', category: 'PERSEDIAAN', tone: 'warning', title: `${idr(i.soonValue)} stok akan kedaluwarsa dalam 30 hari`, evidence: `${i.soonN} lot mendekati tanggal kedaluwarsa.${i.top.length ? ` Contoh: ${list(i.top.slice(0, 3))}.` : ''}`, recommendation: 'Dahulukan penjualan lot ini (FEFO), beri diskon atau paket promo, atau tukar/retur ke pemasok sebelum terlambat.', impact: { label: 'Nilai berisiko', amount: i.soonValue }, facts, link: '/inventory/expiry', linkLabel: 'Lihat kedaluwarsa', score: 62 };
}

/** Produk di bawah stok minimum */
export function lowStockInsight(i: { n: number; top: string[] }): DashboardInsight | null {
  if (!(i.n > 0)) return null;
  return { id: 'stok-minimum', category: 'PERSEDIAAN', tone: 'warning', title: `${i.n} produk di bawah stok minimum`, evidence: `${i.top.length ? `Antara lain ${list(i.top.slice(0, 3))}. ` : ''}Stok yang habis berisiko membuat penjualan hilang.`, recommendation: 'Buat pesanan pembelian atau transfer antar gudang, dimulai dari barang yang paling laku.', facts: [{ label: 'Produk di bawah minimum', value: `${i.n} item` }], link: '/inventory/warehouses?tab=low', linkLabel: 'Lihat stok menipis', score: 55 };
}

/** Ketergantungan pada satu pelanggan */
export function concentrationInsight(i: { name: string; share: number; amount: number; total: number }): DashboardInsight | null {
  if (!(i.total > 0) || i.share < 0.35) return null;
  return { id: 'pelanggan-konsentrasi', category: 'PELANGGAN', tone: 'warning', title: `${i.name} menyumbang ${pctText(i.share)} penjualan 90 hari`, evidence: `${idr(i.amount)} dari ${idr(i.total)} berasal dari satu pelanggan. Bila ia berhenti atau terlambat bayar, arus kas bisa terguncang.`, recommendation: 'Kembangkan pelanggan lain agar porsi ini turun, dan atur batas kredit serta jadwal tagih khusus untuk pelanggan ini.', impact: { label: 'Penjualan dari satu pelanggan', amount: i.amount }, facts: [{ label: 'Porsi', value: pctText(i.share) }], link: '/customers', linkLabel: 'Lihat pelanggan', score: 52 };
}

/** Pelanggan yang dulu rutin membeli tetapi sudah lama tidak */
export function lapsedCustomersInsight(i: { customers: { name: string; past: number }[] }): DashboardInsight | null {
  const total = i.customers.reduce((a, c) => a + c.past, 0);
  if (!i.customers.length || total < 1_000_000) return null;
  return { id: 'pelanggan-lama', category: 'PELANGGAN', tone: 'opportunity', title: `${i.customers.length} pelanggan lama belum membeli lagi 60 hari terakhir`, evidence: `Sebelumnya mereka membeli ${idr(total)} dalam 4 bulan. Terbesar: ${list(i.customers.slice(0, 3).map((c) => `${c.name} (${idr(c.past)})`))}.`, recommendation: 'Minta tim penjualan menghubungi mereka: tanyakan kebutuhan, tawarkan promo atau kunjungan. Mengaktifkan kembali pelanggan lama biasanya lebih murah daripada mencari yang baru.', impact: { label: 'Potensi penjualan kembali', amount: total / 2 }, facts: [{ label: 'Pembelian sebelumnya', value: idr(total) }], link: '/customers', linkLabel: 'Lihat pelanggan', score: 46 };
}

/** Beban usaha yang naik */
export function costRiseInsight(i: { last: number; avgPrev: number; top?: { name: string; delta: number } }): DashboardInsight | null {
  if (!(i.avgPrev > 0) || i.last < i.avgPrev * 1.2 || i.last - i.avgPrev < 1_000_000) return null;
  const rise = (i.last - i.avgPrev) / i.avgPrev;
  return { id: 'biaya-naik', category: 'BIAYA', tone: 'warning', title: `Beban usaha bulan lalu ${riseText(rise)} dari rata-rata`, evidence: `${idr(i.last)} dibanding rata-rata ${idr(i.avgPrev)} pada 3 bulan sebelumnya.${i.top ? ` Kenaikan terbesar: ${i.top.name} (+${idr(i.top.delta)}).` : ''}`, recommendation: 'Tinjau pos yang naik: apakah sekali-saja (mis. perbaikan) atau berulang. Untuk yang berulang, cek kontrak/tarif dan cari alternatif yang lebih hemat.', impact: { label: 'Kenaikan beban', amount: i.last - i.avgPrev }, facts: [{ label: 'Bulan lalu', value: idr(i.last) }, { label: 'Rata-rata 3 bulan sebelumnya', value: idr(i.avgPrev) }], link: '/reports', linkLabel: 'Lihat laporan', score: 54 };
}

/** Produk bermargin tipis atau rugi (dari baris faktur 90 hari) */
export function lowMarginProductsInsight(i: { items: { name: string; revenue: number; marginPct: number }[] }): DashboardInsight | null {
  if (!i.items.length) return null;
  const neg = i.items.filter((x) => x.marginPct < 0).length;
  return { id: 'produk-margin-tipis', category: 'PRODUK', tone: 'warning', title: `${i.items.length} produk bermargin tipis${neg ? ` (${neg} di antaranya rugi)` : ''}`, evidence: `Dalam 90 hari: ${list(i.items.slice(0, 3).map((x) => `${x.name} (margin ${pctText(x.marginPct / 100, 1)} dari ${idr(x.revenue)})`))}.`, recommendation: 'Tinjau harga jual dan harga beli produk ini; naikkan harga, kurangi diskon, atau hentikan bila terus merugi. Produk yang rugi menggerus laba dari produk lain.', impact: { label: 'Penjualan produk bermargin tipis', amount: i.items.reduce((a, x) => a + x.revenue, 0) }, link: '/products', linkLabel: 'Lihat produk', score: 64 };
}

/** Produk penyumbang laba terbesar */
export function topProductsInsight(i: { top: { name: string; gp: number }[]; totalGp: number; productCount?: number }): DashboardInsight | null {
  // dengan produk yang sedikit, "3 produk andalan = 100%" tidak informatif
  if (!(i.totalGp > 0) || i.top.length < 2 || (i.productCount ?? 6) < 6) return null;
  const sum = i.top.reduce((a, t) => a + t.gp, 0);
  const share = sum / i.totalGp;
  return { id: 'produk-andalan', category: 'PRODUK', tone: 'opportunity', title: `${i.top.length} produk andalan menyumbang ${pctText(share)} laba kotor`, evidence: `Dalam 90 hari: ${list(i.top.map((t) => `${t.name} (${idr(t.gp)})`))}.`, recommendation: 'Jaga ketersediaan stok produk ini dan prioritaskan promosinya. Waspadai ketergantungan: kembangkan produk pendamping agar laba tidak bertumpu pada sedikit barang.', impact: { label: 'Laba kotor dari produk andalan', amount: sum }, link: '/products', linkLabel: 'Lihat produk', score: 35 };
}

/** Urutkan dan batasi; kabar baik disisipkan agar tampilan tidak hanya berisi peringatan */
export function rankInsights(items: DashboardInsight[], max = 10): DashboardInsight[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const picked = sorted.slice(0, max);
  const good = sorted.find((x) => x.tone === 'good');
  if (good && !picked.includes(good)) picked[picked.length - 1] = good;
  return picked.sort((a, b) => b.score - a.score);
}

export function summarize(items: DashboardInsight[]) {
  const warnings = items.filter((i) => i.tone === 'warning').length;
  const opportunities = items.filter((i) => i.tone === 'opportunity').length;
  const good = items.filter((i) => i.tone === 'good').length;
  const headline = !items.length
    ? 'Belum cukup data untuk memberi saran'
    : warnings === 0
      ? 'Kondisi usaha terlihat sehat bulan ini'
      : warnings === 1
        ? '1 hal layak diperhatikan bulan ini'
        : `${warnings} hal layak diperhatikan bulan ini`;
  const sub = items.length
    ? [`${warnings} perlu perhatian`, `${opportunities} peluang`, `${good} kabar baik`].join(' · ')
    : 'Saran muncul setelah ada transaksi dan pembukuan beberapa minggu.';
  return { headline, sub, warnings, opportunities, good, info: items.filter((i) => i.tone === 'info').length };
}
