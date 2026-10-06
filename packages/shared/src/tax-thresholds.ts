/**
 * Peringatan ambang pajak: memantau peredaran bruto tahun berjalan terhadap batas Rp4,8 miliar
 * (kewajiban PKP, batas PPh final UMKM) dan Rp50 miliar (fasilitas Pasal 31E), ditambah kriteria UMKM
 * untuk standar akuntansi. Fungsi murni: dipakai server (cek kesehatan, banner) dan mudah diuji pada nilai batas.
 */
import type { LegalForm, ReportingFramework, TaxScheme } from './accounting.js';
import {
  ENTITY_SIZE_LABELS,
  type EntitySize,
  FACILITY_31E_REVENUE_LIMIT,
  FINAL_TAX_EXCLUDED_FORMS,
  TAX_REVENUE_LIMIT,
} from './entity-profile.js';

export type AlertLevel = 'OK' | 'INFO' | 'WARN' | 'ERROR';
export const ALERT_LEVEL_ORDER: AlertLevel[] = ['OK', 'INFO', 'WARN', 'ERROR'];

export interface ThresholdAlert {
  key: 'pkp' | 'final-tax' | 'final-tax-eligibility' | 'facility-31e' | 'umkm-size';
  title: string;
  level: AlertLevel;
  message: string;
  /** Peredaran bruto tahun berjalan (Rp) */
  current: number;
  /** Batas yang dipantau (Rp); 0 bila bukan ambang rupiah */
  limit: number;
  /** current / limit × 100, dibulatkan satu desimal */
  percent: number;
  /** Perkiraan peredaran setahun penuh bila laju sekarang berlanjut (null bila data masih terlalu sedikit) */
  projected: number | null;
  /** Perkiraan bulan batas terlewati (YYYY-MM), bila terlewati tahun ini pada laju sekarang */
  crossingMonth: string | null;
  link: string;
}

export interface ThresholdInput {
  /** Tanggal hitung (YYYY-MM-DD) */
  asOf: string;
  /** Peredaran bruto 1 Januari s/d asOf (Rp) */
  revenueYtd: number;
  pkp: boolean;
  taxScheme: TaxScheme;
  framework: ReportingFramework;
  legalForm: LegalForm;
  /** Ukuran usaha dari pembukuan 12 bulan terakhir (kriteria UMKM) */
  size: EntitySize;
}

/** Peringatan dini mulai dari sekian persen batas */
export const WARN_PERCENT = 80;
/** Proyeksi hanya dipercaya setelah sebagian tahun berjalan (cukup data, tidak berisik di awal tahun) */
export const MIN_YEAR_FRACTION = 0.25;

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
const pct = (current: number, limit: number) => (limit > 0 ? Math.round((current / limit) * 1000) / 10 : 0);

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function dayOfYear(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const days = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days.slice(0, m - 1).reduce((a, b) => a + b, 0) + d;
}
const daysInYear = (date: string) => (isLeap(Number(date.slice(0, 4))) ? 366 : 365);

/** Proyeksi peredaran setahun penuh dari laju sampai tanggal ini; null bila belum cukup data */
export function projectYear(revenueYtd: number, asOf: string): number | null {
  const fraction = dayOfYear(asOf) / daysInYear(asOf);
  if (fraction < MIN_YEAR_FRACTION || revenueYtd <= 0) return null;
  return revenueYtd / fraction;
}

/** Bulan (YYYY-MM) batas terlewati bila laju sekarang berlanjut; null bila sudah lewat atau tidak lewat tahun ini */
export function crossingMonth(revenueYtd: number, asOf: string, limit: number): string | null {
  if (revenueYtd >= limit || revenueYtd <= 0) return null;
  const elapsed = dayOfYear(asOf);
  const perDay = revenueYtd / elapsed;
  const crossDay = Math.ceil(elapsed + (limit - revenueYtd) / perDay);
  if (crossDay > daysInYear(asOf)) return null;
  const y = Number(asOf.slice(0, 4));
  const days = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let left = crossDay;
  for (let m = 0; m < 12; m++) {
    if (left <= days[m]) return `${y}-${String(m + 1).padStart(2, '0')}`;
    left -= days[m];
  }
  return null;
}

const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function build(
  key: ThresholdAlert['key'],
  title: string,
  link: string,
  i: ThresholdInput,
  limit: number,
  texts: { over: string; near: string; ok: string },
  overLevel: AlertLevel = 'ERROR',
): ThresholdAlert {
  const projected = projectYear(i.revenueYtd, i.asOf);
  const cross = crossingMonth(i.revenueYtd, i.asOf, limit);
  const percent = pct(i.revenueYtd, limit); // hanya untuk tampilan; keputusan memakai rasio yang belum dibulatkan
  let level: AlertLevel;
  let message: string;
  if (i.revenueYtd > limit) {
    level = overLevel;
    message = texts.over;
  } else if ((i.revenueYtd / limit) * 100 >= WARN_PERCENT || (projected !== null && projected > limit)) {
    level = 'WARN';
    const eta = cross ? ` Pada laju sekarang batas terlewati sekitar ${monthLabel(cross)}.` : '';
    message = `${texts.near}${eta}`;
  } else {
    level = 'OK';
    message = texts.ok;
  }
  return { key, title, level, message, current: i.revenueYtd, limit, percent, projected, crossingMonth: cross, link };
}

export function evaluateThresholds(i: ThresholdInput): ThresholdAlert[] {
  const out: ThresholdAlert[] = [];
  const ytd = `peredaran bruto ${i.asOf.slice(0, 4)} sampai ${i.asOf} sebesar ${rp(i.revenueYtd)}`;

  // PKP: wajib dikukuhkan setelah peredaran melewati Rp4,8 miliar
  if (!i.pkp) {
    out.push(
      build('pkp', 'Batas wajib PKP', '/settings/company', i, TAX_REVENUE_LIMIT, {
        over: `Peredaran bruto ${rp(i.revenueYtd)} sudah melewati ${rp(TAX_REVENUE_LIMIT)}. Perusahaan wajib dikukuhkan sebagai PKP paling lambat akhir bulan berikutnya setelah bulan batas terlewati; sejak itu PPN keluaran wajib dipungut. Jalankan wizard standar & pajak atau aktifkan PKP di Pengaturan.`,
        near: `Peredaran bruto ${rp(i.revenueYtd)} (${pct(i.revenueYtd, TAX_REVENUE_LIMIT)}% dari batas ${rp(TAX_REVENUE_LIMIT)}). Siapkan pengukuhan PKP sebelum batas terlewati.`,
        ok: `Belum PKP, ${ytd} (${pct(i.revenueYtd, TAX_REVENUE_LIMIT)}% dari batas ${rp(TAX_REVENUE_LIMIT)}).`,
      }),
    );
  }

  // PPh final UMKM 0,5%
  if (i.taxScheme === 'FINAL_UMKM') {
    out.push(
      build('final-tax', 'Batas PPh final UMKM', '/tax', i, TAX_REVENUE_LIMIT, {
        over: `Peredaran bruto ${rp(i.revenueYtd)} melewati ${rp(TAX_REVENUE_LIMIT)}: PPh final UMKM tidak berlaku lagi mulai tahun pajak berikutnya, dan perusahaan perlu beralih ke tarif umum dengan fasilitas Pasal 31E.`,
        near: `Peredaran bruto ${rp(i.revenueYtd)} (${pct(i.revenueYtd, TAX_REVENUE_LIMIT)}% dari batas PPh final ${rp(TAX_REVENUE_LIMIT)}). Bersiap beralih ke tarif umum.`,
        ok: `PPh final UMKM masih berlaku, ${ytd} (${pct(i.revenueYtd, TAX_REVENUE_LIMIT)}% dari batas).`,
      }),
    );
    if (FINAL_TAX_EXCLUDED_FORMS.includes(i.legalForm)) {
      out.push({
        key: 'final-tax-eligibility',
        title: 'Hak atas PPh final UMKM',
        level: 'WARN',
        message:
          'CV, Firma, dan PT (bukan PT Perorangan) tidak lagi menjadi subjek PPh final 0,5% kecuali masih dalam masa transisi jangka waktu semula. Pastikan perusahaan masih berhak, atau pindah ke tarif umum.',
        current: i.revenueYtd,
        limit: 0,
        percent: 0,
        projected: null,
        crossingMonth: null,
        link: '/settings/company',
      });
    }
  }

  // Fasilitas Pasal 31E (tarif umum)
  if (i.taxScheme === 'GENERAL') {
    out.push(
      build(
        'facility-31e',
        'Batas fasilitas Pasal 31E',
        '/fiscal',
        i,
        FACILITY_31E_REVENUE_LIMIT,
        {
          over: `Peredaran bruto ${rp(i.revenueYtd)} melewati ${rp(FACILITY_31E_REVENUE_LIMIT)}: fasilitas pengurangan tarif 50% Pasal 31E tidak berlaku, seluruh penghasilan kena pajak dikenai tarif 22%.`,
          near: `Peredaran bruto ${rp(i.revenueYtd)} (${pct(i.revenueYtd, FACILITY_31E_REVENUE_LIMIT)}% dari ${rp(FACILITY_31E_REVENUE_LIMIT)}). Fasilitas Pasal 31E akan hilang bila batas terlewati.`,
          ok:
            i.revenueYtd > TAX_REVENUE_LIMIT
              ? `Fasilitas Pasal 31E berlaku sebagian: hanya bagian peredaran sampai ${rp(TAX_REVENUE_LIMIT)} yang mendapat tarif 11%. ${ytd}.`
              : `Seluruh penghasilan kena pajak mendapat tarif 11% (Pasal 31E), ${ytd}.`,
        },
        'INFO',
      ),
    );
  }

  // Kriteria UMKM untuk SAK EMKM
  if (i.framework === 'SAK_EMKM') {
    const large = i.size === 'LARGE';
    out.push({
      key: 'umkm-size',
      title: 'Kriteria UMKM untuk SAK EMKM',
      level: large ? 'WARN' : 'OK',
      message: large
        ? 'Ukuran usaha dari pembukuan 12 bulan terakhir melewati kriteria UMKM, sehingga SAK EMKM tidak lagi memenuhi syarat. Jalankan wizard standar & pajak untuk beralih ke SAK EP.'
        : `Ukuran usaha: ${ENTITY_SIZE_LABELS[i.size].toLowerCase()}, masih memenuhi kriteria UMKM untuk SAK EMKM.`,
      current: i.revenueYtd,
      limit: 0,
      percent: 0,
      projected: null,
      crossingMonth: null,
      link: '/settings/company?wizard=1',
    });
  }

  return out;
}

/** Tingkat terparah dari sekumpulan peringatan */
export function worstLevel(alerts: { level: AlertLevel }[]): AlertLevel {
  return alerts.reduce<AlertLevel>((w, a) => (ALERT_LEVEL_ORDER.indexOf(a.level) > ALERT_LEVEL_ORDER.indexOf(w) ? a.level : w), 'OK');
}

/** Respons GET /accounting/tax-thresholds */
export interface TaxThresholdReport {
  asOf: string;
  year: number;
  revenueYtd: number;
  worst: AlertLevel;
  alerts: ThresholdAlert[];
}
