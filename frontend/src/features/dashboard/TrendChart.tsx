import { useId, useState } from 'react';
import { fmtMoney } from '@/lib/format';

export interface TrendPoint {
  month: string; // YYYY-MM
  sales: number;
  grossProfit: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SALES = '#FFFFFF';
const PROFIT = '#6EE7B7';

const short = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  return a >= 1e9 ? `${s}${(a / 1e9).toFixed(1).replace('.', ',')} M` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1).replace('.', ',')} jt` : a >= 1e3 ? `${s}${Math.round(a / 1e3)} rb` : `${s}${Math.round(a)}`;
};

/** Kurva halus (monotone cubic) lewat titik-titik: tidak melampaui nilai antar titik */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  const n = pts.length;
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = Math.hypot(a, b);
    if (h > 3) { t[i] = (3 * a * m[i]) / h; t[i + 1] = (3 * b * m[i]) / h; }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${(pts[i][0] + c).toFixed(1)},${(pts[i][1] + t[i] * c).toFixed(1)} ${(pts[i + 1][0] - c).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * c).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/**
 * Grafik tren penjualan dan laba kotor 6 bulan: kurva halus, sumbu nilai, legenda di luar gambar,
 * dan tooltip yang mengikuti sorotan mouse/fokus papan ketik. Tanpa pustaka tambahan.
 */
export default function TrendChart({ data }: { data: TrendPoint[] }) {
  const uid = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);
  const W = 420, H = 200, left = 44, right = 12, top = 14, bottom = 28;
  const values = data.flatMap((d) => [d.sales, d.grossProfit]);
  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(0, ...values);
  // sumbu dibulatkan ke angka rapi supaya garis bantu bernilai bulat
  const pow = 10 ** Math.floor(Math.log10(rawMax - rawMin || 1));
  const step = Math.ceil((rawMax - rawMin) / 4 / pow) * pow || 1;
  const max = rawMin + step * 4;
  const min = rawMin;
  const x = (i: number) => left + (i * (W - left - right)) / Math.max(1, data.length - 1);
  const y = (v: number) => top + (1 - (v - min) / (max - min || 1)) * (H - top - bottom);
  const salesPts: [number, number][] = data.map((d, i) => [x(i), y(d.sales)]);
  const profitPts: [number, number][] = data.map((d, i) => [x(i), y(d.grossProfit)]);
  const salesPath = smooth(salesPts);
  const area = `${salesPath} L${x(data.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => min + k * step);
  const cur = active ?? data.length - 1;
  const d = data[cur];
  const tipX = Math.min(Math.max(x(cur), left + 66), W - right - 66);

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 4 }} aria-hidden>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 14, height: 3, borderRadius: 2, background: SALES, display: 'inline-block' }} /> Penjualan
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 14, height: 3, borderRadius: 2, background: PROFIT, display: 'inline-block' }} /> Laba kotor
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Tren penjualan dan laba kotor ${data.length} bulan. ${MONTHS[Number(d.month.slice(5, 7)) - 1]}: penjualan ${fmtMoney(d.sales)}, laba kotor ${fmtMoney(d.grossProfit)}`}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SALES} stopOpacity=".34" />
            <stop offset="100%" stopColor={SALES} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PROFIT} stopOpacity=".22" />
            <stop offset="100%" stopColor={PROFIT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity={v === 0 ? 0.35 : 0.12} strokeDasharray={v === 0 ? undefined : '3 4'} />
            <text x={left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#fff" fillOpacity=".62">{short(v)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${uid}a)`} />
        <path d={`${smooth(profitPts)} L${x(data.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`} fill={`url(#${uid}b)`} />
        <path d={salesPath} fill="none" stroke={SALES} strokeWidth="2.4" strokeLinecap="round" />
        <path d={smooth(profitPts)} fill="none" stroke={PROFIT} strokeWidth="2.4" strokeLinecap="round" />
        {/* garis penunjuk bulan terpilih */}
        <line x1={x(cur)} x2={x(cur)} y1={top} y2={H - bottom} stroke="#fff" strokeOpacity=".35" strokeDasharray="2 3" />
        <circle cx={x(cur)} cy={y(d.sales)} r="5" fill="#111" stroke={SALES} strokeWidth="2.4" />
        <circle cx={x(cur)} cy={y(d.grossProfit)} r="5" fill="#111" stroke={PROFIT} strokeWidth="2.4" />
        {data.map((p, i) => (
          <g key={p.month}>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#fff" fillOpacity={i === cur ? 1 : 0.6} fontWeight={i === cur ? 700 : 400}>
              {MONTHS[Number(p.month.slice(5, 7)) - 1]}
            </text>
            {/* area sentuh selebar kolom; dapat difokus dengan papan ketik */}
            <rect
              x={x(i) - (W - left - right) / Math.max(1, data.length - 1) / 2}
              y={top}
              width={(W - left - right) / Math.max(1, data.length - 1)}
              height={H - top - bottom}
              fill="transparent"
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${MONTHS[Number(p.month.slice(5, 7)) - 1]}: penjualan ${fmtMoney(p.sales)}, laba kotor ${fmtMoney(p.grossProfit)}`}
              style={{ outline: 'none' }}
            />
          </g>
        ))}
        <g transform={`translate(${tipX - 62},${Math.max(top, Math.min(y(d.sales), y(d.grossProfit)) - 52)})`} pointerEvents="none">
          <rect width="124" height="42" rx="8" fill="#000" fillOpacity=".78" stroke="#fff" strokeOpacity=".25" />
          <circle cx="11" cy="14" r="3.5" fill={SALES} />
          <text x="20" y="17.5" fontSize="10.5" fill="#fff">Penjualan</text>
          <text x="114" y="17.5" fontSize="10.5" fontWeight="700" textAnchor="end" fill="#fff">{short(d.sales)}</text>
          <circle cx="11" cy="30" r="3.5" fill={PROFIT} />
          <text x="20" y="33.5" fontSize="10.5" fill="#fff">Laba kotor</text>
          <text x="114" y="33.5" fontSize="10.5" fontWeight="700" textAnchor="end" fill={PROFIT}>{short(d.grossProfit)}</text>
        </g>
      </svg>
    </div>
  );
}
