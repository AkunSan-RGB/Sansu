import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import { pathVisible, type VisibilityCtx } from '@/layout/menuData';

/** Konteks keterlihatan menu untuk pengguna yang sedang masuk (peran, jenis usaha, profil layanan, aplikasi, fitur pajak) */
export function useVisibilityCtx(): VisibilityCtx | null {
  const { me } = useAuth();
  const { can } = useApps();
  if (!me) return null;
  return {
    role: me.role,
    model: me.businessModel,
    framework: me.framework,
    multiBranch: me.multiBranch,
    hasBudget: me.hasBudget,
    subscriptionEnabled: me.subscription?.enabled,
    taxFeatures: me.taxFeatures as unknown as VisibilityCtx['taxFeatures'],
    profiles: me.serviceProfiles,
    can,
  };
}

/** Halaman tanpa item menu sendiri yang dibuka dari halaman induknya (mis. tagihan jasa baru dari Faktur & piutang) */
const VIA_PARENT: Record<string, string> = { '/invoices/services/new': '/invoices' };

/** Tautan hanya ditampilkan bila halamannya (atau halaman induknya) ada di menu pengguna ini */
export const visibleLinks = <T extends { to: string }>(links: T[], ctx: VisibilityCtx | null): T[] =>
  ctx ? links.filter((l) => pathVisible(VIA_PARENT[l.to] ?? l.to, ctx)) : [];
