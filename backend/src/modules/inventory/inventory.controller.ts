import { RequireApp } from '../../common/apps/app.guard';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { StockAdjustmentDto, StockQueryDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('balances')
  balances(@CurrentUser() u: AuthUser, @Query() q: StockQueryDto) {
    return this.svc.balances(u.tenantId, q, u);
  }

  @Get('moves')
  moves(@CurrentUser() u: AuthUser, @Query() q: StockQueryDto) {
    return this.svc.moves(u.tenantId, q, u);
  }

  @Post('adjustments')
  @Roles('ADMIN', 'WAREHOUSE')
  adjust(@CurrentUser() u: AuthUser, @Body() dto: StockAdjustmentDto) {
    return this.svc.adjust(u, dto);
  }
}
