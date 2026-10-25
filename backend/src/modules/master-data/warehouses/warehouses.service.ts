import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { allowedWarehouses } from '../../../common/auth/warehouse-access';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { stockBalances, warehouses } from '../../../db/schema';
import { SubscriptionService } from '../../../common/billing/subscription.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouses.dto';
import { ReferenceRepository } from '../../../db/reference.repository';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly refs: ReferenceRepository,
  ) {}

  list(tenantId: string, u?: AuthUser) {
    const allowed = allowedWarehouses(u);
    return this.db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), allowed ? inArray(warehouses.id, allowed) : undefined))
      .orderBy(asc(warehouses.code));
  }

  async create(tenantId: string, dto: CreateWarehouseDto) {
    await this.subs.assertCanAdd(tenantId, 'warehouses');
    const [row] = await this.db
      .insert(warehouses)
      .values({ ...dto, code: dto.code.trim().toUpperCase(), tenantId })
      .returning();
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    const w = await this.refs.warehouse(this.db, tenantId, id);
    if (!w) throw new NotFoundException('Gudang tidak ditemukan');
    if (dto.isActive === false && w.isActive) {
      const [s] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(stockBalances)
        .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, id), ne(stockBalances.qty, '0')));
      if (s.n > 0) throw new BadRequestException(`Gudang masih berisi stok ${s.n} produk. Pindahkan stok ke gudang lain dulu.`);
      const [other] = await this.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true), ne(warehouses.id, id)));
      if (!other) throw new BadRequestException('Harus ada minimal satu gudang aktif');
    }
    if (dto.isActive === true && !w.isActive) await this.subs.assertCanAdd(tenantId, 'warehouses');
    const [row] = await this.db
      .update(warehouses)
      .set({ name: dto.name?.trim() || undefined, address: dto.address, isActive: dto.isActive })
      .where(eq(warehouses.id, id))
      .returning();
    return row;
  }
}
