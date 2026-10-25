import { diffDays } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import type { Check, HealthContext, Status } from './health-context';
import type { Out0 } from './health-checks-ledger';
import type { Out4 } from './health-checks-closing';

export async function ratioScore(c: HealthContext, prev: Out0 & Out4) {
  const { deps, tenantId, asOf, yearStart, checks } = c;
  const { fp, equity } = prev;
  // ---------- Rasio ----------
  const income = await deps.statements.income(tenantId, { from: yearStart, to: asOf }, 'SAK_EP');
  const L = (k: string) => D(income.lines.find((l) => l.key === k)?.amount ?? 0);
  const sec = (k: string) => D(fp.sections.find((s) => s.key === k)?.total ?? 0);
  const grp = (k: string) =>
    fp.sections
      .flatMap((s) => s.lines)
      .filter((l) => l.key === k)
      .reduce<Dec>((s, l) => s.plus(l.amount), ZERO);
  const days = Math.max(1, diffDays(yearStart, asOf) + 1);
  const ca = sec('CURRENT_ASSET');
  const cl = sec('CURRENT_LIABILITY');
  const liab = D(fp.totals.liabilities.amount);
  const assets = D(fp.totals.assets.amount);
  const revenue = L('NET_REVENUE');
  const cogs = L('COST_OF_SALES').abs();
  const net = L('NET_PROFIT');
  const div = (a: Dec, b: Dec) => (b.isZero() ? null : a.div(b).toNumber());
  const ratio = (
    key: string,
    group: string,
    label: string,
    value: number | null,
    unit: 'x' | '%' | 'hari',
    good: (v: number) => Status,
    explain: (v: number) => string,
  ) => ({
    key,
    group,
    label,
    value:
      value == null
        ? null
        : unit === '%'
          ? Math.round(value * 1000) / 10
          : unit === 'hari'
            ? Math.round(value)
            : Math.round(value * 100) / 100,
    unit,
    status: value == null ? 'INFO' : good(unit === '%' ? value * 100 : value),
    explanation: value == null ? 'Belum ada data untuk dihitung.' : explain(unit === '%' ? value * 100 : value),
  });
  const fmtx = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const annual = 365 / days;
  const inventory = grp('INVENTORY');
  const ar = grp('TRADE_RECEIVABLE').plus(grp('ALLOWANCE_RECEIVABLE'));
  const apBal = grp('TRADE_PAYABLE');
  const ratios = [
    ratio(
      'current',
      'Likuiditas',
      'Rasio lancar',
      div(ca, cl),
      'x',
      (v) => (v >= 1.5 ? 'OK' : v >= 1 ? 'WARN' : 'ERROR'),
      (v) => `Setiap Rp1 utang jangka pendek dijamin Rp${fmtx(v)} aset lancar. Ideal di atas 1,5.`,
    ),
    ratio(
      'quick',
      'Likuiditas',
      'Rasio cepat',
      div(ca.minus(inventory).minus(grp('PREPAID')), cl),
      'x',
      (v) => (v >= 1 ? 'OK' : v >= 0.5 ? 'WARN' : 'ERROR'),
      (v) => `Tanpa menjual stok, tersedia Rp${fmtx(v)} untuk tiap Rp1 utang jangka pendek.`,
    ),
    ratio(
      'cash',
      'Likuiditas',
      'Rasio kas',
      div(grp('CASH_EQUIVALENT'), cl),
      'x',
      (v) => (v >= 0.3 ? 'OK' : v >= 0.1 ? 'WARN' : 'ERROR'),
      (v) => `Uang tunai & bank cukup membayar ${fmtx(v * 100)}% utang jangka pendek hari ini.`,
    ),
    ratio(
      'der',
      'Solvabilitas',
      'Utang terhadap ekuitas (DER)',
      div(liab, equity),
      'x',
      (v) => (v < 0 ? 'ERROR' : v <= 1 ? 'OK' : v <= 2 ? 'WARN' : 'ERROR'),
      (v) =>
        `Usaha dibiayai Rp${fmtx(v)} utang untuk setiap Rp1 modal sendiri.${v > 2 ? ' Ketergantungan pada utang tinggi.' : ''}`,
    ),
    ratio(
      'debt',
      'Solvabilitas',
      'Utang terhadap aset',
      div(liab, assets),
      '%',
      (v) => (v <= 50 ? 'OK' : v <= 70 ? 'WARN' : 'ERROR'),
      (v) => `${fmtx(v)}% aset dibiayai oleh utang.`,
    ),
    ratio(
      'gpm',
      'Profitabilitas',
      'Margin laba kotor',
      div(L('GROSS_PROFIT'), revenue),
      '%',
      (v) => (v >= 10 ? 'OK' : v >= 5 ? 'WARN' : 'ERROR'),
      (v) => `Dari setiap Rp100 penjualan, tersisa Rp${fmtx(v)} setelah harga pokok barang. Distributor umumnya 8–20%.`,
    ),
    ratio(
      'npm',
      'Profitabilitas',
      'Margin laba bersih',
      div(net, revenue),
      '%',
      (v) => (v >= 3 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
      (v) => (v < 0 ? 'Usaha masih rugi pada periode ini.' : `Laba bersih Rp${fmtx(v)} dari setiap Rp100 penjualan.`),
    ),
    ratio(
      'roa',
      'Profitabilitas',
      'Imbal hasil aset (ROA, disetahunkan)',
      div(net.times(annual), assets),
      '%',
      (v) => (v >= 5 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
      (v) => `Setiap Rp100 aset menghasilkan laba Rp${fmtx(v)} per tahun.`,
    ),
    ratio(
      'roe',
      'Profitabilitas',
      'Imbal hasil ekuitas (ROE, disetahunkan)',
      equity.gt(0) ? div(net.times(annual), equity) : null,
      '%',
      (v) => (v >= 10 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
      (v) => `Modal pemilik menghasilkan ${fmtx(v)}% per tahun — bandingkan dengan bunga deposito.`,
    ),
    ratio(
      'dso',
      'Aktivitas',
      'Lama penagihan piutang (DSO)',
      revenue.gt(0) ? ar.div(revenue).times(days).toNumber() : null,
      'hari',
      (v) => (v <= 45 ? 'OK' : v <= 75 ? 'WARN' : 'ERROR'),
      (v) => `Rata-rata pelanggan membayar ${Math.round(v)} hari setelah faktur.`,
    ),
    ratio(
      'dio',
      'Aktivitas',
      'Lama stok tersimpan (DIO)',
      cogs.gt(0) ? inventory.div(cogs).times(days).toNumber() : null,
      'hari',
      (v) => (v <= 45 ? 'OK' : v <= 90 ? 'WARN' : 'ERROR'),
      (v) => `Stok saat ini cukup untuk ${Math.round(v)} hari penjualan.`,
    ),
    ratio(
      'dpo',
      'Aktivitas',
      'Lama pembayaran ke supplier (DPO)',
      cogs.gt(0) ? apBal.div(cogs).times(days).toNumber() : null,
      'hari',
      () => 'INFO',
      (v) => `Rata-rata supplier dibayar ${Math.round(v)} hari setelah faktur.`,
    ),
  ];
  const dso = ratios.find((r) => r.key === 'dso')!.value;
  const dio = ratios.find((r) => r.key === 'dio')!.value;
  const dpo = ratios.find((r) => r.key === 'dpo')!.value;
  if (dso != null && dio != null && dpo != null) {
    const ccc = dso + dio - dpo;
    ratios.push({
      key: 'ccc',
      group: 'Aktivitas',
      label: 'Siklus konversi kas',
      value: ccc,
      unit: 'hari',
      status: ccc <= 45 ? 'OK' : ccc <= 90 ? 'WARN' : 'ERROR',
      explanation: `Uang tertahan ${ccc} hari sejak membayar supplier sampai ditagih dari pelanggan. Makin pendek makin sehat.`,
    });
  }

  const errors = checks.filter((c) => c.status === 'ERROR').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  const ratioPenalty =
    ratios.filter((r) => r.status === 'ERROR').length * 3 + ratios.filter((r) => r.status === 'WARN').length;
  const score = Math.max(0, 100 - errors * 15 - warns * 5 - ratioPenalty);
  return {
    asOf,
    score,
    grade: score >= 85 ? 'Sehat' : score >= 65 ? 'Perlu perhatian' : 'Bermasalah',
    summary: { ok: checks.filter((c) => c.status === 'OK').length, warn: warns, error: errors },
    checks,
    ratios,
  };
}
