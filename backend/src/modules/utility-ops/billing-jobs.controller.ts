import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { BillRunDto } from '../utility/utility.dto';
import { BillingJobsService } from './billing-jobs.service';

@ApiTags('Layanan air — tagih berlatar')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE')
@Controller('utility/billing/jobs')
export class BillingJobsController {
  constructor(private readonly svc: BillingJobsService) {}

  @Post() start(@CurrentUser() u: AuthUser, @Body() dto: BillRunDto) { return this.svc.start(u, dto.period); }
  @Get() recent(@CurrentUser() u: AuthUser) { return this.svc.recent(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
}
