import { Input, Select, Typography } from 'antd';
import { useState } from 'react';

const NEW = '__baru__';

interface Props {
  value?: string | null;
  onChange?: (v: string | undefined) => void;
  /** Kategori yang sudah dipakai (dari data produk perusahaan) */
  options: string[];
}

/**
 * Pilih kategori yang sudah ada, atau ketik sendiri bila tidak ada yang cocok. Ketikan yang sama dengan kategori lama
 * (huruf besar/kecil diabaikan) otomatis memakai ejaan kategori lama agar data tidak terpecah (server juga menyamakan).
 */
export default function CategoryField({ value, onChange, options }: Props) {
  const list = [...new Set(options.map((o) => o.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const found = list.find((o) => o.toLowerCase() === (value ?? '').trim().toLowerCase());
  const [typing, setTyping] = useState(false);
  const manual = typing || (!!value && !found) || list.length === 0;
  const match = manual ? list.find((o) => o.toLowerCase() === (value ?? '').trim().toLowerCase()) : undefined;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {list.length > 0 && (
        <Select
          allowClear
          showSearch
          placeholder="Pilih kategori (kosongkan bila tidak ada)"
          value={manual ? NEW : found}
          options={[...list.map((o) => ({ value: o, label: o })), { value: NEW, label: '＋ Kategori lain (ketik sendiri)…' }]}
          onChange={(v) => {
            if (v === NEW) {
              setTyping(true);
              onChange?.(undefined);
            } else {
              setTyping(false);
              onChange?.(v);
            }
          }}
          onClear={() => {
            setTyping(false);
            onChange?.(undefined);
          }}
        />
      )}
      {manual && (
        <>
          <Input
            autoFocus={list.length > 0}
            maxLength={60}
            placeholder="Ketik nama kategori"
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value || undefined)}
            onBlur={(e) => {
              const v = e.target.value.replace(/\s+/g, ' ').trim();
              const same = list.find((o) => o.toLowerCase() === v.toLowerCase());
              onChange?.(same ?? (v || undefined));
              if (same) setTyping(false);
            }}
          />
          {match && match !== (value ?? '').trim() && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Sudah ada kategori "{match}"; akan dipakai itu.
            </Typography.Text>
          )}
        </>
      )}
    </div>
  );
}
