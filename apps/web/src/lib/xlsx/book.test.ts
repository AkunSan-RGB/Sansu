import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { colLetter, d, SheetBuilder } from './book';
import { buildXlsx } from './render';
import { cashCountSheet, ledgerSheet, subscriptionVatSheet, trialBalanceSheet } from './reports';

describe('penyusun Excel', () => {
  it('huruf kolom', () => {
    expect([0, 25, 26, 51, 701].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ']);
  });

  it('tanggal tanpa geser zona waktu', () => {
    expect(d('2026-03-31')?.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('nomor baris & rumus jumlah dengan nilai cache', () => {
    const s = new SheetBuilder('Uji', {
      title: 'Uji',
      subtitle: ['Periode'],
      columns: [
        { key: 'a', header: 'A' },
        { key: 'x', header: 'X', fmt: 'money' },
      ],
    });
    // kop: perusahaan, judul, 1 subjudul, kosong, judul kolom = baris 5
    expect(s.headerRow).toBe(5);
    const r1 = s.row({ a: 'satu', x: 10 });
    s.row({ a: 'dua', x: 32.5 });
    expect(r1).toBe(6);
    const t = s.totals('Jumlah', 6, 7, ['x']);
    expect(s.spec.rows[t - 6].values[1]).toEqual({ f: 'SUM(B6:B7)', v: 42.5 });
  });

  it('rumus hanya dipakai bila hasilnya sama dengan angka sistem', () => {
    const s = new SheetBuilder('Uji', { title: 'Uji', columns: [{ key: 'x', header: 'X' }] });
    expect(s.verified('A1+A2', 100, 100)).toEqual({ f: 'A1+A2', v: 100 });
    expect(s.verified('A1+A2', 100, 99)).toBe(100);
  });

  it('neraca saldo: saldo akhir & jumlah berumus, kontrol selisih', () => {
    const dc = (debit: string, credit: string) => ({ debit, credit });
    const [sheet] = trialBalanceSheet({
      period: { from: '2026-01-01', to: '2026-12-31' },
      rows: [
        {
          id: '1',
          code: '1-1100',
          name: 'Kas',
          type: 'ASSET',
          reportGroup: 'CASH',
          opening: dc('100', '0'),
          movement: dc('50', '30'),
          closing: dc('120', '0'),
        },
        {
          id: '2',
          code: '3-1000',
          name: 'Modal',
          type: 'EQUITY',
          reportGroup: 'SHARE_CAPITAL',
          opening: dc('0', '100'),
          movement: dc('0', '20'),
          closing: dc('0', '120'),
        },
      ],
      totals: { opening: dc('100', '100'), movement: dc('50', '50'), closing: dc('120', '120') },
      balanced: true,
    } as never);
    const kas = sheet.rows[0].values;
    expect(kas[6]).toMatchObject({ f: 'MAX(0,C8-D8+E8-F8)', v: 120 });
    expect(sheet.rows[2].values[2]).toMatchObject({ f: 'SUM(C8:C9)', v: 100 });
    expect(sheet.checks).toEqual(['D11', 'F11', 'H11']);
  });

  it('buku besar: saldo berjalan berumus mengikuti saldo normal akun', () => {
    const [sheet] = ledgerSheet(
      {
        account: { id: 'a', code: '4-1000', name: 'Penjualan', type: 'REVENUE' },
        opening: '1000',
        closing: '1400',
        totalDebit: '100',
        totalCredit: '500',
        rows: [
          {
            journalId: 'j1',
            number: 'JU/1',
            date: '2026-09-01',
            description: 'Jual',
            sourceType: 'INVOICE',
            debit: '0',
            credit: '500',
            balance: '1500',
          },
          {
            journalId: 'j2',
            number: 'JU/2',
            date: '2026-09-02',
            description: 'Retur',
            sourceType: 'INVOICE',
            debit: '100',
            credit: '0',
            balance: '1400',
          },
        ],
      } as never,
      '2026-09-01',
      '2026-09-30',
    );
    expect(sheet.rows[1].values[6]).toMatchObject({ f: 'G7+F8-E8', v: 1500 });
    expect(sheet.rows[3].values[6]).toMatchObject({ f: 'G7+F10-E10', v: 1400 });
  });

  it('rekap PPN langganan: total = DPP + PPN berumus, jumlah per kolom', () => {
    const row = (id: string, dpp: string, vat: string) => ({
      id,
      number: id,
      paidAt: '2026-10-02T03:00:00Z',
      buyer: 'PT A',
      buyerNpwp: null,
      buyerAddress: null,
      plan: 'Bisnis',
      cycle: 'MONTHLY' as const,
      subtotal: dpp,
      vatRate: '11',
      vatAmount: vat,
      amount: String(Number(dpp) + Number(vat)),
    });
    const [s] = subscriptionVatSheet(
      [row('INV/1', '500000', '55000'), row('INV/2', '1000000', '110000')],
      '2026-10',
      'PT SANSU GLOBAL INTI',
    );
    expect(s.title).toContain('Oktober 2026');
    const amtCol = s.columns.findIndex((c) => c.key === 'amt');
    const first = s.rows[0].values[amtCol] as { f: string; v: number };
    expect(first.f).toMatch(/^F\d+\+H\d+$/);
    expect(first.v).toBe(555000);
    const last = s.rows[s.rows.length - 1];
    expect(last.values[amtCol]).toMatchObject({ v: 1665000 });
  });

  it('opname kas: pecahan × jumlah berumus, rekonsiliasi & selisih', () => {
    const [s] = cashCountSheet(
      {
        id: '1',
        number: 'OPK/2026/10/0001',
        date: '2026-10-31',
        accountId: 'a',
        account: { code: '1-1110', name: 'Kas Kecil' },
        status: 'POSTED',
        denominations: { K100000: 9, K50000: 1, K20000: 2 },
        items: [{ type: 'ADD', description: 'Bon sementara', amount: '5000.00' }],
        bookBalance: '1000000.00',
        countedTotal: '990000.00',
        itemsTotal: '5000.00',
        difference: '-5000.00',
        custodianName: 'Rina',
        notes: null,
        reason: 'Receh',
        rejectReason: null,
        journalNumber: 'JU/1',
        createdBy: 'A',
        approvedBy: null,
        postedAt: null,
        createdAt: '2026-10-31',
      },
      'PT Uji',
    );
    const val = s.columns.findIndex((c) => c.key === 'val');
    const first = s.rows.find((r) => r.style === 'body' && (r.values[0] as string)?.includes('100.000'))!;
    expect(first.values[val]).toMatchObject({ f: expect.stringMatching(/^B\d+\*C\d+$/), v: 900000 });
    const grand = s.rows.find((r) => r.style === 'grand')!;
    expect(grand.values[val]).toMatchObject({ v: -5000 });
    expect((grand.values[val] as { f: string }).f).toMatch(/^D\d+-D\d+$/);
  });

  it('menghasilkan file .xlsx yang bisa dibaca kembali', async () => {
    const s = new SheetBuilder('Uji', {
      title: 'Uji',
      company: 'PT Contoh',
      columns: [
        { key: 'a', header: 'Akun', fmt: 'code' },
        { key: 'x', header: 'Jumlah', fmt: 'money' },
      ],
      filter: true,
    });
    s.row({ a: '1100', x: 5 });
    s.row({ a: '1200', x: 7 });
    s.totals('Jumlah', 5, 6, ['x']);
    const bytes = await buildXlsx([s.spec], { ExcelJS });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Uji')!;
    expect(ws.getCell('A1').value).toBe('PT Contoh');
    expect(ws.getCell('B4').value).toBe('Jumlah');
    expect(ws.getCell('B7').value).toMatchObject({ formula: 'SUM(B5:B6)', result: 12 });
    expect(ws.getCell('B5').numFmt).toContain('#,##0');
  });
});
