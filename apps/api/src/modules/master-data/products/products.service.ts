import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { products, productUoms } from '../../../db/schema';
import { CreateProductDto, ProductUomDto, UpdateProductDto } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tenantId: string, q?: string) {
    return this.db.query.products.findMany({
      where: and(
        eq(products.tenantId, tenantId),
        q ? or(ilike(products.sku, `%${q}%`), ilike(products.name, `%${q}%`)) : undefined,
      ),
      with: { uoms: true },
      orderBy: [asc(products.sku)],
      limit: 500,
    });
  }

  async get(tenantId: string, id: string) {
    const p = await this.db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
      with: { uoms: true },
    });
    if (!p) throw new NotFoundException('Produk tidak ditemukan');
    return p;
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const baseUom = dto.baseUom ?? 'PCS';
    this.validateUoms(baseUom, dto.uoms);
    const id = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({
          tenantId,
          sku: dto.sku.trim().toUpperCase(),
          name: dto.name.trim(),
          category: dto.category,
          baseUom,
          sellPrice: dto.sellPrice,
          barcode: dto.barcode?.trim() || null,
        })
        .returning({ id: products.id });
      if (dto.uoms?.length) {
        await tx.insert(productUoms).values(dto.uoms.map((u) => ({ productId: p.id, uom: u.uom, factor: u.factor })));
      }
      return p.id;
    });
    return this.get(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const current = await this.get(tenantId, id);
    const baseUom = dto.baseUom ?? current.baseUom;
    if (dto.uoms) this.validateUoms(baseUom, dto.uoms);

    await this.db.transaction(async (tx) => {
      if (dto.uoms) {
        await tx.delete(productUoms).where(eq(productUoms.productId, id));
        if (dto.uoms.length) {
          await tx.insert(productUoms).values(dto.uoms.map((u) => ({ productId: id, uom: u.uom, factor: u.factor })));
        }
      }
      await tx
        .update(products)
        .set({
          sku: dto.sku?.trim().toUpperCase(),
          name: dto.name?.trim(),
          category: dto.category,
          baseUom: dto.baseUom,
          sellPrice: dto.sellPrice,
          barcode: dto.barcode === undefined ? undefined : dto.barcode.trim() || null,
          isActive: dto.isActive,
        })
        .where(eq(products.id, id));
    });
    return this.get(tenantId, id);
  }

  private validateUoms(baseUom: string, uoms?: ProductUomDto[]) {
    if (!uoms) return;
    const seen = new Set<string>();
    for (const u of uoms) {
      if (u.uom === baseUom) throw new BadRequestException(`Satuan ${u.uom} sama dengan satuan dasar`);
      if (seen.has(u.uom)) throw new BadRequestException(`Satuan ${u.uom} duplikat`);
      if (D(u.factor).lte(0)) throw new BadRequestException(`Faktor satuan ${u.uom} harus > 0`);
      seen.add(u.uom);
    }
  }
}
