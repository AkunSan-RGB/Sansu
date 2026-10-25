import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { InventoryControlsService } from './inventory-controls.service';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory-controls')
export class InventoryControlsController {
  constructor(private readonly svc: InventoryControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}
