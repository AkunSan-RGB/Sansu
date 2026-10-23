import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { enter, leave, type FlightState } from '@/lib/singleFlight';
import { useHasRole } from '@/lib/roles';
import { App } from 'antd';
import { ApiError, get } from './client';
import type { Account, CashAccount, Customer, Product, Supplier, Warehouse } from './types';

/** Data master yang dipakai banyak halaman */
/** Gudang untuk dipilih di transaksi: hanya yang aktif. `{ all: true }` untuk menampilkan juga yang nonaktif. */
export const useWarehouses = (opts: { all?: boolean } = {}) =>
  useQuery({
    queryKey: ['warehouses'],
    queryFn: () => get<Warehouse[]>('/warehouses'),
    select: opts.all ? undefined : (ws: Warehouse[]) => ws.filter((w) => w.isActive !== false),
  });
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => get<Product[]>('/products') });
export const useCustomers = () => useQuery({ queryKey: ['customers'], queryFn: () => get<Customer[]>('/customers') });
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => get<Supplier[]>('/suppliers') });
export const useAccounts = () => useQuery({ queryKey: ['accounts'], enabled: useHasRole(['ADMIN', 'FINANCE', 'ACCOUNTANT']), queryFn: () => get<Account[]>('/accounting/accounts') });
/** Akun kas & bank beserta saldonya */
export const useCashAccounts = () => useQuery({ queryKey: ['cash-accounts'], queryFn: () => get<CashAccount[]>('/cash/accounts') });

/** Query key yang terdampak setiap kali ada posting jurnal */
export const LEDGER_KEYS = ['journals', 'reports', 'dashboard', 'cash-accounts', 'cash-tx', 'ledger', 'statements', 'notes', 'health', 'fiscal', 'assets', 'tax-thresholds', 'doc-chain', 'deliveries'];

/**
 * Mutasi dengan notifikasi sukses/gagal standar dan refresh data terkait.
 * `invalidate` = daftar queryKey yang perlu dimuat ulang setelah berhasil.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: string[]; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Satu permintaan pada satu waktu: klik ganda sebelum layar sempat menampilkan "memproses" tidak mengirim transaksi dua kali
  const flight = useRef<FlightState>({ busy: false });
  const m = useMutation({
    mutationFn: async (v: TVars) => {
      try {
        return await fn(v);
      } finally {
        leave(flight.current);
      }
    },
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (opts.success) message.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => {
      message.error(e.message, 6);
      // permintaan persetujuan baru dibuat: pemohon dapat memilih penyetuju yang berwenang
      const d = e instanceof ApiError ? (e.data as { code?: string; requestId?: string } | undefined) : undefined;
      if (d?.code === 'APPROVAL_REQUIRED' && d.requestId) window.dispatchEvent(new CustomEvent('sansu:approval-required', { detail: { requestId: d.requestId } }));
    },
  });
  const mutate = ((...args: Parameters<typeof m.mutate>) => {
    if (enter(flight.current)) m.mutate(...args);
  }) as typeof m.mutate;
  const mutateAsync = ((...args: Parameters<typeof m.mutateAsync>) => {
    if (!enter(flight.current)) return new Promise<TResult>(() => undefined);
    return m.mutateAsync(...args);
  }) as typeof m.mutateAsync;
  return { ...m, mutate, mutateAsync };
}

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  warehouses: { id: string; code: string; name: string; isActive: boolean }[];
}
/** Daftar cabang perusahaan (kosong bila perusahaan belum memakai cabang) */
export const useBranches = () =>
  useQuery({
    queryKey: ['branches'],
    enabled: useHasRole(['ADMIN', 'FINANCE', 'WAREHOUSE', 'CASHIER', 'ACCOUNTANT']),
    queryFn: () => get<{ branches: BranchRow[]; unassignedWarehouses: { id: string; code: string; name: string }[]; cashAccounts?: { id: string; code: string; name: string; branchId: string | null }[] }>('/branches'),
    staleTime: 60_000,
  });
