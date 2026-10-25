import { t } from '@/lib/terms';

export type Kind = 'sales' | 'purchase';

export const CFG = {
  sales: {
    get label() {
      return t('Retur Penjualan');
    },
    get party() {
      return t('Pelanggan');
    },
    list: '/sales-returns',
    invoices: '/invoices',
    detail: (id: string) => `/invoices/${id}`,
    help: 'Barang kembali dari pelanggan: stok bertambah (nilai HPP asal), piutang berkurang. Jurnal: Retur Penjualan + PPN Keluaran (debit) / Piutang (kredit); Persediaan (debit) / HPP (kredit).',
  },
  purchase: {
    get label() {
      return t('Retur Pembelian');
    },
    party: 'Supplier',
    list: '/purchase-returns',
    invoices: '/purchase-invoices',
    detail: (id: string) => `/purchase-invoices/${id}`,
    help: 'Barang dikembalikan ke supplier: stok berkurang, hutang berkurang. Jurnal: Hutang Usaha (debit) / Persediaan + PPN Masukan (kredit).',
  },
} as const;
