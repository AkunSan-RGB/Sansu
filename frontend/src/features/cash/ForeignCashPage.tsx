import PageHeader from '@/layout/PageHeader';
import CashTabs from './CashTabs';
import ForeignAccountsTab from './ForeignAccountsTab';
import FxPanel from './FxPanel';

/** Valas & kurs: rekening bank valas, kurs harian, posisi valas dan penilaian ulang (satu rumah di Kas & Bank) */
export default function ForeignCashPage() {
  return (
    <>
      <PageHeader title="Kas & Bank" />
      <CashTabs />
      <FxPanel lead={[{ key: 'accounts', label: 'Rekening valas', children: <ForeignAccountsTab /> }]} />
    </>
  );
}
