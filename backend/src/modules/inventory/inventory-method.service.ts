import { BadRequestException, Injectable } from '@nestjs/common';
import { INVENTORY_METHOD_INFO, INVENTORY_METHODS, inventoryMethodGuide, isInventoryMethod, type InventoryMethod } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { frameworkOf } from '../accounting/coa-sync';
import { InventoryMethodDto } from './inventory-method.dto';
import { InventoryMethodRepository } from './inventory-method.repository';

@Injectable()
export class InventoryMethodService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly repo: InventoryMethodRepository,
  ) {}

  async current(tenantId: string): Promise<InventoryMethod> {
    const s = await this.settings.section(this.db, tenantId, 'inventory', { method: 'AVERAGE' as string });
    return isInventoryMethod(s.method) ? s.method : 'AVERAGE';
  }

  async get(tenantId: string) {
    const [method, model, framework] = await Promise.all([this.current(tenantId), this.settings.businessModel(this.db, tenantId), frameworkOf(this.db, tenantId)]);
    return {
      method,
      framework,
      model,
      options: INVENTORY_METHODS.map((k) => ({ key: k, ...INVENTORY_METHOD_INFO[k] })),
      guide: inventoryMethodGuide(model, framework),
    };
  }

  async set(u: AuthUser, dto: InventoryMethodDto) {
    if (!isInventoryMethod(dto.method)) {
      throw new BadRequestException(
        dto.method?.toUpperCase() === 'LIFO'
          ? 'LIFO tidak diakui SAK EP maupun SAK EMKM. Pilih rata-rata bergerak atau MPKP (FIFO).'
          : 'Metode persediaan tidak dikenal. Pilih rata-rata bergerak atau MPKP (FIFO).',
      );
    }
    const before = await this.current(u.tenantId);
    await this.db.transaction(async (tx) => {
      await this.settings.saveSection(tx, u.tenantId, 'inventory', { method: 'AVERAGE' as string }, { method: dto.method });
      // lapisan lama tidak lagi dirawat bila beralih ke rata-rata; dibangun ulang dari saldo saat beralih ke FIFO
      if (before !== dto.method) await this.repo.queryStockLayer(tx, u.tenantId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'InventoryMethod', entityId: u.tenantId, data: { from: before, to: dto.method } });
    });
    return this.get(u.tenantId);
  }
}
