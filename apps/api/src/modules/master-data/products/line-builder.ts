import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { D, Dec, money } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { products } from '../../../db/schema';
import { lineTotal } from '../../sales/pricing';

export interface LineInput {
  productId: string;
  uom?: string;
  qty: string;
  price?: string;
  discountPct?: string;
}

export interface BuiltLine {
  productId: string;
  uom: string;
  uomFactor: string;
  qty: string;
  price: Dec;
  discountPct: Dec;
  lineTotal: Dec;
}

/**
 * Validasi & hitung baris dokumen (order jual/beli): produk aktif milik tenant,
 * satuan terdaftar, qty > 0, diskon 0–100%.
 * `defaultPrice` = 'sell' memakai harga jual master x faktor satuan bila harga kosong.
 */
export async function buildLines(
  db: DbOrTx,
  tenantId: string,
  input: LineInput[],
  defaultPrice: 'sell' | 'required',
): Promise<BuiltLine[]> {
  const prods = await db.query.products.findMany({
    where: and(eq(products.tenantId, tenantId), inArray(products.id, input.map((l) => l.productId))),
    with: { uoms: true },
  });
  const byId = new Map(prods.map((p) => [p.id, p]));

  return input.map((l) => {
    const p = byId.get(l.productId);
    if (!p || !p.isActive) throw new BadRequestException(`Produk ${l.productId} tidak ditemukan / nonaktif`);
    if (p.inventoryKind === 'SEMI') throw new BadRequestException(`${p.sku} adalah barang setengah jadi: dibuat dan dipakai lewat perintah produksi, tidak dijual atau dibeli lewat dokumen ini`);
    const uom = l.uom ?? p.baseUom;
    const factor = uom === p.baseUom ? '1' : p.uoms.find((u) => u.uom === uom)?.factor;
    if (!factor) throw new BadRequestException(`Satuan ${uom} tidak terdaftar untuk ${p.sku}`);
    if (D(l.qty).lte(0)) throw new BadRequestException(`Kuantitas ${p.sku} harus > 0`);
    const discountPct = D(l.discountPct);
    if (discountPct.lt(0) || discountPct.gt(100)) throw new BadRequestException('Diskon harus 0–100%');
    if (l.price === undefined && defaultPrice === 'required') throw new BadRequestException(`Harga ${p.sku} wajib diisi`);
    const price = l.price !== undefined ? money(l.price) : money(D(p.sellPrice).times(factor));
    if (price.isNegative()) throw new BadRequestException(`Harga ${p.sku} tidak boleh negatif`);
    return {
      productId: p.id,
      uom,
      uomFactor: factor,
      qty: l.qty,
      price,
      discountPct,
      lineTotal: lineTotal({ qty: l.qty, price, discountPct }),
    };
  });
}
