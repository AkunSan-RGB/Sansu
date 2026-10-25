import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { EmploymentService } from './employment.service';
import { ChangeQueryDto, DecideChangeDto, RejectChangeDto } from './employment.dto';

@ApiTags('SDM — jasa')
@ApiBearerAuth()
@RequireApp('hr')
@Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('hr/employment')
export class EmploymentController {
  constructor(private readonly svc: EmploymentService) {}

  @Get('changes')
  changes(@CurrentUser() u: AuthUser, @Query() q: ChangeQueryDto) {
    return this.svc.listChanges(u, q);
  }
  @Get('alerts')
  alerts(@CurrentUser() u: AuthUser) {
    return this.svc.alerts(u);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('changes/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideChangeDto) {
    return this.svc.approveChange(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('changes/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectChangeDto) {
    return this.svc.rejectChange(u, id, dto);
  }
  @Roles('HR')
  @Post('changes/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelChange(u, id);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('employees/:id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.verify(u, id);
  }
}
