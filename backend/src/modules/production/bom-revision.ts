import type { BomSnapshot } from '../../db/schema';
import { D } from '../../common/utils/money';

export interface BomChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

const HEADER: { field: keyof BomSnapshot; label: string }[] = [
  { field: 'name', label: 'Nama' },
  { field: 'productId', label: 'Produk jadi' },
  { field: 'outputQty', label: 'Hasil per batch' },
  { field: 'laborCost', label: 'Upah standar' },
  { field: 'overheadCost', label: 'Overhead standar' },
  { field: 'notes', label: 'Catatan' },
  { field: 'isActive', label: 'Status aktif' },
];

const same = (field: string, a: unknown, b: unknown) =>
  ['outputQty', 'laborCost', 'overheadCost'].includes(field) ? D(String(a ?? 0)).eq(D(String(b ?? 0))) : (a ?? '') === (b ?? '');

/** Daftar perbedaan dua isi resep (header dan bahan); kosong berarti tidak ada perubahan */
export function diffBom(prev: BomSnapshot, next: BomSnapshot): BomChange[] {
  const out: BomChange[] = [];
  for (const h of HEADER) {
    if (!same(h.field, prev[h.field], next[h.field])) out.push({ field: h.field, label: h.label, from: String(prev[h.field] ?? ''), to: String(next[h.field] ?? '') });
  }
  const a = new Map(prev.lines.map((l) => [l.productId, l.qty]));
  const b = new Map(next.lines.map((l) => [l.productId, l.qty]));
  for (const [pid, q] of b) {
    if (!a.has(pid)) out.push({ field: `line:${pid}`, label: 'Bahan ditambah', from: '', to: D(q).toString() });
    else if (!D(a.get(pid)!).eq(D(q))) out.push({ field: `line:${pid}`, label: 'Takaran bahan', from: D(a.get(pid)!).toString(), to: D(q).toString() });
  }
  for (const [pid, q] of a) if (!b.has(pid)) out.push({ field: `line:${pid}`, label: 'Bahan dihapus', from: D(q).toString(), to: '' });
  return out;
}
