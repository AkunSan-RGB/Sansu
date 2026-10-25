import { useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import PageHeader from '@/layout/PageHeader';
import { JournalList } from './journals/JournalList';
import { RecurringList } from './journals/RecurringList';

export default function JournalsPage() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Jurnal Umum" />
      <Tabs
        activeKey={params.get('tab') === 'recurring' ? 'recurring' : 'list'}
        onChange={(k) => setParams(k === 'list' ? {} : { tab: k }, { replace: true })}
        items={[
          { key: 'list', label: 'Jurnal', children: <JournalList /> },
          { key: 'recurring', label: 'Jurnal berulang', children: <RecurringList /> },
        ]}
      />
    </>
  );
}
