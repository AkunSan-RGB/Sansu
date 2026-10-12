import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { allowedWarehouses } from '../../../common/auth/warehouse-access';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { stockBalances, warehouses } from '../../../db/schema';
import { SubscriptionService } from '../../../common/billing/subscription.service';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'GDG-02' }) @IsString() @MaxLength(20) code: string;
  @ApiProperty({ example: 'Gudang Cabang Bekasi' }) @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ description: 'Nonaktifkan gudang yang sudah tidak dipakai (stok harus kosong)' }) @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class WarehousesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
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
    const [w] = await this.db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
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

@ApiTags('Master Data')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId, u);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateWarehouseDto) {
    return this.svc.create(u.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) {
    return this.svc.update(u.tenantId, id, dto);
  }
}
