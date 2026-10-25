import { canHandleMoney } from '@sansu/shared';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import MarketplaceSyncTab from './MarketplaceSyncTab';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/lib/terms';
import { MarketplaceTab } from './integrations/MarketplaceTab';
import { CoretaxTab } from './integrations/CoretaxTab';

export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = ['coretax', 'sync'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'marketplace';
  const { can } = useApps();
  const { me } = useAuth();
  const isFinance = canHandleMoney(me?.role);
  return (
    <>
      <PageHeader title="Integrasi: Marketplace & Coretax" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'marketplace', label: 'Pesanan marketplace', children: <MarketplaceTab /> },
          ...(isFinance ? [{ key: 'sync', label: 'Sinkron otomatis', children: <MarketplaceSyncTab /> }] : []),
          ...(can('accounting') ? [{ key: 'coretax', label: t('e-Faktur Coretax'), children: <CoretaxTab /> }] : []),
        ]}
      />
    </>
  );
}
