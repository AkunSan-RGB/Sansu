import { Alert, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import DataSecurityTab from './DataSecurityTab';
import { useBillingEnabled } from './platform-admin/shared';
import { OverviewTab } from './platform-admin/OverviewTab';
import { PulseTab } from './platform-admin/PulseTab';
import { TenantsTab } from './platform-admin/TenantsTab';
import { PaymentsTab } from './platform-admin/PaymentsTab';
import { PlansTab } from './platform-admin/PlansTab';
import { VatTab } from './platform-admin/VatTab';
import { SystemTab } from './platform-admin/SystemTab';
import { SettingsTab } from './platform-admin/SettingsTab';

export default function PlatformAdminPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const billing = useBillingEnabled();
  if (!me?.isPlatformAdmin) return <Alert type="error" showIcon message="Khusus pemilik layanan SANSU" />;
  // Pembayaran, paket, dan PPN hanya relevan bila langganan dinyalakan (tahap uji: dimatikan)
  const items = [
    { key: 'overview', label: 'Ringkasan', children: <OverviewTab /> },
    { key: 'pulse', label: 'Pantauan uji', children: <PulseTab /> },
    { key: 'tenants', label: 'Perusahaan', children: <TenantsTab /> },
    ...(billing
      ? [
          { key: 'payments', label: 'Pembayaran', children: <PaymentsTab /> },
          { key: 'plans', label: 'Paket', children: <PlansTab /> },
          { key: 'vat', label: 'Laporan PPN', children: <VatTab /> },
        ]
      : []),
    { key: 'data', label: 'Keamanan data', children: <DataSecurityTab /> },
    { key: 'system', label: 'Sistem', children: <SystemTab /> },
    { key: 'settings', label: 'Pengaturan', children: <SettingsTab /> },
  ];
  return (
    <>
      <PageHeader title="Panel SANSU — pemilik layanan" />
      <Tabs activeKey={items.some((i) => i.key === tab) ? tab : 'overview'} onChange={(t) => setParams({ tab: t }, { replace: true })} items={items} />
    </>
  );
}
