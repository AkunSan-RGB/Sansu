/**
 * Kesimpulan, temuan, dan saran otomatis untuk laporan pendukung. Semuanya diturunkan dari angka yang sudah tersaji
 * pada laporan itu sendiri (tabel dan pencocokan buku besar) dengan aturan tetap, tanpa data tambahan.
 */
import type { Reconciliation, SupportKind, SupportSection, SupportTable } from './support-reports';

export type FindingLevel = 'ok' | 'info' | 'warning' | 'danger';
export interface SupportFinding {
  level: FindingLevel;
  title: string;
  detail: string;
  /** Saran tindak lanjut */
  action?: string;
}
export interface SupportConclusion {
  status: FindingLevel;
  summary: string;
  findings: SupportFinding[];
}
interface ReportLike {
  reconciliation: Reconciliation[];
  sections: SupportSection[];
  period: { from: string; to: string };
}

/** Ambang yang menentukan kapan sebuah angka dianggap temuan; dapat diatur per perusahaan */
export interface InsightThresholds {
  /** Piutang/utang lewat 90 hari: persen dari total yang jadi perhatian / kritis */
  agingWarnPct: number;
  agingDangerPct: number;
  /** Persen piutang/utang lewat jatuh tempo yang jadi perhatian */
  lateSharePct: number;
  /** Persen piutang pada satu pelanggan yang jadi perhatian */
  receivableConcentrationPct: number;
  /** Persen penjualan/pembelian pada satu pihak yang jadi perhatian */
  concentrationPct: number;
  /** Margin kotor di bawah persen ini jadi perhatian */
  marginWarnPct: number;
  /** Retur penjualan/pembelian dari total, persen */
  returnPct: number;
  /** Surat jalan belum difaktur lebih dari ... hari */
  deliveryDays: number;
  /** Barang diterima belum ditagih lebih dari ... hari */
  grniDays: number;
  /** Uang laci kurang dari penjualan kasir: perhatian / kritis, persen */
  posShortWarnPct: number;
  posShortDangerPct: number;
  /** Selisih kurang pada kasir yang sama di sekian sesi atau lebih */
  posRepeatSessions: number;
  /** Retur kasir per kasir dari penjualannya, persen */
  posReturnPct: number;
  /** Penyimpangan pemakaian bahan dari resep, persen */
  fnbUsagePct: number;
  /** Tukar-guling dari penjualan neto, persen */
  swapPct: number;
  /** Rendemen produksi di bawah persen ini */
  yieldPct: number;
  /** Barang dalam proses lebih dari ... hari: perhatian / kritis */
  wipWarnDays: number;
  wipDangerDays: number;
  /** Catatan meter ditandai janggal dari seluruh catatan, persen */
  utilFlaggedPct: number;
  /** Pembayaran terkumpul dari tagihan di bawah persen ini */
  utilCollectionPct: number;
  /** Tunggakan utilitas lebih dari ... hari */
  utilArrearsDays: number;
}
export const DEFAULT_THRESHOLDS: InsightThresholds = {
  agingWarnPct: 20,
  agingDangerPct: 40,
  lateSharePct: 50,
  receivableConcentrationPct: 50,
  concentrationPct: 40,
  marginWarnPct: 10,
  returnPct: 5,
  deliveryDays: 14,
  grniDays: 30,
  posShortWarnPct: 0.5,
  posShortDangerPct: 1,
  posRepeatSessions: 3,
  posReturnPct: 3,
  fnbUsagePct: 5,
  swapPct: 2,
  yieldPct: 90,
  wipWarnDays: 30,
  wipDangerDays: 60,
  utilFlaggedPct: 10,
  utilCollectionPct: 70,
  utilArrearsDays: 90,
};

type Row = (string | number | null)[];
const ORDER: Record<FindingLevel, number> = { ok: 0, info: 1, warning: 2, danger: 3 };

const rp = (n: number) => `${n < 0 ? '-' : ''}Rp${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;
const n = (v: unknown) => Number(v ?? 0) || 0;
const names = (rows: Row[], i = 0, max = 3) => rows.slice(0, max).map((r) => String(r[i])).join(', ') + (rows.length > max ? `, dan ${rows.length - max} lainnya` : '');
const sumCol = (rows: Row[], i: number) => rows.reduce((a, r) => a + n(r[i]), 0);

class Builder {
  findings: SupportFinding[] = [];
  constructor(readonly r: ReportLike, readonly t: InsightThresholds) {}
  table(key: string, idx = 0): SupportTable | undefined {
    return this.r.sections.find((s) => s.key === key)?.tables[idx];
  }
  rows(key: string, idx = 0): Row[] {
    return (this.table(key, idx)?.rows ?? []) as Row[];
  }
  add(level: FindingLevel, title: string, detail: string, action?: string) {
    this.findings.push({ level, title, detail, action });
  }
}

/** Pencocokan buku besar: selisih = temuan serius, kecuali selisih biaya produksi yang memang wajar */
function reconciliation(b: Builder, recs: Reconciliation[]) {
  const bad = recs.filter((x) => !x.ok);
  if (!recs.length) return;
  // Bila semuanya cocok, ringkasan di awal sudah menyatakannya; tidak perlu temuan terpisah
  if (!bad.length) return;
  for (const x of bad) {
    if (x.key === 'mfg-conversion') {
      b.add('info', 'Biaya konversi tidak sama dengan biaya aktual', `Upah dan overhead yang dibebankan ke hasil produksi ${rp(x.left.value)}, sedangkan biaya aktual di buku besar ${rp(x.right.value)} (selisih ${rp(Math.abs(x.diff))}, ${x.diff > 0 ? 'lebih dibebankan' : 'kurang dibebankan'}).`, 'Ini selisih biaya produksi, bukan salah catat. Tinjau tarif standar upah/overhead di resep dan analisis selisih di menu Analisis selisih.');
      continue;
    }
    b.add('danger', `Selisih ${rp(Math.abs(x.diff))} pada: ${x.title}`, `${x.left.label} ${rp(x.left.value)} ≠ ${x.right.label} ${rp(x.right.value)}.${x.note ? ` ${x.note}` : ''}`, 'Telusuri akun terkait di Buku besar dan bandingkan dengan dokumen sumber; koreksi lewat dokumen atau jurnal pembalik, jangan menimpa saldo.');
  }
  if (recs.length - bad.length > 0) b.add('ok', `${recs.length - bad.length} pencocokan lain cocok`, `Dari ${recs.length} pencocokan, selisih terbatas pada butir di atas.`);
}

/** Umur piutang/utang: kolom 1..5 = belum jatuh tempo … > 90 hari, kolom 6 = total */
function aging(b: Builder, key: string, what: 'piutang' | 'utang') {
  const rows = b.rows(key);
  const total = sumCol(rows, 6);
  if (total <= 0) return;
  const over90 = sumCol(rows, 5);
  const late = sumCol(rows, 2) + sumCol(rows, 3) + sumCol(rows, 4) + over90;
  const worst = rows.filter((r) => n(r[5]) > 0).sort((a, c) => n(c[5]) - n(a[5]));
  const sharePay = over90 / total;
  const shareLate = late / total;
  const who = what === 'piutang' ? 'pelanggan' : 'pemasok';
  if (over90 > 0) {
    b.add(
      sharePay * 100 >= b.t.agingDangerPct ? 'danger' : sharePay * 100 >= b.t.agingWarnPct ? 'warning' : 'info',
      `${what === 'piutang' ? 'Piutang' : 'Utang'} lewat 90 hari ${rp(over90)} (${pct(sharePay * 100)})`,
      `Dari total ${rp(total)}, ${rp(late)} (${pct(shareLate * 100)}) sudah lewat jatuh tempo. Terbesar lewat 90 hari: ${names(worst)}.`,
      what === 'piutang' ? 'Tagih atau buat perjanjian cicilan dengan pelanggan di atas; bila hampir pasti tak tertagih, pertimbangkan penyisihan kerugian piutang atau penghapusan lewat persetujuan.' : 'Jadwalkan pelunasan atau konfirmasi saldo dengan pemasok di atas untuk menghindari denda dan terhentinya pasokan.',
    );
  } else if (shareLate * 100 >= b.t.lateSharePct) {
    b.add('warning', `${pct(shareLate * 100)} ${what} sudah lewat jatuh tempo`, `${rp(late)} dari ${rp(total)} lewat jatuh tempo, tetapi belum ada yang lewat 90 hari.`, what === 'piutang' ? 'Kirim pengingat tagihan sebelum menjadi menunggak lama.' : 'Prioritaskan pembayaran yang paling lama jatuh tempo.');
  } else {
    b.add('ok', `Umur ${what} sehat`, `${pct((1 - shareLate) * 100)} dari ${rp(total)} belum jatuh tempo dan tidak ada yang lewat 90 hari.`);
  }
  const top = [...rows].sort((a, c) => n(c[6]) - n(a[6]))[0];
  if (top && rows.length > 1 && (n(top[6]) / total) * 100 > b.t.receivableConcentrationPct) {
    b.add('warning', `${pct((n(top[6]) / total) * 100)} ${what} terkonsentrasi pada satu ${who}`, `${String(top[0])} menyumbang ${rp(n(top[6]))} dari ${rp(total)}.`, what === 'piutang' ? 'Tinjau batas kredit dan syarat pembayaran pelanggan ini; risiko gagal bayar satu pihak berdampak besar.' : 'Ketergantungan pada satu pemasok berisiko; pertimbangkan pemasok alternatif.');
  }
}

/** Konsentrasi penjualan/pembelian: kolom `idx` berisi nilai yang dibandingkan */
function concentration(b: Builder, key: string, idx: number, what: string) {
  const rows = b.rows(key).filter((r) => !String(r[0]).startsWith('Lainnya'));
  const total = sumCol(b.rows(key), idx);
  if (rows.length < 2 || total <= 0) return;
  const top = [...rows].sort((a, c) => n(c[idx]) - n(a[idx]))[0];
  const share = n(top[idx]) / total;
  if (share * 100 >= b.t.concentrationPct) b.add('warning', `${pct(share * 100)} ${what} bergantung pada satu pihak`, `${String(top[0])} sebesar ${rp(n(top[idx]))} dari ${rp(total)}.`, 'Pantau risiko ketergantungan; kehilangan pihak ini akan berdampak besar.');
}

// ------------------------------------------------------------------ per jenis
function sales(b: Builder) {
  const m = b.rows('sales-monthly');
  if (m.length) {
    const dpp = sumCol(m, 2);
    const ret = sumCol(m, 4);
    const net = sumCol(m, 5);
    const gp = sumCol(m, 7);
    if (net > 0) {
      const margin = gp / net;
      b.add(margin < 0 ? 'danger' : margin * 100 < b.t.marginWarnPct ? 'warning' : 'info', `Penjualan neto ${rp(net)}, laba kotor ${rp(gp)} (${pct(margin * 100)})`, margin < 0 ? 'HPP lebih besar dari penjualan: barang dijual di bawah harga pokok.' : margin * 100 < b.t.marginWarnPct ? 'Margin kotor tipis; kenaikan biaya kecil saja dapat membuat rugi.' : `Dari ${m.reduce((a, r) => a + n(r[1]), 0)} faktur pada periode ini.`, margin * 100 < b.t.marginWarnPct ? 'Tinjau harga jual dan diskon pada produk dengan margin terendah (lihat P3).' : undefined);
    }
    if (dpp > 0 && (ret / dpp) * 100 >= b.t.returnPct) b.add('warning', `Retur ${pct((ret / dpp) * 100)} dari penjualan`, `Retur ${rp(ret)} dari penjualan ${rp(dpp)}.`, 'Cari penyebab retur terbanyak (kualitas, salah kirim) dan pelanggan yang paling sering meretur.');
    if (m.length >= 2) {
      const last = n(m[m.length - 1][5]);
      const prev = n(m[m.length - 2][5]);
      if (prev > 0 && last / prev <= 0.8) b.add('info', `Penjualan bulan terakhir turun ${pct((1 - last / prev) * 100)}`, `${String(m[m.length - 1][0])}: ${rp(last)} dibanding ${String(m[m.length - 2][0])}: ${rp(prev)}. Bulan terakhir mungkin belum penuh.`);
    }
  }
  concentration(b, 'sales-customer', 4, 'penjualan');
  aging(b, 'sales-aging', 'piutang');
  const unb = b.rows('sales-unbilled');
  if (unb.length) {
    const old = unb.filter((r) => n(r[4]) > b.t.deliveryDays);
    b.add(old.length ? 'warning' : 'info', `${unb.length} surat jalan belum difaktur (HPP ${rp(sumCol(unb, 5))})`, `Barang sudah keluar dan HPP sudah tercatat, tetapi pendapatan belum diakui.${old.length ? ` ${old.length} di antaranya lebih dari ${b.t.deliveryDays} hari: ${names(old)}.` : ''}`, 'Terbitkan faktur atas surat jalan tersebut, atau selidiki bila pengiriman ditolak/dikembalikan.');
  }
  const man = b.rows('sales-source').find((r) => String(r[0]) === 'Jurnal manual');
  if (man && n(man[2]) !== 0) b.add('warning', `Pendapatan ${rp(n(man[2]))} berasal dari jurnal manual`, 'Pendapatan ini tidak punya faktur atau transaksi kasir sebagai dasar.', 'Pastikan ada bukti pendukung dan persetujuan; pendapatan sebaiknya dicatat lewat dokumen penjualan.');
}

function purchases(b: Builder) {
  const m = b.rows('purchases-monthly');
  if (m.length) {
    const dpp = sumCol(m, 2);
    const ret = sumCol(m, 6);
    b.add('info', `Pembelian neto ${rp(sumCol(m, 7))}`, `${m.reduce((a, r) => a + n(r[1]), 0)} faktur, PPN masukan ${rp(sumCol(m, 3))}.`);
    if (dpp > 0 && (ret / dpp) * 100 >= b.t.returnPct) b.add('warning', `Retur pembelian ${pct((ret / dpp) * 100)}`, `Retur ${rp(ret)} dari pembelian ${rp(dpp)}.`, 'Tinjau kualitas barang dari pemasok yang paling sering diretur dan bicarakan syarat retur/penggantian.');
  }
  concentration(b, 'purchases-supplier', 2, 'pembelian');
  aging(b, 'purchases-aging', 'utang');
  const g = b.rows('purchases-grni');
  if (g.length) {
    const old = g.filter((r) => n(r[4]) > b.t.grniDays);
    b.add(old.length ? 'warning' : 'info', `${g.length} penerimaan barang belum ditagih ${rp(sumCol(g, 7))}`, `Barang sudah diterima tetapi belum difaktur pemasok.${old.length ? ` ${old.length} lebih dari ${b.t.grniDays} hari: ${names(old, 0)}.` : ''}`, 'Minta faktur pemasok atau input faktur yang sudah diterima; utang yang belum dicatat membuat laporan keuangan terlalu bagus.');
  }
}

function inventory(b: Builder) {
  const card = b.rows('inventory-card', 0);
  if (!card.length) return;
  const neg = card.filter((r) => n(r[6]) < 0);
  if (neg.length) b.add('danger', `${neg.length} produk bersaldo stok negatif`, `Contoh: ${names(neg, 1)}. Saldo minus berarti barang keluar tercatat lebih banyak dari yang pernah masuk.`, 'Periksa penerimaan yang belum diinput atau pengeluaran ganda; koreksi dengan penyesuaian stok bersandi alasan.');
  else b.add('ok', 'Tidak ada saldo stok negatif', `${card.length} produk aktif pada periode ini.`);
  const idle = card.filter((r) => n(r[4]) === 0 && n(r[5]) === 0 && n(r[6]) > 0);
  if (idle.length >= 5 && idle.length / card.length >= 0.5) b.add('info', `${idle.length} dari ${card.length} produk tidak bergerak pada periode ini`, 'Tidak ada barang masuk maupun keluar.', 'Tinjau stok lambat laku untuk diskon, retur ke pemasok, atau penurunan nilai.');
}

function cash(b: Builder) {
  const acc = b.rows('cash-accounts');
  const neg = acc.filter((r) => n(r[5]) < 0);
  if (neg.length) b.add('danger', `${neg.length} akun kas/bank bersaldo negatif`, `${names(neg, 1)}. Kas tidak mungkin minus; biasanya ada penerimaan yang belum dicatat atau pengeluaran salah akun.`, 'Telusuri mutasi akun tersebut dan catat transaksi yang terlewat.');
  else if (acc.length) b.add('ok', 'Tidak ada saldo kas/bank negatif', `${acc.length} akun kas/bank.`);
  const bank = b.rows('cash-bank');
  if (!bank.length) {
    b.add('info', 'Belum ada rekening koran yang diimpor', 'Saldo buku belum bisa diuji terhadap saldo bank.', 'Impor mutasi rekening koran di Kas & Bank untuk rekonsiliasi bank.');
  } else {
    const diff = bank.filter((r) => Math.abs(n(r[5])) >= 1);
    const open = bank.filter((r) => n(r[6]) > 0);
    if (diff.length) b.add('warning', `${diff.length} rekening koran berselisih dengan saldo buku`, `${names(diff, 1)}: selisih ${rp(sumCol(diff.map((r) => [Math.abs(n(r[5]))]), 0))}.`, 'Cocokkan baris rekening koran dengan transaksi kas; selisih biasanya dari biaya bank, bunga, atau transaksi belum dicatat.');
    if (open.length) b.add('warning', `${sumCol(open, 6)} baris rekening koran belum cocok (${rp(sumCol(open, 7))})`, `Pada: ${names(open, 1)}.`, 'Selesaikan pencocokan di menu rekonsiliasi bank.');
    if (!diff.length && !open.length) b.add('ok', 'Rekening koran cocok dengan saldo buku', `${bank.length} rekening dicek.`);
  }
}

function other(b: Builder) {
  for (const [key, label, bad] of [['other-assets', 'aset', 'bersaldo kredit'], ['other-receivables', 'piutang lain', 'bersaldo kredit'], ['other-liabilities', 'liabilitas', 'bersaldo debit']] as const) {
    const neg = b.rows(key).filter((r) => n(r[5]) < -0.5);
    if (neg.length) b.add('warning', `${neg.length} akun ${label} ${bad}`, `${names(neg, 1)}: saldo tidak sesuai sifat akun.`, 'Periksa jurnal pada akun itu; mungkin salah akun atau pembalikan yang tidak lengkap.');
  }
  const eq = b.rows('other-equity');
  const eqTotal = sumCol(eq, 5);
  if (eq.length && eqTotal < 0) b.add('warning', `Ekuitas negatif ${rp(Math.abs(eqTotal))}`, 'Jumlah saldo akun ekuitas defisit.', 'Perusahaan menanggung kerugian melebihi modalnya; tinjau struktur permodalan.');
  const rec = b.rows('other-receivables');
  if (rec.length) b.add('info', `Piutang lain-lain ${rp(sumCol(rec, 5))}`, `${rec.length} akun: ${names(rec, 1)}.`, 'Piutang non-faktur tidak punya penagihan otomatis; pastikan ada jadwal penyelesaian (kasbon, klaim, titipan).');
}

function pos(b: Builder) {
  const sess = b.rows('pos-session');
  const closed = sess.filter((r) => r[9] !== null);
  const short = closed.filter((r) => n(r[9]) < -0.5);
  const over = closed.filter((r) => n(r[9]) > 0.5);
  const salesTotal = sumCol(b.rows('pos-cashier'), 4);
  if (short.length || over.length) {
    const lack = Math.abs(sumCol(short, 9));
    const ratio = salesTotal > 0 ? lack / salesTotal : 0;
    b.add(ratio * 100 >= b.t.posShortDangerPct ? 'danger' : ratio * 100 >= b.t.posShortWarnPct ? 'warning' : 'info', `${short.length} sesi uang laci kurang (${rp(lack)}), ${over.length} sesi lebih (${rp(sumCol(over, 9))})`, `Kekurangan ${pct(ratio * 100)} dari penjualan kasir ${rp(salesTotal)}.`, 'Periksa sesi dengan selisih terbesar; selisih berulang pada kasir yang sama patut diselidiki (lihat peringatan berikut).');
    const per = new Map<string, number>();
    for (const r of short) per.set(String(r[1]), (per.get(String(r[1])) ?? 0) + 1);
    const repeat = [...per].filter(([, c]) => c >= b.t.posRepeatSessions);
    if (repeat.length) b.add('warning', `Selisih kurang berulang pada ${repeat.map(([k, c]) => `${k} (${c} sesi)`).join(', ')}`, `Selisih kurang pada ${b.t.posRepeatSessions} sesi atau lebih untuk kasir yang sama.`, 'Lakukan hitung kas mendadak dan tinjau cara kasir menerima uang/kembalian.');
  } else if (closed.length) b.add('ok', 'Uang laci cocok pada semua sesi yang ditutup', `${closed.length} sesi ditutup tanpa selisih.`);
  const open = sess.filter((r) => String(r[4]) === 'Terbuka' && String(r[2]).slice(0, 10) < b.r.period.to);
  if (open.length) b.add('warning', `${open.length} sesi kasir masih terbuka dari hari sebelumnya`, `${names(open, 0)}.`, 'Tutup sesi dan hitung uang laci agar selisih tercatat pada hari yang benar.');
  for (const r of b.rows('pos-cashier')) {
    const t = n(r[4]);
    if (t > 0 && (n(r[5]) / t) * 100 >= b.t.posReturnPct) b.add('warning', `Retur kasir ${String(r[0])} ${pct((n(r[5]) / t) * 100)} dari penjualannya`, `${rp(n(r[5]))} dari ${rp(t)}.`, 'Pembatalan penjualan sering menjadi celah penggelapan; tinjau alasan dan persetujuan retur kasir ini.');
  }
}

function fnb(b: Builder) {
  const use = b.rows('fnb-usage');
  if (use.length) {
    const off = use.filter((r) => n(r[2]) > 0 && (Math.abs(n(r[4])) / n(r[2])) * 100 > b.t.fnbUsagePct);
    if (off.length) {
      const boros = off.filter((r) => n(r[4]) > 0).sort((a, c) => n(c[4]) - n(a[4]));
      b.add('warning', `${off.length} bahan menyimpang lebih dari ${pct(b.t.fnbUsagePct)} dari resep`, `${boros.length ? `Lebih banyak keluar dari resep: ${names(boros, 1)}.` : ''}${off.length > boros.length ? ' Sebagian keluar lebih sedikit dari resep (resep terlalu besar atau penjualan tidak tercatat).' : ''}`, 'Periksa porsi, pemborosan/susut, dan kemungkinan bahan keluar tanpa penjualan; sesuaikan resep bila standar sudah berubah.');
    } else b.add('ok', 'Pemakaian bahan sesuai resep', `${use.length} bahan dicek, semuanya dalam ${pct(b.t.fnbUsagePct)} dari resep.`);
  }
  const ch = b.rows('fnb-platform', 0);
  const open = sumCol(ch, 6);
  if (open > 0) b.add('info', `Pesanan online ${rp(open)} belum dicairkan`, `Per kanal: ${ch.filter((r) => n(r[6]) > 0).map((r) => `${String(r[0])} ${rp(n(r[6]))}`).join(', ')}.`, 'Cocokkan dengan laporan pencairan dari platform dan catat pencairan yang sudah masuk ke bank.');
  const st = b.rows('fnb-platform', 1).filter((r) => Math.abs(n(r[6])) >= 1);
  if (st.length) b.add('warning', `${st.length} pencairan platform berselisih ${rp(Math.abs(sumCol(st, 6)))}`, `${names(st, 0)}.`, 'Ajukan klarifikasi potongan ke platform; selisih berulang berarti komisi/promo tidak sesuai kesepakatan.');
}

function fmcg(b: Builder) {
  const comm = b.rows('fmcg-commission');
  const below = comm.filter((r) => r[5] !== null && n(r[5]) < 100);
  if (comm.length && below.length) b.add('info', `${below.length} dari ${comm.length} catatan komisi di bawah target`, `Capaian terendah: ${names([...below].sort((a, c) => n(a[5]) - n(c[5])), 1)}.`);
  const cv = b.rows('fmcg-canvass');
  const pending = sumCol(cv, 5);
  const lack = sumCol(cv, 4);
  const rej = sumCol(cv, 6);
  if (pending > 0) b.add('warning', `Uang tagihan ${rp(pending)} masih di tangan sales`, 'Setoran belum diverifikasi Keuangan.', 'Verifikasi setoran dan tagih sales yang menahan uang.');
  if (lack > 0) b.add('warning', `Kurang setor kanvas ${rp(lack)}`, `Tercatat sebagai piutang karyawan: ${names(cv.filter((r) => n(r[4]) > 0), 0)}.`, 'Potong dari komisi/gaji atau minta pelunasan sesuai kebijakan.');
  if (rej > 0) b.add('warning', `Setoran ditolak ${rp(rej)}`, 'Uang yang dicatat sales tetapi ditolak Keuangan.', 'Selidiki selisih dengan sales terkait.');
  const claims = b.rows('fmcg-promo', 1);
  const stuck = claims.filter((r) => String(r[5]).startsWith('Disetujui'));
  if (stuck.length) b.add('info', `${stuck.length} klaim prinsipal disetujui belum cair (${rp(sumCol(stuck, 4))})`, `${names(stuck, 0)}.`, 'Tagih pencairan ke prinsipal; piutang klaim ikut dalam modal kerja.');
  const rejC = claims.filter((r) => String(r[5]) === 'Ditolak');
  if (rejC.length) b.add('warning', `${rejC.length} klaim prinsipal ditolak (${rp(sumCol(rejC, 3))})`, `${names(rejC, 0)}.`, 'Biaya promo ditanggung sendiri; tinjau syarat klaim sebelum promo berikutnya.');
  const trade = b.rows('fmcg-trade');
  const openTrade = sumCol(trade.filter((r) => String(r[8]) === 'Utang'), 7);
  if (openTrade > 0) b.add('info', `Rebate outlet ${rp(openTrade)} belum dilunasi`, 'Kewajiban kepada outlet modern trade.', 'Jadwalkan pelunasan atau potong dari tagihan sesuai perjanjian.');
  const swap = sumCol(b.rows('fmcg-swap'), 2);
  const net = sumCol(b.rows('fmcg-sales'), 4);
  if (swap > 0 && net > 0) b.add((swap / net) * 100 >= b.t.swapPct ? 'warning' : 'info', `Tukar-guling ${rp(swap)} (${pct((swap / net) * 100)} dari penjualan neto)`, 'Biaya barang rusak/kedaluwarsa/recall yang ditukar.', (swap / net) * 100 >= b.t.swapPct ? 'Tinjau perputaran stok dan kondisi barang di outlet penyebab terbanyak.' : undefined);
  const cs = sumCol(b.rows('fmcg-consign'), 4);
  if (cs > 0) b.add('info', `Stok titipan di outlet bernilai ${rp(cs)}`, 'Masih milik perusahaan sampai dilaporkan terjual.', 'Lakukan opname titipan berkala di outlet.');
}

function mfg(b: Builder) {
  const done = b.rows('mfg-done');
  if (done.length) {
    const low = done.filter((r) => r[7] !== null && n(r[7]) < b.t.yieldPct);
    const avg = done.reduce((a, r) => a + n(r[7]), 0) / done.length;
    if (low.length) b.add('warning', `${low.length} perintah produksi rendemen di bawah ${pct(b.t.yieldPct)}`, `Rata-rata rendemen ${pct(avg)}. Terendah: ${names([...low].sort((a, c) => n(a[7]) - n(c[7])), 0)}.`, 'Periksa susut/rusak pada perintah tersebut dan tinjau standar rendemen di resep.');
    else b.add('ok', `Rendemen produksi baik (rata-rata ${pct(avg)})`, `${done.length} perintah selesai.`);
  }
  const use = b.rows('mfg-usage');
  const over = use.filter((r) => n(r[5]) > 0).sort((a, c) => n(c[5]) - n(a[5]));
  if (over.length) b.add('warning', `Bahan terpakai lebih dari resep senilai ${rp(sumCol(over, 5))}`, `Terbesar: ${names(over, 1)}.`, 'Selidiki pemborosan, susut, atau resep yang sudah usang; perbarui standar bila perlu.');
  const wip = b.rows('mfg-wip');
  if (wip.length) {
    const old = wip.filter((r) => n(r[3]) > b.t.wipWarnDays);
    b.add(old.some((r) => n(r[3]) > b.t.wipDangerDays) ? 'danger' : old.length ? 'warning' : 'info', `${wip.length} perintah masih berjalan (barang dalam proses ${rp(sumCol(wip, 4))})`, old.length ? `${old.length} perintah lebih dari ${b.t.wipWarnDays} hari: ${names(old, 0)}.` : `Semua berumur di bawah ${b.t.wipWarnDays} hari.`, old.length ? 'Selesaikan atau batalkan perintah yang macet; modal tertahan dan nilai bahan bisa tidak terserap.' : undefined);
  }
}

function jasa(b: Builder) {
  const prj = b.rows('jasa-project');
  const noProgress = prj.filter((r) => String(r[9]) === 'Berjalan' && r[4] === null);
  if (noProgress.length) b.add('warning', `${noProgress.length} proyek berjalan belum punya catatan kemajuan`, `${names(noProgress, 1)}.`, 'Catat kemajuan pekerjaan agar pendapatan dan aset/liabilitas kontrak akurat.');
  const over = prj.filter((r) => n(r[6]) > n(r[3]) + 0.5);
  if (over.length) b.add('danger', `${over.length} proyek ditagih melebihi nilai kontrak`, `${names(over, 1)}.`, 'Periksa faktur termin atau tambahkan adendum kontrak.');
  const unbilled = prj.filter((r) => n(r[8]) > 0);
  if (unbilled.length) b.add('warning', `Pekerjaan lebih cepat dari tagihan ${rp(sumCol(unbilled, 8))}`, `Pendapatan sudah diakui tetapi belum ditagih: ${names(unbilled, 1)}.`, 'Terbitkan faktur termin sesuai kemajuan agar kas tidak tertahan.');
  const prepaid = prj.filter((r) => n(r[8]) < 0);
  if (prepaid.length) b.add('info', `Tagihan lebih cepat dari pekerjaan ${rp(Math.abs(sumCol(prepaid, 8)))}`, `Menjadi kewajiban kontrak: ${names(prepaid, 1)}.`);
  const dep = b.rows('jasa-deposit').filter((r) => n(r[7]) > 0.5);
  if (dep.length) b.add('info', `Uang muka belum terpakai ${rp(sumCol(dep, 7))}`, `${dep.length} uang muka: ${names(dep, 0)}.`, 'Gunakan untuk melunasi faktur pelanggan terkait atau kembalikan bila proyek batal.');
  const work = b.rows('jasa-work');
  const waiting = sumCol(work, 4);
  if (waiting > 0) b.add('warning', `Catatan pekerjaan ${rp(waiting)} menunggu persetujuan`, 'Belum masuk penggajian.', 'Setujui atau tolak agar upah tidak terlambat.');
  const approved = sumCol(work, 5);
  if (approved > 0) b.add('info', `Upah ${rp(approved)} disetujui belum masuk penggajian`, 'Akan terbayar pada penggajian berikutnya.');
}

function utility(b: Builder) {
  const rd = b.rows('util-readings');
  if (rd.length) {
    const total = sumCol(rd, 1);
    const flagged = sumCol(rd, 5);
    if (total > 0 && (flagged / total) * 100 >= b.t.utilFlaggedPct) b.add('warning', `${pct((flagged / total) * 100)} catatan meter ditandai janggal`, `${flagged} dari ${total} catatan (lonjakan, meter diganti, dan sebagainya).`, 'Periksa petugas dan sambungan dengan tanda terbanyak; kebocoran pendapatan sering lewat pencatatan meter.');
    const rejected = sumCol(rd, 4);
    if (rejected > 0) b.add('info', `${rejected} catatan meter ditolak`, 'Perlu dicatat ulang oleh petugas.');
    const backlog = sumCol(rd, 1) - sumCol(rd, 3) - rejected;
    if (backlog > 0) b.add('info', `${backlog} catatan meter belum ditagih`, 'Sudah dicatat tetapi belum menjadi tagihan.', 'Verifikasi dan jalankan penagihan periode terkait.');
  }
  const bills = b.rows('util-bills');
  const tot = sumCol(bills, 5);
  if (tot > 0) {
    const rate = sumCol(bills, 6) / tot;
    b.add(rate * 100 < b.t.utilCollectionPct ? 'warning' : 'info', `Pembayaran terkumpul ${pct(rate * 100)} dari tagihan ${rp(tot)}`, `Sisa belum dibayar ${rp(sumCol(bills, 7))}.`, rate * 100 < b.t.utilCollectionPct ? 'Intensifkan penagihan; pertimbangkan penangguhan sambungan yang menunggak lama sesuai aturan.' : undefined);
  }
  const ar = b.rows('util-arrears');
  if (ar.length) {
    const old = ar.filter((r) => n(r[4]) > b.t.utilArrearsDays);
    b.add(old.length ? 'warning' : 'info', `${ar.length} tagihan menunggak (${rp(sumCol(ar, 6))})`, old.length ? `${old.length} lebih dari ${b.t.utilArrearsDays} hari: ${names(old, 1)}.` : `Belum ada yang lewat ${b.t.utilArrearsDays} hari.`, old.length ? 'Tangguhkan/putus sambungan sesuai prosedur dan siapkan penyisihan piutang.' : 'Kirim pengingat sebelum menunggak lama.');
  }
}

export function conclude(kind: SupportKind, report: ReportLike, thresholds: InsightThresholds = DEFAULT_THRESHOLDS): SupportConclusion {
  const b = new Builder(report, thresholds);
  reconciliation(b, report.reconciliation);
  const body: Record<SupportKind, (b: Builder) => void> = { sales, purchases, inventory, cash, other, pos, fnb, fmcg, mfg, jasa, utility };
  body[kind](b);
  const findings = [...b.findings].sort((a, c) => ORDER[c.level] - ORDER[a.level]);
  const status = findings.reduce<FindingLevel>((a, f) => (ORDER[f.level] > ORDER[a] ? f.level : a), 'ok');
  const danger = findings.filter((f) => f.level === 'danger').length;
  const warning = findings.filter((f) => f.level === 'warning').length;
  const recs = report.reconciliation;
  const badRecs = recs.filter((x) => !x.ok && x.key !== 'mfg-conversion').length;
  const head = recs.length ? (badRecs ? `${badRecs} dari ${recs.length} pencocokan buku besar berselisih` : `Semua ${recs.length} pencocokan buku besar cocok`) : 'Tidak ada pencocokan buku besar pada laporan ini';
  const tail = danger || warning ? `; ada ${[danger ? `${danger} temuan kritis` : '', warning ? `${warning} perlu perhatian` : ''].filter(Boolean).join(' dan ')}.` : '; tidak ada temuan yang perlu ditindaklanjuti.';
  return { status, summary: `${head}${tail}`, findings };
}

/** Rentang yang diizinkan per ambang: [min, maks, satuan] */
export const THRESHOLD_RANGES: Record<keyof InsightThresholds, [number, number, 'persen' | 'hari' | 'sesi']> = {
  agingWarnPct: [1, 100, 'persen'],
  agingDangerPct: [1, 100, 'persen'],
  lateSharePct: [1, 100, 'persen'],
  receivableConcentrationPct: [1, 100, 'persen'],
  concentrationPct: [1, 100, 'persen'],
  marginWarnPct: [0, 100, 'persen'],
  returnPct: [0.1, 100, 'persen'],
  deliveryDays: [1, 365, 'hari'],
  grniDays: [1, 365, 'hari'],
  posShortWarnPct: [0.01, 100, 'persen'],
  posShortDangerPct: [0.01, 100, 'persen'],
  posRepeatSessions: [2, 50, 'sesi'],
  posReturnPct: [0.1, 100, 'persen'],
  fnbUsagePct: [0.1, 100, 'persen'],
  swapPct: [0.1, 100, 'persen'],
  yieldPct: [1, 100, 'persen'],
  wipWarnDays: [1, 365, 'hari'],
  wipDangerDays: [1, 730, 'hari'],
  utilFlaggedPct: [0.1, 100, 'persen'],
  utilCollectionPct: [1, 100, 'persen'],
  utilArrearsDays: [1, 365, 'hari'],
};

/** Menggabungkan perubahan dengan nilai sekarang; mengembalikan pesan kesalahan bila ada yang tidak sah */
export function mergeThresholds(current: InsightThresholds, patch: Record<string, unknown>): { value: InsightThresholds; error?: string } {
  const value = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const range = THRESHOLD_RANGES[k as keyof InsightThresholds];
    if (!range) return { value, error: `Ambang "${k}" tidak dikenal` };
    const num = Number(v);
    if (!Number.isFinite(num) || num < range[0] || num > range[1]) return { value, error: `Nilai harus ${range[0]}–${range[1]} ${range[2]} (${k})` };
    value[k as keyof InsightThresholds] = num;
  }
  if (value.agingDangerPct < value.agingWarnPct) return { value, error: 'Batas kritis umur piutang tidak boleh lebih kecil dari batas perhatian' };
  if (value.posShortDangerPct < value.posShortWarnPct) return { value, error: 'Batas kritis selisih kas tidak boleh lebih kecil dari batas perhatian' };
  if (value.wipDangerDays < value.wipWarnDays) return { value, error: 'Batas kritis barang dalam proses tidak boleh lebih kecil dari batas perhatian' };
  return { value };
}
