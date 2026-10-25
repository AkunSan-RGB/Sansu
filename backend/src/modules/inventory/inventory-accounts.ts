import { Dec, ZERO } from '../../common/utils/money';
import { DbOrTx } from '../../db/db';
import { SYS, type SystemKey } from '../accounting/default-coa';
import { listProductsByInventoryKindAndId } from './inventory-accounts.repository';

/** Himpunan id barang setengah jadi di antara `ids` */
export async function semiSet(db: DbOrTx, tenantId: string, ids: string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Set();
  const rows = await listProductsByInventoryKindAndId(db, tenantId, uniq);
  return new Set(rows.map((r) => r.id));
}

type Side = 'debit' | 'credit';
/**
 * Baris jurnal persediaan: nilai tiap barang dijumlahkan ke akun yang sesuai jenisnya. Baris barang setengah jadi hanya muncul
 * bila ada nilainya (akun itu tidak perlu ada pada perusahaan yang tidak memakainya).
 */
export function inventoryLines(
  items: { productId: string; value: Dec }[],
  semi: Set<string>,
  side: Side,
): { key: SystemKey; debit?: Dec; credit?: Dec }[] {
  let normal: Dec = ZERO;
  let semiValue: Dec = ZERO;
  for (const i of items)
    semi.has(i.productId) ? (semiValue = semiValue.plus(i.value)) : (normal = normal.plus(i.value));
  const line = (key: SystemKey, v: Dec) => ({ key, [side]: v }) as { key: SystemKey; debit?: Dec; credit?: Dec };
  return [line(SYS.INVENTORY, normal), ...(semiValue.isZero() ? [] : [line(SYS.INVENTORY_SEMI, semiValue)])];
}
