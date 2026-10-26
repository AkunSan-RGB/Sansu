import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AssignDto, ComplaintDto, ComplaintStatusDto, NoteDto } from './complaints.dto';
import { ComplaintsService } from './complaints.service';

@ApiTags('Layanan air — pengaduan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE')
@Controller('utility/complaints')
export class ComplaintsController {
  constructor(private readonly svc: ComplaintsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('assigneeId') assigneeId?: string, @Query('q') q?: string, @Query('open') open?: string) { return this.svc.list(u.tenantId, { status, assigneeId, q, open }); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: ComplaintDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post(':id/assign') assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) { return this.svc.assign(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post(':id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ComplaintStatusDto) { return this.svc.setStatus(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post(':id/note') note(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) { return this.svc.addNote(u, id, dto); }
}
