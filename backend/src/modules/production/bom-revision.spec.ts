import type { BomSnapshot } from '../../db/schema';
import { diffBom } from './bom-revision';

const base = (): BomSnapshot => ({
  name: 'Kemeja',
  productId: 'p-jadi',
  outputQty: '12',
  laborCost: '120000.00',
  overheadCost: '45000.00',
  notes: null,
  isActive: true,
  lines: [
    { productId: 'a', qty: '2' },
    { productId: 'b', qty: '1.5' },
  ],
});

describe('diffBom', () => {
  it('tidak ada perubahan bila isi sama, termasuk beda format angka', () => {
    const next = base();
    next.outputQty = '12.0000';
    next.laborCost = '120000';
    next.lines[1].qty = '1.5000';
    expect(diffBom(base(), next)).toEqual([]);
  });

  it('mendeteksi perubahan header', () => {
    const next = { ...base(), outputQty: '10', laborCost: '130000.00', isActive: false };
    expect(diffBom(base(), next).map((c) => c.field).sort()).toEqual(['isActive', 'laborCost', 'outputQty']);
  });

  it('mendeteksi bahan ditambah, dihapus, dan takaran berubah', () => {
    const next = base();
    next.lines = [{ productId: 'a', qty: '3' }, { productId: 'c', qty: '1' }];
    const c = diffBom(base(), next);
    expect(c.find((x) => x.field === 'line:a')).toMatchObject({ label: 'Takaran bahan', from: '2', to: '3' });
    expect(c.find((x) => x.field === 'line:c')).toMatchObject({ label: 'Bahan ditambah' });
    expect(c.find((x) => x.field === 'line:b')).toMatchObject({ label: 'Bahan dihapus' });
  });
});
