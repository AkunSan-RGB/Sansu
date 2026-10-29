import { taxRecapTabs, type TaxRecapTabDef, type TaxRecapTabKey } from '@sansu/shared';
import { Tabs, Typography } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { useApps } from '@/lib/apps';
import { Pph21Recap } from '../payroll/Pph21ReportPage';
import { WithheldRecap } from '../services/WithheldPage';
import { VatRecap } from './VatPage';
import { Annual } from './tax-recap/Annual';
import { BpjsReport } from './tax-recap/BpjsReport';
import { Withholding } from './tax-recap/Withholding';

const CONTENT: Record<TaxRecapTabKey, (tabs: TaxRecapTabDef[]) => ReactNode> = {
  annual: (tabs) => <Annual tabs={tabs} />,
  vat: () => <VatRecap />,
  pph21: () => <Pph21Recap embedded />,
  bpjs: () => <BpjsReport />,
  withholding: () => <Withholding />,
  withheld: () => <WithheldRecap embedded />,
};

/**
 * Rekap pajak: semua rekap pajak dalam satu halaman, per tab. Tab yang tampil mengikuti jenis usaha, status PKP, dan aplikasi yang boleh dibuka
 * (lihat taxRecapTabs di @sansu/shared). Alamat lama (/vat, /payroll/pph21, /payroll/bpjs, /tax/withheld) dialihkan ke tab yang sesuai.
 */
export default function TaxRecapPage() {
  const { me } = useAuth();
  const { can } = useApps();
  const canPayroll = can('payroll');
  const canSales = can('sales');
  const [params, setParams] = useSearchParams();
  const tabs = useMemo(
    () =>
      taxRecapTabs({
        model: me?.businessModel ?? 'DAGANG',
        serviceProfiles: me?.serviceProfiles,
        taxFeatures: me?.taxFeatures,
        canPayroll,
        canSales,
      }),
    [me?.businessModel, me?.serviceProfiles, me?.taxFeatures, canPayroll, canSales],
  );
  // tab yang tidak berlaku untuk perusahaan ini (mis. PPN untuk non-PKP) jatuh ke tab pertama
  const wanted = params.get('tab');
  const active = tabs.find((x) => x.key === wanted)?.key ?? tabs[0].key;
  return (
    <>
      <PageHeader title="Rekap pajak" />
      <Tabs
        activeKey={active}
        onChange={(k) => setParams({ tab: k }, { replace: true })}
        items={tabs.map((x) => ({
          key: x.key,
          label: x.label,
          children: (
            <>
              <Typography.Paragraph type="secondary" className="no-print">
                {x.hint}
              </Typography.Paragraph>
              {CONTENT[x.key](tabs)}
            </>
          ),
        }))}
      />
    </>
  );
}
