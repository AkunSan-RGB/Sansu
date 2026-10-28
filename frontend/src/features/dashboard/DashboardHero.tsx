import { DatabaseOutlined, FileDoneOutlined, FundOutlined, ShopOutlined } from '@ant-design/icons';
import { type BusinessModel, type ServiceProfile, workspaceForTenant } from '@sansu/shared';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoMark } from '@/brand/Logo';
import { t } from '@/lib/terms';

export interface HeroFigure {
  label: string;
  value: ReactNode;
  onClick?: () => void;
}
interface Props {
  name?: string;
  tenantName?: string;
  model: BusinessModel;
  profiles?: ServiceProfile[];
  figures: HeroFigure[];
  showFinance: boolean;
  canSell: boolean;
  /** Jasa: aksi cepat khas profil layanan (menggantikan pintasan umum) */
  actions?: { label: string; to: string }[];
}

const greet = () => {
  const h = dayjs().hour();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
};

/** Kepala dasbor: sapaan, jenis usaha, pintasan kerja, dan tiga angka utama dalam satu panel hitam */
export default function DashboardHero({ name, tenantName, model, profiles, figures, showFinance, canSell, actions }: Props) {
  const navigate = useNavigate();
  const quick = [
    { label: 'Faktur penjualan', to: '/invoices', icon: <FileDoneOutlined />, on: showFinance || canSell },
    { label: t('Pelanggan'), to: '/customers', icon: <ShopOutlined />, on: true },
    { label: 'Produk & stok', to: '/products', icon: <DatabaseOutlined />, on: true },
    { label: 'Laporan', to: '/reports', icon: <FundOutlined />, on: showFinance },
  ].filter((q) => q.on);
  const shortcuts = actions?.length ? actions.slice(0, 4).map((a) => ({ label: a.label, to: a.to, icon: <FileDoneOutlined /> })) : quick;
  return (
    <section className="db-hero">
      <span className="db-hero-mark" aria-hidden>
        <LogoMark size={220} tone="light" />
      </span>
      <div className="db-hero-main">
        <span className="db-chip">{workspaceForTenant(model, profiles).title}</span>
        <h1>
          {greet()}, {name?.split(' ')[0] ?? 'Anda'}
        </h1>
        <p>
          {tenantName} · {dayjs().format('dddd, D MMMM YYYY')}
        </p>
        <div className="db-quick">
          {shortcuts.map((q) => (
            <button key={q.to} type="button" onClick={() => navigate(q.to)}>
              {q.icon}
              {q.label}
            </button>
          ))}
        </div>
      </div>
      {figures.length > 0 && (
        <div className="db-figures">
          {figures.map((f) => (
            <button key={f.label} type="button" onClick={f.onClick} disabled={!f.onClick}>
              <span>{f.label}</span>
              <b>{f.value}</b>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
