import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CreateReturnDto } from './returns.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Retur')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE')
@Controller()
export class ReturnsController {
  constructor(private readonly svc: ReturnsService) {}

  @RequireApp('sales')
  @Get('sales-returns')
  listSales(@CurrentUser() u: AuthUser) {
    return this.svc.listSales(u.tenantId);
  }

  @RequireApp('sales')
  @Post('sales-returns')
  createSales(@CurrentUser() u: AuthUser, @Body() dto: CreateReturnDto) {
    return this.svc.createSales(u, dto);
  }

  @RequireApp('purchase')
  @Get('purchase-returns')
  listPurchase(@CurrentUser() u: AuthUser) {
    return this.svc.listPurchase(u.tenantId);
  }

  @RequireApp('purchase')
  @Post('purchase-returns')
  createPurchase(@CurrentUser() u: AuthUser, @Body() dto: CreateReturnDto) {
    return this.svc.createPurchase(u, dto);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
