/**
 * Wawasan & saran untuk pimpinan: ringkasan kondisi, tren 6 bulan, dan kartu saran yang diturunkan dari data.
 * Sifatnya masukan untuk dipertimbangkan (bisa disembunyikan), bukan keharusan.
 */
import {
  BulbFilled,
  CheckCircleFilled,
  ClockCircleOutlined,
  CreditCardOutlined,
  EyeInvisibleOutlined,
  FundOutlined,
  InboxOutlined,
  PercentageOutlined,
  RiseOutlined,
  RightOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ThunderboltFilled,
  WalletOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Skeleton, Tooltip } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { fmtMoney } from '@/lib/format';

type Tone = 'warning' | 'opportunity' | 'good' | 'info';
interface Insight {
  id: string;
  category: string;
  tone: Tone;
  title: string;
  evidence: string;
  recommendation: string;
  impact?: { label: string; amount: number };
  facts?: { label: string; value: string }[];
  link?: string;
  linkLabel?: string;
  score: number;
}
interface Trend { month: string; sales: number; grossProfit: number; expense: number }
interface Payload {
  asOf: string;
  summary: { headline: string; sub: string; warnings: number; opportunities: number; good: number; info: number };
  trend: Trend[];
  insights: Insight[];
  note: string;
}

const TONE: Record<Tone, { label: string; accent: string; soft: string; text: string }> = {
  warning: { label: 'Perlu perhatian', accent: '#F04438', soft: '#FEF3F2', text: '#B42318' },
  opportunity: { label: 'Peluang', accent: '#7A5AF8', soft: '#F4F3FF', text: '#5925DC' },
  good: { label: 'Kabar baik', accent: '#12B76A', soft: '#ECFDF3', text: '#027A48' },
  info: { label: 'Catatan', accent: '#2E90FA', soft: '#EFF8FF', text: '#175CD3' },
};
const CATEGORY: Record<string, { label: string; icon: ReactNode }> = {
  KAS: { label: 'Kas', icon: <WalletOutlined /> },
  PENJUALAN: { label: 'Penjualan', icon: <RiseOutlined /> },
  PIUTANG: { label: 'Piutang', icon: <ClockCircleOutlined /> },
  HUTANG: { label: 'Hutang', icon: <CreditCardOutlined /> },
  MARGIN: { label: 'Margin', icon: <PercentageOutlined /> },
  BIAYA: { label: 'Biaya', icon: <FundOutlined /> },
  PERSEDIAAN: { label: 'Persediaan', icon: <InboxOutlined /> },
  PELANGGAN: { label: 'Pelanggan', icon: <TeamOutlined /> },
  PRODUK: { label: 'Produk', icon: <ShoppingOutlined /> },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const short = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  return a >= 1e9 ? `${s}${(a / 1e9).toFixed(1).replace('.', ',')} M` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1).replace('.', ',')} jt` : a >= 1e3 ? `${s}${Math.round(a / 1e3)} rb` : `${s}${Math.round(a)}`;
};

const CSS = `
@keyframes insUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes insPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(240,68,56,.45); } 50% { box-shadow: 0 0 0 7px rgba(240,68,56,0); } }
@keyframes insDraw { from { stroke-dashoffset: 700; } to { stroke-dashoffset: 0; } }
.ins-card { animation: insUp .45s ease both; transition: transform .18s ease, box-shadow .18s ease; }
.ins-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px -14px rgba(16,28,51,.35) !important; }
.ins-pulse { animation: insPulse 2.2s ease-in-out infinite; }
.ins-line { stroke-dasharray: 700; animation: insDraw 1.4s ease-out both; }
.ins-pill { transition: transform .15s ease, background .15s ease; cursor: pointer; border: 0; }
.ins-pill:hover { transform: translateY(-1px); background: rgba(255,255,255,.26) !important; }
@media (prefers-reduced-motion: reduce) { .ins-card, .ins-pulse, .ins-line { animation: none !important; } .ins-card:hover { transform: none; } }
`;

/** Grafik garis/area ringkas: penjualan dan laba kotor 6 bulan */
function Spark({ data }: { data: Trend[] }) {
  const W = 340, H = 132, padX = 14, top = 14, bottom = 26;
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.grossProfit]));
  const min = Math.min(0, ...data.flatMap((d) => [d.sales, d.grossProfit]));
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => top + (1 - (v - min) / (max - min || 1)) * (H - top - bottom);
  const line = (k: 'sales' | 'grossProfit') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const area = `${line('sales')} L${x(data.length - 1)},${H - bottom} L${x(0)},${H - bottom} Z`;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tren penjualan dan laba kotor 6 bulan" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="insArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity=".38" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={padX} x2={W - padX} y1={top + f * (H - top - bottom)} y2={top + f * (H - top - bottom)} stroke="#fff" strokeOpacity=".12" />
      ))}
      <path d={area} fill="url(#insArea)" />
      <path className="ins-line" d={line('sales')} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path className="ins-line" d={line('grossProfit')} fill="none" stroke="#7CF2C1" strokeWidth="2.2" strokeDasharray="5 5" strokeLinecap="round" style={{ animation: 'none' }} />
      {data.map((d, i) => (
        <g key={d.month}>
          <circle cx={x(i)} cy={y(d.sales)} r={i === data.length - 1 ? 4.6 : 3} fill="#fff" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#fff" fillOpacity=".78">{MONTHS[Number(d.month.slice(5, 7)) - 1]}</text>
        </g>
      ))}
      <text x={x(data.length - 1) - 9} y={y(last.sales) - 10} textAnchor="end" fontSize="11.5" fontWeight="700" fill="#fff" stroke="#1C3160" strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round">{short(last.sales)}</text>
      {prev && prev.sales > 0 && (
        <text x={padX} y={11} fontSize="10.5" fill="#fff" fillOpacity=".8">
          ▬ Penjualan  <tspan fill="#7CF2C1">┅ Laba kotor</tspan>
        </text>
      )}
    </svg>
  );
}

function InsightCard({ i, index, onHide }: { i: Insight; index: number; onHide: () => void }) {
  const navigate = useNavigate();
  const tone = TONE[i.tone];
  const cat = CATEGORY[i.category] ?? { label: i.category, icon: <BulbFilled /> };
  const critical = i.tone === 'warning' && i.score >= 85;
  return (
    <article
      className="ins-card"
      style={{
        animationDelay: `${Math.min(index, 8) * 60}ms`,
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #E4E7EC',
        borderLeft: `5px solid ${tone.accent}`,
        boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 6px 16px -10px rgba(16,24,40,.18)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className={critical ? 'ins-pulse' : undefined} style={{ width: 32, height: 32, borderRadius: 10, background: tone.soft, color: tone.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
          {cat.icon}
        </span>
        <span style={{ fontSize: 12, color: '#667085', fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{cat.label}</span>
        <span style={{ marginLeft: 'auto', background: tone.soft, color: tone.text, fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>
          {critical ? 'Segera ditinjau' : tone.label}
        </span>
      </header>

      <h3 style={{ margin: 0, fontSize: 16.5, lineHeight: 1.3, color: '#101C33', fontWeight: 700 }}>{i.title}</h3>

      {i.impact && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: tone.accent, letterSpacing: -0.5, lineHeight: 1 }}>{fmtMoney(Math.round(i.impact.amount))}</span>
          <span style={{ fontSize: 12.5, color: '#667085' }}>{i.impact.label}</span>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13.5, color: '#475467', lineHeight: 1.5 }}>{i.evidence}</p>

      {!!i.facts?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {i.facts.map((f) => (
            <span key={f.label} style={{ background: '#F2F4F7', borderRadius: 8, padding: '3px 9px', fontSize: 12, color: '#344054' }}>
              <span style={{ color: '#667085' }}>{f.label}: </span>
              <b>{f.value}</b>
            </span>
          ))}
        </div>
      )}

      <div style={{ background: tone.soft, borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <BulbFilled style={{ color: tone.accent, fontSize: 16, marginTop: 2 }} />
        <div style={{ fontSize: 13.5, color: '#1D2939', lineHeight: 1.5 }}>
          <b style={{ color: tone.text }}>Saran: </b>
          {i.recommendation}
        </div>
      </div>

      <footer style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
        {i.link && (
          <Button type="link" style={{ paddingLeft: 0, fontWeight: 600 }} onClick={() => navigate(i.link!)}>
            {i.linkLabel ?? 'Lihat data'} <RightOutlined style={{ fontSize: 11 }} />
          </Button>
        )}
        <Tooltip title="Sembunyikan saran ini selama 7 hari">
          <Button type="text" size="small" icon={<EyeInvisibleOutlined />} style={{ marginLeft: 'auto', color: '#98A2B3' }} onClick={onHide} aria-label="Sembunyikan saran ini" />
        </Tooltip>
      </footer>
    </article>
  );
}

export default function InsightPanel() {
  const { me } = useAuth();
  const { data, isLoading, isError } = useQuery({ queryKey: ['dashboard', 'insights'], queryFn: () => get<Payload>('/dashboard/insights'), staleTime: 60_000 });
  const [filter, setFilter] = useState<'all' | Tone>('all');
  const storeKey = `sansu.insight.hidden.${me?.id ?? 'x'}`;
  const [hidden, setHidden] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, number>;
      const now = Date.now();
      setHidden(Object.fromEntries(Object.entries(raw).filter(([, until]) => until > now)));
    } catch {
      setHidden({});
    }
  }, [storeKey]);
  const hide = (id: string) => {
    const next = { ...hidden, [id]: Date.now() + 7 * 86_400_000 };
    setHidden(next);
    try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* penyimpanan peramban tidak tersedia: hanya berlaku sesi ini */ }
  };
  const showAll = () => {
    setHidden({});
    try { localStorage.removeItem(storeKey); } catch { /* abaikan */ }
  };

  const visible = useMemo(() => (data?.insights ?? []).filter((x) => !hidden[x.id] && (filter === 'all' || x.tone === filter)), [data, hidden, filter]);
  const hiddenCount = (data?.insights ?? []).filter((x) => hidden[x.id]).length;

  if (isError) return null;
  if (isLoading || !data) {
    return (
      <div style={{ marginTop: 16, borderRadius: 20, padding: 24, background: 'linear-gradient(135deg,#101C33,#1C3160)' }}>
        <Skeleton active paragraph={{ rows: 3 }} title={{ width: '40%' }} style={{ opacity: 0.35 }} />
      </div>
    );
  }
  const s = data.summary;
  const hasSales = data.trend.some((t) => t.sales !== 0);
  const pills: { key: 'all' | Tone; label: string; n: number; dot: string }[] = [
    { key: 'warning', label: 'perlu perhatian', n: s.warnings, dot: '#FF8A80' },
    { key: 'opportunity', label: 'peluang', n: s.opportunities, dot: '#C4B5FD' },
    { key: 'good', label: 'kabar baik', n: s.good, dot: '#7CF2C1' },
  ];
  return (
    <section aria-label="Wawasan dan saran" style={{ marginTop: 16 }}>
      <style>{CSS}</style>
      <div
        style={{
          borderRadius: 22,
          padding: '22px 24px',
          color: '#fff',
          background: 'radial-gradient(1200px 400px at 85% -10%, rgba(124,242,193,.22), transparent 60%), radial-gradient(900px 380px at -5% 120%, rgba(122,90,248,.35), transparent 55%), linear-gradient(135deg,#101C33 0%,#1C3160 55%,#2A4580 100%)',
          boxShadow: '0 22px 44px -22px rgba(16,28,51,.7)',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)',
          gap: 20,
          alignItems: 'center',
        }}
        className="ins-hero"
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.14)', borderRadius: 999, padding: '4px 12px', fontSize: 12.5, fontWeight: 600 }}>
            <ThunderboltFilled style={{ color: '#FDE68A' }} /> Wawasan & saran untuk pimpinan
          </div>
          <h2 style={{ margin: '12px 0 4px', color: '#fff', fontSize: 'clamp(22px, 3.2vw, 30px)', lineHeight: 1.15, fontWeight: 800, letterSpacing: -0.4 }}>
            {s.warnings === 0 && data.insights.length > 0 && <CheckCircleFilled style={{ color: '#7CF2C1', marginRight: 8 }} />}
            {s.warnings > 0 && <WarningFilled style={{ color: '#FDBA74', marginRight: 8 }} />}
            {s.headline}
          </h2>
          <div style={{ fontSize: 13.5, opacity: 0.85 }}>{s.sub}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {pills.map((p) => (
              <button
                key={p.key}
                type="button"
                className="ins-pill"
                onClick={() => setFilter(filter === p.key ? 'all' : p.key)}
                aria-pressed={filter === p.key}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 12, background: filter === p.key ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)', color: '#fff', fontSize: 13 }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 99, background: p.dot }} />
                <b style={{ fontSize: 17, lineHeight: 1 }}>{p.n}</b> {p.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>Saran bersifat masukan untuk dipertimbangkan, bukan keharusan. Dihitung dari pembukuan per {data.asOf.split('-').reverse().join('/')}.</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 16, padding: '10px 12px 4px', minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9, marginBottom: 2 }}>Penjualan & laba kotor, 6 bulan</div>
          {hasSales ? <Spark data={data.trend} /> : <div style={{ padding: '28px 8px', fontSize: 13, opacity: 0.8 }}>Grafik muncul setelah ada penjualan.</div>}
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .ins-hero { grid-template-columns: minmax(0,1fr) !important; padding: 18px !important; } }`}</style>

      {data.insights.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '16px 2px 10px' }}>
            {([['all', 'Semua'], ['warning', 'Perlu perhatian'], ['opportunity', 'Peluang'], ['good', 'Kabar baik'], ['info', 'Catatan']] as const)
              .filter(([k]) => k === 'all' || data.insights.some((x) => x.tone === k))
              .map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  aria-pressed={filter === k}
                  style={{ border: '1px solid ' + (filter === k ? '#1C3160' : '#D0D5DD'), background: filter === k ? '#1C3160' : '#fff', color: filter === k ? '#fff' : '#344054', padding: '5px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {label}
                </button>
              ))}
            {hiddenCount > 0 && (
              <Button type="link" size="small" style={{ marginLeft: 'auto' }} onClick={showAll}>
                Tampilkan {hiddenCount} saran yang disembunyikan
              </Button>
            )}
          </div>
          {visible.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
              {visible.map((i, idx) => (
                <InsightCard key={i.id} i={i} index={idx} onHide={() => hide(i.id)} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#667085', padding: 24, background: '#fff', borderRadius: 16, border: '1px dashed #D0D5DD' }}>Tidak ada saran pada pilihan ini.</div>
          )}
        </>
      )}
    </section>
  );
}
