import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { AssetList } from './AssetList';
import { CategoriesTab } from './CategoriesTab';
import { DepreciationTab } from './DepreciationTab';

/** Kelola aset tetap (daftar, penyusutan, kategori): bagian dari menu Rincian & perhitungan akun */
export default function FixedAssetsManager() {
  const [params] = useSearchParams();
  return (
    <Tabs
      defaultActiveKey={params.get('tab') === 'depreciation' ? 'dep' : 'list'}
      items={[
        { key: 'list', label: 'Daftar aset', children: <AssetList /> },
        { key: 'dep', label: 'Penyusutan', children: <DepreciationTab /> },
        { key: 'cat', label: 'Kategori', children: <CategoriesTab /> },
      ]}
    />
  );
}
