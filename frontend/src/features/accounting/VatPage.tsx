import { useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { VatReport } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import ReportShell from './ledger/ReportShell';
import { usePeriod } from './ledger/usePeriod';
import { VatView } from './statements/views';
import { vatSheets } from '@/lib/xlsx/reports';

/** Rekap PPN keluaran & masukan per dokumen — tab PPN di halaman Rekap pajak; terhubung ke Setoran Pajak dan ekspor Coretax */
export function VatRecap() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = usePeriod();
  const vat = useQuery({ queryKey: ['reports', 'vat', from, to], queryFn: () => get<VatReport>(`/accounting/reports/vat${qs({ from, to })}`) });
  return (
    <ReportShell
      title="Rekap PPN"
      embedded
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      controls={
        <>
          <Button size="small" onClick={() => navigate(`/tax?period=${to.slice(0, 7)}`)}>
            Setor / kompensasi PPN masa ini
          </Button>
          <Button size="small" onClick={() => navigate('/integrations?tab=coretax')}>
            Ekspor faktur ke Coretax
          </Button>
        </>
      }
      sheets={() => (vat.data ? vatSheets(vat.data, from, to, me?.tenantName) : null)}
    >
      <QueryState q={vat}>{(d) => <VatView d={d} />}</QueryState>
    </ReportShell>
  );
}
