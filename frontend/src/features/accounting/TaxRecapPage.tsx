import { Tabs } from 'antd';
import { Navigate, useSearchParams } from 'react-router-dom';
import PageHeader from '@/layout/PageHeader';
import { Annual } from './tax-recap/Annual';
import { Withholding } from './tax-recap/Withholding';

/** Rekap pajak: tahunan per masa dan PPh 23/4(2) dipotong. Iuran BPJS ada di halaman Rekap BPJS sendiri. */
export default function TaxRecapPage() {
  const [params, setParams] = useSearchParams();
  // tautan lama ?tab=bpjs dialihkan ke halaman Rekap BPJS
  const tab = params.get('tab') ?? 'annual';
  if (tab === 'bpjs') return <Navigate to="/payroll/bpjs" replace />;
  return (
    <>
      <PageHeader title="Rekap pajak" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'annual', label: 'Rekap tahunan', children: <Annual /> },
          { key: 'withholding', label: 'PPh 23 & 4(2) dipotong', children: <Withholding /> },
        ]}
      />
    </>
  );
}
