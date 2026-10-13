import { describe, expect, it } from 'vitest';
import type { FixedAsset } from '@/api/types';
import { assetCountSheet } from './reports';

const asset = (over: Partial<FixedAsset>) =>
  ({ id: 'a', code: 'AT-0001', name: 'Mesin', category: { id: 'c', name: 'Mesin', fiscalGroup: 'GROUP_2' }, location: 'Gudang', custodian: 'Budi', status: 'ACTIVE', ...over }) as unknown as FixedAsset;

describe('assetCountSheet', () => {
  it('satu baris per aset, kolom hasil dikosongkan untuk diisi tangan', () => {
    const [sheet] = assetCountSheet([asset({}), asset({ id: 'b', code: 'AT-0002', lastVerifiedAt: '2026-03-05T00:00:00Z', verificationStatus: 'DAMAGED' })], '2026-10-13', 'PT Uji');
    expect(sheet.rows).toHaveLength(2);
    const [r1, r2] = sheet.rows as unknown as { cells?: Record<string, unknown> }[];
    const text = JSON.stringify([r1, r2]);
    expect(text).toContain('Belum pernah');
    expect(text).toContain('Rusak');
    expect(sheet.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['cond', 'realLoc', 'note', 'sign']));
  });
});
