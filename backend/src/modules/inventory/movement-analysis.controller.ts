import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { MovementAnalysisService } from './movement-analysis.service';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory')
export class MovementAnalysisController {
  constructor(private readonly svc: MovementAnalysisService) {}

  @Get('movement-analysis')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT')
  analyze(@CurrentUser() u: AuthUser) {
    return this.svc.analyze(u);
  }
}
