import { useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { Worksheet } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import ReportShell from './ledger/ReportShell';
import { usePeriod } from './ledger/usePeriod';
import { WorksheetView } from './statements/views';
import { worksheetSheet } from '@/lib/xlsx/reports';

/** Neraca lajur: neraca saldo → jurnal penyesuaian → NS disesuaikan → laba rugi & posisi keuangan */
export default function WorksheetPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { from, to, setFrom, setTo, query } = usePeriod();
  const ws = useQuery({ queryKey: ['statements', 'worksheet', from, to], queryFn: () => get<Worksheet>(`/accounting/statements/worksheet${qs({ from, to })}`) });
  return (
    <ReportShell
      title="Neraca Lajur"
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      hint="Satu tabel dari neraca saldo, penyesuaian, sampai laba rugi dan posisi keuangan."
      controls={
        <>
          <Button size="small" onClick={() => navigate(`/trial-balance?${query}`)}>
            ← Neraca Saldo
          </Button>
          <Button size="small" onClick={() => navigate(`/adjustments?${query}`)}>
            Jurnal penyesuaian periode ini
          </Button>
          <Button size="small" onClick={() => navigate(`/reports?tab=income`)}>
            Laporan keuangan →
          </Button>
        </>
      }
      sheets={() => (ws.data ? worksheetSheet(ws.data, me?.tenantName) : null)}
    >
      <QueryState q={ws}>{(d) => <WorksheetView d={d} onAdjustments={() => navigate(`/adjustments?${query}`)} />}</QueryState>
    </ReportShell>
  );
}
