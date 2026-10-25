import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AccountingControlsService } from './accounting-controls.service';

@ApiTags('Analisis & pajak')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('accounting-controls')
export class AccountingControlsController {
  constructor(private readonly svc: AccountingControlsService) {}

  @Get()
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}
