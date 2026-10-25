import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PurchaseControlsService } from './purchase-controls.service';

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('purchase-controls')
export class PurchaseControlsController {
  constructor(private readonly svc: PurchaseControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}
