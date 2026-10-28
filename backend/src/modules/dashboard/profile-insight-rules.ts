/**
 * Saran beranda khas profil layanan Jasa. Murni (tanpa database): menerima angka yang sudah dihitung dan mengembalikan temuan.
 * Bahasa berupa saran yang boleh diikuti atau diabaikan, sama dengan aturan beranda umum.
 */
import { type DashboardInsight, idr, pctText } from './insight-rules';

const n = (v: unknown) => Number(v ?? 0) || 0;

export function kontraktorInsights(m: Record<string, unknown>): DashboardInsight[] {
  const out: DashboardInsight[] = [];
  const due = n(m.retention_due);
  if (due > 0)
    out.push({ id: 'kontraktor-retensi', category: 'PIUTANG', tone: 'warning', title: 'Retensi sudah jatuh tempo', evidence: `Retensi ${idr(due)} sudah melewati masa pemeliharaan tetapi belum dibayar pemberi kerja (total retensi tertahan ${idr(n(m.retention_held))}).`, recommendation: 'Siapkan berita acara serah terima akhir dan tagih pelunasan retensi.', impact: { label: 'Retensi jatuh tempo', amount: due }, link: '/invoices', linkLabel: 'Lihat tagihan', score: 85 });
  const budget = n(m.budget);
  if (budget > 0) {
    const ratio = n(m.budget_cost) / budget;
    const over = n(m.over_budget);
    if (over > 0 || ratio >= 0.9)
      out.push({ id: 'kontraktor-anggaran', category: 'MARGIN', tone: 'warning', title: over > 0 ? `${over} proyek melewati anggaran biaya` : 'Biaya proyek mendekati anggaran', evidence: `Biaya langsung ${idr(n(m.budget_cost))} dari anggaran ${idr(budget)} (${pctText(ratio)}) pada proyek beranggaran.`, recommendation: 'Periksa biaya per jenis di laporan kontraktor; ajukan addendum bila ada pekerjaan tambah.', link: '/laporan/jasa-kontraktor', linkLabel: 'Laporan kontraktor', score: over > 0 ? 80 : 60 });
  }
  const contract = n(m.contract_active);
  if (contract > 0) {
    const billed = n(m.billed_active) / contract;
    out.push({ id: 'kontraktor-tertagih', category: 'PENJUALAN', tone: 'info', title: `Tertagih ${pctText(billed)} dari nilai kontrak berjalan`, evidence: `${n(m.projects_active)} proyek aktif bernilai ${idr(contract)}; sudah ditagih ${idr(n(m.billed_active))}.`, recommendation: 'Bandingkan dengan kemajuan pekerjaan: termin yang sudah boleh ditagih sebaiknya segera diterbitkan.', facts: [{ label: 'Sisa kontrak', value: idr(contract - n(m.billed_active)) }], link: '/projects', linkLabel: 'Proyek', score: 30 });
  }
  return out;
}

export function konsultanInsights(m: Record<string, unknown>): DashboardInsight[] {
  const out: DashboardInsight[] = [];
  const value = n(m.unbilled_value);
  if (value > 0)
    out.push({ id: 'konsultan-belum-tagih', category: 'PENJUALAN', tone: 'opportunity', title: 'Jam kerja disetujui belum ditagih', evidence: `${n(m.unbilled_hours)} jam senilai ${idr(value)} sudah disetujui sejak ${String(m.unbilled_oldest ?? '-')} tetapi belum masuk tagihan.`, recommendation: 'Tagih dari halaman Lembar waktu agar pendapatan tidak tertunda.', impact: { label: 'Belum ditagih', amount: value }, link: '/timesheets', linkLabel: 'Lembar waktu', score: 82 });
  const behind = n(m.retainers_behind);
  if (behind > 0)
    out.push({ id: 'konsultan-retainer', category: 'PENJUALAN', tone: 'warning', title: `${behind} retainer belum ditagih bulan lalu`, evidence: 'Retainer aktif tanpa tagihan untuk periode bulan lalu.', recommendation: 'Tagih periode yang terlewat di halaman Retainer.', link: '/retainers', linkLabel: 'Retainer', score: 78 });
  const logged = n(m.logged_month);
  if (logged >= 20) {
    const util = n(m.hours_month) / logged;
    out.push({ id: 'konsultan-utilisasi', category: 'PRODUK', tone: util < 0.6 ? 'warning' : 'good', title: `Utilisasi bulan ini ${pctText(util)}`, evidence: `${n(m.hours_month)} jam dapat ditagih dari ${logged} jam yang dicatat.`, recommendation: util < 0.6 ? 'Banyak jam tidak tertagih: periksa pekerjaan internal dan proyek tanpa tarif.' : 'Pertahankan porsi jam yang dapat ditagih.', link: '/laporan/jasa-konsultan', linkLabel: 'Laporan konsultan', score: util < 0.6 ? 55 : 25 });
  }
  return out;
}

export function pendidikanInsights(m: Record<string, unknown>, dayOfMonth: number): DashboardInsight[] {
  const out: DashboardInsight[] = [];
  const arrears = n(m.arrears);
  if (arrears > 0)
    out.push({ id: 'pendidikan-tunggakan', category: 'PIUTANG', tone: 'warning', title: `Tunggakan SPP ${idr(arrears)}`, evidence: `${n(m.arrears_families)} wali menunggak SPP yang sudah jatuh tempo.`, recommendation: 'Kirim pengingat ke wali dan tawarkan cicilan; lihat daftar per wali di laporan pendidikan.', impact: { label: 'Tunggakan', amount: arrears }, link: '/laporan/jasa-pendidikan', linkLabel: 'Laporan pendidikan', score: 84 });
  const unbilled = n(m.unbilled_now);
  if (unbilled > 0 && dayOfMonth >= 5)
    out.push({ id: 'pendidikan-belum-tagih', category: 'PENJUALAN', tone: 'warning', title: `SPP bulan ini belum ditagih untuk ${unbilled} peserta`, evidence: 'Peserta aktif tanpa tagihan SPP periode berjalan.', recommendation: 'Jalankan penagihan SPP bulan ini di Kelas & SPP.', link: '/education', linkLabel: 'Kelas & SPP', score: 76 });
  const billed = n(m.billed3);
  if (billed > 0) {
    const rate = n(m.paid3) / billed;
    out.push({ id: 'pendidikan-penagihan', category: 'PIUTANG', tone: rate < 0.85 ? 'warning' : 'good', title: `Tingkat penagihan SPP 3 bulan ${pctText(rate)}`, evidence: `Terbayar ${idr(n(m.paid3))} dari ${idr(billed)} yang ditagih tiga bulan terakhir.`, recommendation: rate < 0.85 ? 'Perketat jadwal pengingat dan sediakan pembayaran transfer/QRIS.' : 'Penagihan berjalan baik.', score: rate < 0.85 ? 58 : 20 });
  }
  const cap = n(m.capacity);
  if (cap > 0 && n(m.seated) / cap < 0.6)
    out.push({ id: 'pendidikan-keterisian', category: 'PELANGGAN', tone: 'opportunity', title: `Kelas baru terisi ${pctText(n(m.seated) / cap)}`, evidence: `${n(m.seated)} peserta dari kapasitas ${cap} kursi.`, recommendation: 'Isi kursi kosong lewat kelas percobaan atau promo saudara.', link: '/crm', linkLabel: 'Calon peserta', score: 40 });
  return out;
}

export function alihDayaInsights(m: Record<string, unknown>): DashboardInsight[] {
  const out: DashboardInsight[] = [];
  const need = n(m.need_head_days);
  if (need > 0) {
    const fill = n(m.duty_head_days) / need;
    if (fill < 0.95)
      out.push({ id: 'alihdaya-keterisian', category: 'PRODUK', tone: 'warning', title: `Keterisian jaga bulan ini ${pctText(fill)}`, evidence: `${n(m.duty_head_days)} hari-orang terjadwal dari kebutuhan ${need}; ${n(m.posts_short_today)} pos kurang petugas hari ini.`, recommendation: 'Lengkapi jadwal jaga; kekurangan petugas dipotong dari tagihan bila kontrak mengatur demikian.', link: '/sites', linkLabel: 'Kontrak per lokasi', score: 80 });
  }
  const unbilled = n(m.unbilled_prev);
  if (unbilled > 0)
    out.push({ id: 'alihdaya-belum-tagih', category: 'PENJUALAN', tone: 'warning', title: `${unbilled} kontrak lokasi belum ditagih bulan lalu`, evidence: 'Kontrak aktif tanpa tagihan untuk periode bulan lalu.', recommendation: 'Tagih periode bulan lalu di Kontrak per lokasi.', link: '/sites', linkLabel: 'Kontrak per lokasi', score: 79 });
  const overdue = n(m.ar_overdue);
  if (overdue > 0)
    out.push({ id: 'alihdaya-piutang', category: 'PIUTANG', tone: 'warning', title: `Piutang kontrak lewat jatuh tempo ${idr(overdue)}`, evidence: 'Tagihan kontrak lokasi yang belum dibayar setelah jatuh tempo.', recommendation: 'Hubungi bagian keuangan pengguna jasa; gaji petugas tetap harus dibayar tepat waktu.', impact: { label: 'Lewat jatuh tempo', amount: overdue }, link: '/invoices', linkLabel: 'Tagihan', score: 70 });
  return out;
}

export function bengkelInsights(m: Record<string, unknown>): DashboardInsight[] {
  const out: DashboardInsight[] = [];
  const svc = n(m.service_month);
  const parts = n(m.parts_month);
  if (svc + parts > 0)
    out.push({ id: 'bengkel-komposisi', category: 'PRODUK', tone: 'info', title: `Layanan ${pctText(svc / (svc + parts))} dari penjualan kasir bulan ini`, evidence: `Layanan ${idr(svc)} dan suku cadang ${idr(parts)} dari ${n(m.orders_month)} transaksi.${m.top_mechanic ? ` Mekanik teratas: ${String(m.top_mechanic)}.` : ''}`, recommendation: 'Layanan bermargin lebih tinggi daripada suku cadang; tawarkan paket servis berkala.', link: '/laporan/jasa-bengkel', linkLabel: 'Laporan bengkel', score: 30 });
  const noStaff = n(m.service_no_staff);
  if (noStaff > 0)
    out.push({ id: 'bengkel-tanpa-mekanik', category: 'PRODUK', tone: 'warning', title: 'Layanan kasir tanpa mekanik tercatat', evidence: `Layanan senilai ${idr(noStaff)} bulan ini tidak mencatat mekanik.`, recommendation: 'Pilih mekanik pada tiap baris layanan agar komisi dan kinerja per mekanik akurat.', link: '/pos', linkLabel: 'Kasir', score: 50 });
  return out;
}
