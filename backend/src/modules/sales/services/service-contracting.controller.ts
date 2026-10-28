import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { BoqProgressDto, ReleaseRetentionDto, SaveBoqDto } from './service-contracting.dto';
import { ServiceContractingService } from './service-contracting.service';

@ApiTags('Penjualan — kontraktor')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('services/projects/:id')
export class ServiceContractingController {
  constructor(private readonly svc: ServiceContractingService) {}

  @Get('retention')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  retention(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retentions(u.tenantId, id);
  }

  @Post('retention/release')
  @Roles('ADMIN', 'FINANCE')
  release(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseRetentionDto) {
    return this.svc.releaseRetention(u, id, dto);
  }

  @Get('boq')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  boq(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.boq(u.tenantId, id);
  }

  @Put('boq')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  saveBoq(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveBoqDto) {
    return this.svc.saveBoq(u, id, dto);
  }

  @Post('boq/progress')
  @Roles('ADMIN', 'FINANCE')
  boqProgress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BoqProgressDto) {
    return this.svc.boqProgress(u, id, dto);
  }
}
