import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { FullTrialBalance } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import ReportShell from './ledger/ReportShell';
import { usePeriod } from './ledger/usePeriod';
import { TrialBalanceView } from './statements/views';
import { trialBalanceSheet } from '@/lib/xlsx/reports';

/** Neraca saldo lengkap: saldo awal, mutasi, saldo akhir per akun — sumber semua laporan keuangan */
export default function TrialBalancePage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { from, to, setFrom, setTo, query } = usePeriod();
  const [hideZero, setHideZero] = useState(true);
  const tb = useQuery({
    queryKey: ['statements', 'tb', from, to, hideZero],
    queryFn: () => get<FullTrialBalance>(`/accounting/statements/trial-balance${qs({ from, to, hideZero: String(hideZero) })}`),
  });
  return (
    <ReportShell
      title="Neraca Saldo"
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      controls={
        <>
          <Checkbox checked={hideZero} onChange={(e) => setHideZero(e.target.checked)}>
            Sembunyikan akun bersaldo nol
          </Checkbox>
          <Button size="small" onClick={() => navigate(`/worksheet?${query}`)}>
            Lanjut ke Neraca Lajur →
          </Button>
        </>
      }
      sheets={() => (tb.data ? trialBalanceSheet(tb.data, me?.tenantName) : null)}
    >
      <QueryState q={tb}>{(d) => <TrialBalanceView d={d} onAccount={(id) => navigate(`/ledger?accountId=${id}&${query}`)} />}</QueryState>
    </ReportShell>
  );
}
