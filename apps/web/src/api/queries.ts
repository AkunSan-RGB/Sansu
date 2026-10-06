import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { get } from './client';
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
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/accounting/accounts') });
/** Akun kas & bank beserta saldonya */
export const useCashAccounts = () => useQuery({ queryKey: ['cash-accounts'], queryFn: () => get<CashAccount[]>('/cash/accounts') });

/** Query key yang terdampak setiap kali ada posting jurnal */
export const LEDGER_KEYS = ['journals', 'reports', 'dashboard', 'cash-accounts', 'cash-tx', 'ledger', 'statements', 'notes', 'health', 'fiscal', 'assets'];

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
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (opts.success) message.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => message.error(e.message, 6),
  });
}
