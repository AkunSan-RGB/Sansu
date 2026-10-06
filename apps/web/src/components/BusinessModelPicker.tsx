import { CheckCircleFilled } from '@ant-design/icons';
import { BRAND, BUSINESS_MODELS, type BusinessModel } from '@sansu/shared';
import { Tag, Typography } from 'antd';

/** Pilihan model bisnis (kartu 2×2) — dipakai saat mendaftar dan di Pengaturan › Perusahaan */
export default function BusinessModelPicker({
  value,
  onChange,
  detailed,
}: {
  value?: BusinessModel;
  onChange?: (v: BusinessModel) => void;
  detailed?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Model bisnis"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
    >
      {BUSINESS_MODELS.map((m) => {
        const on = value === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange?.(m.key)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              boxSizing: 'border-box',
              padding: detailed ? '12px 14px' : '10px 12px',
              borderRadius: 10,
              border: `1.5px solid ${on ? BRAND.colors.primary : '#e3e8f0'}`,
              background: on ? BRAND.colors.primarySoft : '#fff',
              position: 'relative',
              minWidth: 0,
            }}
          >
            {on && (
              <CheckCircleFilled style={{ position: 'absolute', top: 8, right: 8, color: BRAND.colors.primary }} />
            )}
            <div style={{ fontWeight: 700, color: BRAND.colors.ink, paddingRight: 18 }}>{m.name}</div>
            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.4, marginTop: 2 }}>{m.summary}</div>
            {detailed && (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 6 }}>
                Contoh: {m.examples}
              </Typography.Text>
            )}
            {!m.ready && (
              <Tag color="gold" style={{ marginTop: 6, fontSize: 10, lineHeight: '16px' }}>
                Fitur khusus menyusul
              </Tag>
            )}
          </button>
        );
      })}
    </div>
  );
}
