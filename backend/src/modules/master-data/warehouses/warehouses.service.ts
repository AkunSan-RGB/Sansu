import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../../common/auth/auth-user';
import { allowedWarehouses } from '../../../common/auth/warehouse-access';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { warehouses } from '../../../db/schema';
import { SubscriptionService } from '../../../common/billing/subscription.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouses.dto';
import { ReferenceRepository } from '../../../db/reference.repository';
import { insertOne } from '../../../db/owned';
import { WarehousesRepository } from './warehouses.repository';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly refs: ReferenceRepository,
    private readonly repo: WarehousesRepository,
  ) {}

  list(tenantId: string, u?: AuthUser) {
    const allowed = allowedWarehouses(u);
    return this.repo.listWarehousesByIdAndCode(this.db, tenantId, allowed);
  }

  async create(tenantId: string, dto: CreateWarehouseDto) {
    await this.subs.assertCanAdd(tenantId, 'warehouses');
    const row = await insertOne(this.db, warehouses, { ...dto, code: dto.code.trim().toUpperCase(), tenantId });
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    const w = await this.refs.warehouse(this.db, tenantId, id);
    if (!w) throw new NotFoundException('Gudang tidak ditemukan');
    if (dto.isActive === false && w.isActive) {
      const [s] = await this.repo.countStockBalancesByWarehouseIdAndQty(this.db, tenantId, id);
      if (s.n > 0) throw new BadRequestException(`Gudang masih berisi stok ${s.n} produk. Pindahkan stok ke gudang lain dulu.`);
      const [other] = await this.repo.findWarehousesByIsActiveAndId(this.db, tenantId, id);
      if (!other) throw new BadRequestException('Harus ada minimal satu gudang aktif');
    }
    if (dto.isActive === true && !w.isActive) await this.subs.assertCanAdd(tenantId, 'warehouses');
    const [row] = await this.repo.updateWarehousesById(this.db, dto, id);
    return row;
  }
}
