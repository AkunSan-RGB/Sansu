import { LEDGER_KEYS } from '@/api/queries';
import { fmtMoney } from '@/lib/format';

export const KEYS = ['bank', ...LEDGER_KEYS];

export const signed = (v: string | number) => {
  const n = Number(v);
  return <span style={{ color: n < 0 ? '#cf1322' : '#389e0d', whiteSpace: 'nowrap' }}>{n < 0 ? `− ${fmtMoney(-n)}` : `+ ${fmtMoney(n)}`}</span>;
};
