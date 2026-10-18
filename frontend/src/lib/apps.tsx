import {
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  BookOutlined,
  DollarOutlined,
  ExperimentOutlined,
  FundProjectionScreenOutlined,
  InboxOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  WalletOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { APP_BY_KEY, type AppKey, canUseApp } from '@sansu/shared';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';

export const APP_ICONS: Record<AppKey | 'dashboard' | 'settings' | 'apps' | 'tax' | 'production', ReactNode> = {
  sales: <ShoppingCartOutlined />,
  purchase: <ShopOutlined />,
  inventory: <InboxOutlined />,
  accounting: <BookOutlined />,
  cash: <WalletOutlined />,
  pos: <DollarOutlined />,
  crm: <FundProjectionScreenOutlined />,
  hr: <TeamOutlined />,
  payroll: <BankOutlined />,
  utility: <ThunderboltOutlined />,
  dashboard: <BarChartOutlined />,
  settings: <SettingOutlined />,
  apps: <AppstoreOutlined />,
  tax: <AuditOutlined />,
  production: <ExperimentOutlined />,
};

/** Aplikasi yang aktif di perusahaan DAN boleh dibuka peran pengguna */
export function useApps() {
  const { me } = useAuth();
  const enabled = new Set<AppKey>(me?.apps ?? []);
  const can = (app: AppKey) => !!me && enabled.has(app) && canUseApp(me.role, app);
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  return { enabled, can, isAdmin, info: APP_BY_KEY };
}
