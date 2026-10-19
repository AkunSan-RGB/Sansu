import { Button, Card, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

/**
 * Kartu kebijakan seragam: ikon + judul + penjelasan singkat di kepala, isian di tengah, tombol simpan di kaki.
 * Dipakai di tab Kebijakan akuntansi agar semua kelompok terlihat dan bekerja dengan cara yang sama.
 */
export default function PolicyCard({
  id,
  icon,
  title,
  desc,
  tag,
  footer,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  desc?: ReactNode;
  tag?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} style={{ scrollMarginTop: 80 }} styles={{ body: { padding: 0 } }}>
      <div style={{ padding: '18px 24px 4px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--ant-color-primary-bg, #eef2fb)', color: 'var(--ant-color-primary, #1b2a5b)', display: 'grid', placeItems: 'center', fontSize: 18, flex: 'none' }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space align="center" wrap size={8}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            {tag}
          </Space>
          {desc && (
            <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0' }}>
              {desc}
            </Typography.Paragraph>
          )}
        </div>
      </div>
      <div style={{ padding: '16px 24px 20px' }}>{children}</div>
      {footer && (
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--ant-color-border-secondary, #eceff4)', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', background: 'var(--ant-color-fill-quaternary, #fafbfc)', borderRadius: '0 0 12px 12px' }}>{footer}</div>
      )}
    </Card>
  );
}

/** Pilihan berbentuk kartu (lebih mudah dipahami daripada tombol radio kecil) */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value?: T;
  onChange?: (v: T) => void;
  options: { value: T; title: string; audience?: string; desc: string; badge?: ReactNode }[];
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(o.value)}
            aria-pressed={on}
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'stretch',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '12px 14px',
              borderRadius: 10,
              border: `${on ? 2 : 1}px solid ${on ? 'var(--ant-color-primary, #1b2a5b)' : 'var(--ant-color-border, #d9dde6)'}`,
              background: on ? 'var(--ant-color-primary-bg, #eef2fb)' : 'var(--ant-color-bg-container, #fff)',
              font: 'inherit',
              color: 'inherit',
              opacity: disabled ? 0.7 : 1,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
              <span aria-hidden style={{ width: 16, height: 16, borderRadius: '50%', border: `${on ? 5 : 1}px solid ${on ? 'var(--ant-color-primary, #1b2a5b)' : '#b8c0cf'}`, flex: 'none', boxSizing: 'border-box' }} />
              {o.title}
              {o.badge}
            </div>
            {o.audience && <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{o.audience}</div>}
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>{o.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Satu baris pengaturan: nama + penjelasan di kiri, kontrol (saklar / angka) di kanan.
 * Di layar sempit kontrol pindah ke bawah. Kontrol dibungkus <Form.Item noStyle name="...">.
 */
export function SettingRow({ label, desc, children, dim }: { label: ReactNode; desc?: ReactNode; children: ReactNode; dim?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        borderBottom: '1px solid var(--ant-color-border-secondary, #eceff4)',
        opacity: dim ? 0.55 : 1,
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flex: '0 0 220px', maxWidth: '100%' }}>{children}</div>
    </div>
  );
}

/** Batang simpan melayang di bawah layar untuk form panjang yang terdiri dari beberapa kartu */
export function StickySave({ loading, label = 'Simpan perubahan', note }: { loading: boolean; label?: string; note?: ReactNode }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 12,
        zIndex: 5,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        padding: '10px 16px',
        borderRadius: 12,
        background: 'rgba(255,255,255,.94)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--ant-color-border-secondary, #eceff4)',
        boxShadow: '0 4px 16px rgba(20,30,60,.08)',
      }}
    >
      {note && <span style={{ opacity: 0.7 }}>{note}</span>}
      <Button type="primary" htmlType="submit" loading={loading}>
        {label}
      </Button>
    </div>
  );
}
