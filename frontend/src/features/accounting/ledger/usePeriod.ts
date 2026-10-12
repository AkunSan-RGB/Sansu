import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

/** Periode laporan disimpan di URL (?from=&to=) agar tautan antar halaman membawa periode yang sama */
export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? dayjs().startOf('year').format('YYYY-MM-DD');
  const to = params.get('to') ?? dayjs().format('YYYY-MM-DD');
  const set = (k: 'from' | 'to', v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  return { from, to, setFrom: (v: string) => set('from', v), setTo: (v: string) => set('to', v), query: `from=${from}&to=${to}` };
}
