import type { ReactNode } from 'react';

export type KpiTone = 'neutral' | 'good' | 'bad' | 'warn';
export interface KpiTile {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: KpiTone;
  icon?: ReactNode;
  onClick?: () => void;
}

/** Deretan kartu angka: garis aksen warna sesuai nilainya, ikon, dan angka besar yang tabular */
export default function KpiTiles({ items }: { items: KpiTile[] }) {
  if (!items.length) return null;
  return (
    <div className="db-kpis">
      {items.map((k) => {
        const Tag = k.onClick ? 'button' : 'div';
        return (
          <Tag key={k.label} className={`db-kpi tone-${k.tone ?? 'neutral'}${k.onClick ? ' clickable' : ''}`} {...(k.onClick ? { type: 'button' as const, onClick: k.onClick } : {})}>
            <span className="db-kpi-top">
              <span className="db-kpi-label">{k.label}</span>
              {k.icon && <span className="db-kpi-icon">{k.icon}</span>}
            </span>
            <b className="db-kpi-value">{k.value}</b>
            {k.hint && <span className="db-kpi-hint">{k.hint}</span>}
          </Tag>
        );
      })}
    </div>
  );
}
