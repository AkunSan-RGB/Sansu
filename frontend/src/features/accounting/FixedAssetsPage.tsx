import { Tabs } from 'antd';
import PageHeader from '@/layout/PageHeader';
import { useSearchParams } from 'react-router-dom';
import { AssetList } from './fixed-assets/AssetList';
import { DepreciationTab } from './fixed-assets/DepreciationTab';
import { CategoriesTab } from './fixed-assets/CategoriesTab';

export default function FixedAssetsPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Aset Tetap & Penyusutan" />
      <Tabs
        defaultActiveKey={params.get('tab') === 'depreciation' ? 'dep' : 'list'}
        items={[
          { key: 'list', label: 'Daftar aset', children: <AssetList /> },
          { key: 'dep', label: 'Penyusutan', children: <DepreciationTab /> },
          { key: 'cat', label: 'Kategori', children: <CategoriesTab /> },
        ]}
      />
    </>
  );
}
