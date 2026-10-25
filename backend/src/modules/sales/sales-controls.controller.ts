import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SalesControlsService } from './sales-controls.service';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('sales-controls')
export class SalesControlsController {
  constructor(private readonly svc: SalesControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}
