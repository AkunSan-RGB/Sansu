import { describe, expect, it } from 'vitest';
import { buildBinQr, parseBinScan, resolveBin } from './binQr';

describe('kode QR rak', () => {
  it('membentuk dan membaca label', () => {
    expect(buildBinQr('GDG-01', 'A-01-03')).toBe('RAK:GDG-01:A-01-03');
    expect(parseBinScan('RAK:GDG-01:A-01-03')).toEqual({ warehouseCode: 'GDG-01', code: 'A-01-03' });
    expect(parseBinScan('  rak:gdg-01:a-01-03 ')).toEqual({ warehouseCode: 'GDG-01', code: 'A-01-03' });
  });
  it('menerima kode polos dan menolak kosong', () => {
    expect(parseBinScan('a-02-01')).toEqual({ code: 'A-02-01' });
    expect(parseBinScan('   ')).toBeNull();
  });
  it('mencocokkan ke rak satu gudang dan menolak gudang lain / rak tak dikenal', () => {
    const bins = [{ code: 'A-01' }, { code: 'B-01' }];
    expect(resolveBin('RAK:GDG-01:b-01', 'GDG-01', bins).bin).toEqual({ code: 'B-01' });
    expect(resolveBin('A-01', 'GDG-01', bins).bin).toEqual({ code: 'A-01' });
    expect(resolveBin('RAK:GDG-02:A-01', 'GDG-01', bins).error).toContain('GDG-02');
    expect(resolveBin('Z-9', 'GDG-01', bins).error).toContain('Z-9');
  });
});
