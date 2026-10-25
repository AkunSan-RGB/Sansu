import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { InventoryMethodService } from './inventory-method.service';
import { InventoryMethodDto } from './inventory-method.dto';

/** Metode penentuan biaya persediaan (rata-rata bergerak / MPKP-FIFO) */
@ApiTags('Pengaturan')
@ApiBearerAuth()
@Controller('settings/inventory-method')
export class InventoryMethodController {
  constructor(private readonly svc: InventoryMethodService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u.tenantId);
  }

  @Put()
  @Roles('ADMIN')
  set(@CurrentUser() u: AuthUser, @Body() dto: InventoryMethodDto) {
    return this.svc.set(u, dto);
  }
}
