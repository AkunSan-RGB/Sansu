import { describe, expect, it } from 'vitest';
import type { CashTransaction } from '@/api/types';
import { buildCashBody, cashAccountOptions, cashFlow, filterCashTx, type AssetCatsByAccount } from './cashLogic';

const tx = (o: Partial<CashTransaction> & { type: CashTransaction['type']; amount: string }): CashTransaction =>
  ({ id: o.number ?? 'x', number: 'KK-1', description: 'biaya', status: 'POSTED', cashAccount: { id: 'a', name: 'Kas Kecil' }, lines: [], ...o }) as unknown as CashTransaction;

describe('cashFlow (ringkasan uang masuk/keluar)', () => {
  it('membatalkan tidak dihitung, transfer tidak mengubah total, bukti kosong dihitung hanya untuk yang bukan masuk', () => {
    const f = cashFlow([
      tx({ type: 'IN', amount: '1000000' }),
      tx({ type: 'OUT', amount: '250000', reference: 'NOTA-1' }),
      tx({ type: 'OUT', amount: '100000' }), // tanpa bukti
      tx({ type: 'OUT', amount: '900000', status: 'VOID' }), // dibatalkan: diabaikan
      tx({ type: 'TRANSFER', amount: '500000' }), // tanpa bukti, tapi bukan IN
    ]);
    expect(f).toEqual({ inn: 1_000_000, out: 350_000, net: 650_000, missing: 2 });
  });
  it('daftar kosong menghasilkan nol', () => {
    expect(cashFlow([])).toEqual({ inn: 0, out: 0, net: 0, missing: 0 });
  });
});

describe('filterCashTx', () => {
  const list = [
    tx({ number: 'KK-1', type: 'OUT', amount: '1', description: 'Listrik gudang', branchId: 'b1', reference: 'N1' }),
    tx({ number: 'KK-2', type: 'OUT', amount: '1', description: 'Parkir', reference: undefined }),
    tx({ number: 'KM-3', type: 'IN', amount: '1', description: 'Modal', branchId: undefined }),
    tx({ number: 'KK-4', type: 'OUT', amount: '1', description: 'Batal', status: 'VOID' }),
  ];
  const base = { typeFilter: 'ALL' as const, noProofOnly: false, search: '' };
  it('menyaring jenis, cabang, tanpa bukti, dan pencarian teks', () => {
    expect(filterCashTx(list, { ...base, typeFilter: 'IN' }).map((t) => t.number)).toEqual(['KM-3']);
    expect(filterCashTx(list, { ...base, branchFilter: 'b1' }).map((t) => t.number)).toEqual(['KK-1']);
    expect(filterCashTx(list, { ...base, branchFilter: 'NONE' }).map((t) => t.number)).toEqual(['KK-2', 'KM-3', 'KK-4']);
    expect(filterCashTx(list, { ...base, noProofOnly: true }).map((t) => t.number)).toEqual(['KK-2']); // masuk & batal tidak dihitung
    expect(filterCashTx(list, { ...base, search: '  LISTRIK ' }).map((t) => t.number)).toEqual(['KK-1']);
    expect(filterCashTx(list, { ...base, search: 'n1' }).map((t) => t.number)).toEqual(['KK-1']);
  });
});

describe('buildCashBody (isi permintaan simpan)', () => {
  const noAssets: AssetCatsByAccount = new Map();
  it('transfer membawa jumlah sebagai teks dan tidak membawa baris', () => {
    const b = buildCashBody('TRANSFER', { cashAccountId: 'a', toCashAccountId: 'b', amount: 250000, date: '2026-10-01', description: 'setor' }, noAssets);
    expect(b).toMatchObject({ type: 'TRANSFER', cashAccountId: 'a', toCashAccountId: 'b', amount: '250000' });
    expect('lines' in b).toBe(false);
  });
  it('pilihan "src:" menjadi sumber uang (bukan akun), pilihan akun tetap akun', () => {
    const b = buildCashBody('OUT', { cashAccountId: 'a', date: 'd', description: 'x', lines: [{ accountId: 'src:LISTRIK', amount: 100 }, { accountId: 'acc-1', amount: 50, memo: '' }] }, noAssets) as { lines: Record<string, unknown>[] };
    expect(b.lines[0]).toMatchObject({ accountId: undefined, source: 'LISTRIK', amount: '100' });
    expect(b.lines[1]).toMatchObject({ accountId: 'acc-1', source: undefined, amount: '50', memo: undefined });
  });
  it('proyek hanya untuk uang keluar; data aset hanya bila akunnya akun aset', () => {
    const assets: AssetCatsByAccount = new Map([['acc-asset', [{ id: 'cat', name: 'Kendaraan', method: 'STRAIGHT_LINE' }]]]);
    const v = { cashAccountId: 'a', date: 'd', description: 'x', lines: [{ accountId: 'acc-asset', amount: 10, projectId: 'p1', assetName: 'Motor', assetCategoryId: 'cat' }] };
    const out = buildCashBody('OUT', v, assets) as { lines: Record<string, unknown>[] };
    expect(out.lines[0]).toMatchObject({ projectId: 'p1', assetName: 'Motor', assetCategoryId: 'cat' });
    const inn = buildCashBody('IN', v, assets) as { lines: Record<string, unknown>[] };
    expect(inn.lines[0].projectId).toBeUndefined();
    expect('assetName' in inn.lines[0]).toBe(false);
  });
  it('alasan lewat anggaran ikut terkirim', () => {
    expect(buildCashBody('OUT', { cashAccountId: 'a', date: 'd', description: 'x', lines: [] }, noAssets, 'darurat').budgetOverrideReason).toBe('darurat');
  });
});

describe('cashAccountOptions (pemisahan fungsi pada pilihan akun)', () => {
  const counter = [
    { id: '1', code: '6-1', name: 'Biaya listrik', type: 'EXPENSE' },
    { id: '2', code: '3-1', name: 'Modal', type: 'EQUITY' },
  ];
  const noAssets: AssetCatsByAccount = new Map();
  const flat = (o: unknown) => JSON.stringify(o);
  it('Keuangan tidak ditawari akun modal untuk uang keluar', () => {
    expect(flat(cashAccountOptions('OUT', 'FINANCE', counter, noAssets))).not.toContain('Modal');
    expect(flat(cashAccountOptions('OUT', 'OWNER', counter, noAssets))).toContain('Modal');
  });
  it('uang masuk: akun pembukuan penuh hanya untuk Pemilik/Admin', () => {
    expect(flat(cashAccountOptions('IN', 'FINANCE', counter, noAssets))).not.toContain('Akun pembukuan');
    expect(flat(cashAccountOptions('IN', 'ADMIN', counter, noAssets))).toContain('Akun pembukuan');
  });
});
