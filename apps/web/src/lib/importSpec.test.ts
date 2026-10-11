import { describe, expect, it } from 'vitest';
import { findHeaderRow, matchHeaders, SPEC_BY_KIND } from './importSpec';

describe('pengenalan judul kolom impor', () => {
  it('ekspor software lain + baris judul laporan', () => {
    const grid = [['Daftar Barang'], ['CV Contoh'], [], ['Kode Barang', 'Nama Barang', 'Harga Jual', 'Satuan', 'Konversi']];
    const spec = SPEC_BY_KIND.products;
    const h = findHeaderRow(spec, grid);
    expect(h).toBe(3);
    expect(matchHeaders(spec, grid[h])).toEqual({ sku: 0, nama: 1, harga_jual: 2, satuan: 3, isi2: 4 });
  });
  it('templat SANSU dikenali persis', () => {
    const spec = SPEC_BY_KIND.receivables;
    expect(matchHeaders(spec, ['kode_pelanggan', 'no_faktur', 'tanggal', 'jatuh_tempo', 'sisa_piutang'])).toEqual({
      kode_pelanggan: 0,
      no_faktur: 1,
      tanggal: 2,
      jatuh_tempo: 3,
      sisa_piutang: 4,
    });
  });
});

describe('templat impor', () => {
  it('judul kolom templat dikenali kembali oleh pembaca dan lembar Petunjuk ada', async () => {
    const { buildTemplate, IMPORT_SPECS } = await import('./importSpec');
    const ExcelJS = await import('exceljs');
    for (const spec of IMPORT_SPECS) {
      const bytes = await buildTemplate(spec, ((ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS) as typeof ExcelJS);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'Petunjuk']);
      const header = (wb.getWorksheet('Data')!.getRow(1).values as unknown[]).slice(1);
      expect(Object.keys(matchHeaders(spec, header)).length).toBe(spec.columns.length);
    }
  });
});
