import { BRAND } from '@sansu/shared';

/**
 * Tanda SANSU (logo resmi): "S" dari potongan bersudut dengan garis diagonal hijau.
 * Digambar sebagai vektor supaya tajam di semua ukuran. Separuh bentuk diputar 180°
 * untuk membentuk separuh lainnya (logo simetris).
 */
const VIEWBOX = '8 8 329 373';
const MARK_RATIO = 329 / 373;
const HALF = [
  // C atas (dalam)
  'M166.6 8.4H96.5L59.6 42.2V163L109.8 205L140.2 176.2L100.1 142.2V58.9H166.6Z',
  // sisi kiri luar
  'M48.5 52L8.8 87.8V187.8L73.8 240.5L102.5 212.2L48.5 167.2Z',
  // ujung kanan atas
  'M178.4 8.4V58H244.5V106.2L278.8 139L334.5 87.8L249.5 8.4Z',
];
const STRIPE = 'M206.2 141H247.8L137.5 248H97.2Z';
const GREEN = ['M194 142.4H204.5L95.5 248.4H84.2Z', 'M250.2 142.1H262L150.2 248.1H139Z'];

export function LogoMark({ size = 32, tone = 'dark' }: { size?: number; tone?: 'dark' | 'light' }) {
  const ink = tone === 'light' ? '#FFFFFF' : BRAND.colors.mark;
  return (
    <svg
      viewBox={VIEWBOX}
      width={Math.round(size * MARK_RATIO)}
      height={size}
      role="img"
      aria-label={BRAND.name}
      style={{ display: 'block', flex: 'none' }}
    >
      <g fill={ink}>
        {HALF.map((d) => (
          <path key={d} d={d} />
        ))}
        <g transform="rotate(180 172.4 194.2)">
          {HALF.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path d={STRIPE} />
      </g>
      <g fill={BRAND.colors.accent}>
        {GREEN.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Logo lengkap: tanda + nama. `tone="light"` untuk latar gelap. */
export default function Logo({ size = 32, tone = 'dark', showName = true }: { size?: number; tone?: 'dark' | 'light'; showName?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.32) }}>
      <LogoMark size={size} tone={tone} />
      {showName && (
        <span
          style={{
            fontWeight: 700,
            fontSize: size * 0.66,
            letterSpacing: '0.08em',
            color: tone === 'light' ? '#fff' : BRAND.colors.mark,
            lineHeight: 1,
          }}
        >
          {BRAND.name}
        </span>
      )}
    </span>
  );
}
