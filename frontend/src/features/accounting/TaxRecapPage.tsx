import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '@/layout/PageHeader';
import { useApps } from '@/lib/apps';
import { Annual } from './tax-recap/Annual';
import { Withholding } from './tax-recap/Withholding';
import { BpjsReport } from './tax-recap/BpjsReport';

/** Rekap pajak & BPJS: tahunan per masa, PPh 23/4(2) dipotong, dan iuran BPJS */
export default function TaxRecapPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useApps();
  const tab = params.get('tab') ?? 'annual';
  return (
    <>
      <PageHeader title="Rekap pajak & BPJS" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'annual', label: 'Rekap tahunan', children: <Annual /> },
          { key: 'withholding', label: 'PPh 23 & 4(2) dipotong', children: <Withholding /> },
          ...(can('payroll') ? [{ key: 'bpjs', label: 'Iuran BPJS', children: <BpjsReport /> }] : []),
        ]}
      />
    </>
  );
}
