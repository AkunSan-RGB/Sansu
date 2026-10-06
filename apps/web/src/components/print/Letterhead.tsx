import { useQuery } from '@tanstack/react-query';
import { BRAND, localize } from '@sansu/shared';
import type { CSSProperties, ReactNode } from 'react';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

export interface LetterheadData {
  name: string;
  address: string | null;
  npwp: string | null;
  logo: string | null;
  phone: string;
  email: string;
  bankInfo: string;
  invoiceNote: string;
}

/** Kop surat perusahaan (dipakai semua dokumen cetak) */
export const useLetterhead = () =>
  useQuery({ queryKey: ['letterhead'], queryFn: () => get<LetterheadData>('/settings/letterhead'), staleTime: 5 * 60_000 });

const C = BRAND.colors.primary;
export const cell: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' };
export const head: CSSProperties = { padding: '6px 8px', borderBottom: `2px solid ${C}`, background: '#f3f5f9', textAlign: 'left', fontWeight: 600 };

/** Kepala dokumen: logo + identitas perusahaan di kiri, judul & nomor dokumen di kanan */
export function DocHeader({ title, meta }: { title: string; meta: [string, ReactNode][] }) {
  const { data: c } = useLetterhead();
  const { me } = useAuth();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderBottom: `3px solid ${C}`, paddingBottom: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0, flex: '1 1 300px', flexWrap: 'wrap' }}>
        {c?.logo && <img src={c.logo} alt="" style={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain' }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{c?.name}</div>
          <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'pre-line' }}>
            {[c?.address, [c?.phone && `Telp. ${c.phone}`, c?.email].filter(Boolean).join(' · '), c?.npwp && `NPWP ${c.npwp}`].filter(Boolean).join('\n')}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C, letterSpacing: 0.5 }}>{localize(title, me?.businessModel)}</div>
        <table style={{ marginLeft: 'auto', fontSize: 13 }}>
          <tbody>
            {meta.map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: '#64748b', paddingRight: 8, textAlign: 'right' }}>{k}</td>
                <td style={{ fontWeight: 600, textAlign: 'right' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Blok pihak tujuan (Kepada Yth.) */
export function PartyBlock({ label, name, lines }: { label: string; name: string; lines: (string | null | undefined | false)[] }) {
  return (
    <div style={{ marginBottom: 16, fontSize: 13 }}>
      <div style={{ color: '#64748b' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} style={{ whiteSpace: 'pre-line' }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** Kolom tanda tangan */
export function Signatures({ labels }: { labels: [string, string?][] }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 40, flexWrap: 'wrap', fontSize: 13, breakInside: 'avoid' }}>
      {labels.map(([top, bottom]) => (
        <div key={top} style={{ textAlign: 'center', minWidth: 160, flex: 1 }}>
          {top}
          <div style={{ height: 64 }} />
          <div style={{ borderTop: '1px solid #333', paddingTop: 2 }}>{bottom ?? '(..............................)'}</div>
        </div>
      ))}
    </div>
  );
}

/** Pembungkus dokumen yang tercetak (hanya elemen ini yang ikut dicetak) */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    // di layar sempit dokumen bisa digeser ke samping; saat dicetak memakai lebar kertas penuh
    <div style={{ overflowX: 'auto' }}>
      <div className="print-doc" style={{ maxWidth: 840, minWidth: 560, margin: '0 auto', background: '#fff', color: '#0f172a' }}>
        {children}
      </div>
    </div>
  );
}
