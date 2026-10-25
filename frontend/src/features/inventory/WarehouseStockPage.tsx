import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '@/layout/PageHeader';
import InventoryMethodBadge from './InventoryMethodBadge';
import { t } from '@/lib/terms';
import { MatrixTab } from './warehouse-stock/MatrixTab';
import { LowTab } from './warehouse-stock/LowTab';
import { MinTab } from './warehouse-stock/MinTab';

/** Rekap stok semua gudang, stok menipis, dan pengaturan stok minimum */
export default function WarehouseStockPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'matrix';
  return (
    <>
      <PageHeader title={t('Persediaan per gudang')} extra={<InventoryMethodBadge />} />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'matrix', label: t('Rekap semua gudang'), children: <MatrixTab /> },
          { key: 'low', label: 'Persediaan menipis', children: <LowTab /> },
          { key: 'min', label: 'Persediaan minimum', children: <MinTab /> },
        ]}
      />
    </>
  );
}
