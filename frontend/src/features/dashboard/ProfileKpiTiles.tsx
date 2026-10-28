import { type KpiDef, type ServiceProfile, SERVICE_PROFILE_PACKS, soleProfile } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { fmtMoney } from '@/lib/format';
import KpiTiles from './KpiTiles';

interface Tile extends KpiDef {
  profile: ServiceProfile;
  value: number | string | null;
}

const show = (t: Tile): string => {
  if (t.value === null || t.value === undefined) return '-';
  switch (t.format) {
    case 'money': return fmtMoney(t.value).replace(/,\d+$/, '');
    case 'percent': return `${Number(t.value).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    case 'number': return Number(t.value).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    default: return String(t.value);
  }
};

/** Ubin angka khas profil layanan Jasa (kontraktor: retensi & kontrak; pendidikan: SPP & tunggakan; dst.) */
export default function ProfileKpiTiles() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const on = me?.businessModel === 'JASA' && !me.branchIds?.length;
  const q = useQuery({ queryKey: ['dashboard', 'profile-kpis'], queryFn: () => get<{ tiles: Tile[] }>('/dashboard/profile-kpis'), enabled: on });
  if (!on || !q.data?.tiles.length) return null;
  const sole = soleProfile(me?.serviceProfiles);
  const byProfile = new Map<ServiceProfile, Tile[]>();
  for (const t of q.data.tiles) byProfile.set(t.profile, [...(byProfile.get(t.profile) ?? []), t]);
  return (
    <section aria-label="Angka khas layanan" style={{ marginTop: 16 }}>
      {[...byProfile].map(([p, tiles]) => (
        <div key={p} style={{ marginBottom: 8 }}>
          <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
            {sole ? 'Angka khas usaha Anda' : SERVICE_PROFILE_PACKS[p].workspace.title}
          </Typography.Title>
          <KpiTiles
            items={tiles.map((t) => ({
              label: t.label,
              value: show(t),
              hint: t.hint,
              tone: t.key.endsWith('arrears') || t.key.endsWith('overdue') || t.key.endsWith('retention_held') ? (Number(t.value) > 0 ? 'warn' : 'good') : 'neutral',
              onClick: t.to ? () => navigate(t.to!) : undefined,
            }))}
          />
        </div>
      ))}
    </section>
  );
}
