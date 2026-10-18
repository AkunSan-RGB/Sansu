import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CreateReturnDto } from './returns.dto';
import { ReturnsService } from './returns.service';
import { SwapsController, SwapsService } from './swaps';

@ApiTags('Retur')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller()
export class ReturnsController {
  constructor(private readonly svc: ReturnsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @RequireApp('sales')
  @Get('sales-returns')
  listSales(@CurrentUser() u: AuthUser) {
    return this.svc.listSales(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE')
  @RequireApp('sales')
  @Post('sales-returns')
  createSales(@CurrentUser() u: AuthUser, @Body() dto: CreateReturnDto) {
    return this.svc.createSales(u, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @RequireApp('purchase')
  @Get('purchase-returns')
  listPurchase(@CurrentUser() u: AuthUser) {
    return this.svc.listPurchase(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE')
  @RequireApp('purchase')
  @Post('purchase-returns')
  createPurchase(@CurrentUser() u: AuthUser, @Body() dto: CreateReturnDto) {
    return this.svc.createPurchase(u, dto);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [ReturnsController, SwapsController],
  providers: [ReturnsService, SwapsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
