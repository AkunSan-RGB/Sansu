import { CASH_DENOMINATIONS, type CashDenominationKey } from '@sansu/shared';
import { InputNumber, Typography } from 'antd';
import { fmtMoney } from '@/lib/format';

export type Denoms = Partial<Record<CashDenominationKey, number>>;

/** Total uang dari jumlah lembar/keping per pecahan */
export const denomTotal = (d: Denoms) => CASH_DENOMINATIONS.reduce((s, x) => s + x.value * (d[x.key] ?? 0), 0);

/** Isian hitung uang per pecahan (kertas & logam) dengan subtotal otomatis */
export default function DenominationCounter({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: Denoms;
  onChange?: (v: Denoms) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const groups = ['Kertas', 'Logam'] as const;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: compact ? 8 : 16,
      }}
    >
      {groups.map((g) => (
        <div key={g}>
          <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Uang {g.toLowerCase()}
          </Typography.Text>
          {CASH_DENOMINATIONS.filter((d) => d.kind === g).map((d) => {
            const n = value[d.key] ?? 0;
            return (
              <div
                key={d.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px 1fr 120px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderBottom: '1px dashed #eef1f5',
                }}
              >
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.value.toLocaleString('id-ID')}</strong>
                <InputNumber
                  size="small"
                  min={0}
                  precision={0}
                  value={n || null}
                  placeholder="0"
                  disabled={disabled}
                  suffix={
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>{g === 'Kertas' ? 'lembar' : 'keping'}</span>
                  }
                  onChange={(v) => onChange?.({ ...value, [d.key]: Number(v ?? 0) })}
                  style={{ width: '100%' }}
                  aria-label={`Jumlah ${g.toLowerCase()} ${d.value}`}
                />
                <span
                  style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: n ? undefined : '#94a3b8' }}
                >
                  {fmtMoney(d.value * n)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
