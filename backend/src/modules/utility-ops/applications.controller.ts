import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ActivateDto, ApplicationDto, CloseApplicationDto, InstallDto, QuoteDto, SurveyDto } from './applications.dto';
import { ApplicationsService } from './applications.service';

@ApiTags('Layanan air — permohonan sambungan baru')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE')
@Controller('utility/applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('q') q?: string) { return this.svc.list(u.tenantId, { status, q }); }
  @Get('counts') counts(@CurrentUser() u: AuthUser) { return this.svc.counts(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: ApplicationDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE') @Post(':id/survey') survey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SurveyDto) { return this.svc.survey(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post(':id/quote') quote(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDto) { return this.svc.quote(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post(':id/install') install(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InstallDto) { return this.svc.install(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/activate') activate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivateDto) { return this.svc.activate(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post(':id/close') close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseApplicationDto) { return this.svc.close(u, id, dto); }
}
