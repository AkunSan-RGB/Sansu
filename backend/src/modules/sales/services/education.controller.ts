import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { EduBillDto, EduClassDto, EduClassUpdateDto, EduEnrollDto, EduLeaveDto } from './education.dto';
import { EducationService } from './education.service';

@ApiTags('Pendidikan')
@ApiBearerAuth()
@RequireApp('sales')
// Sales (Jasa: "Pemasaran & kontrak") boleh melihat dan mendaftarkan peserta; menagih dan mengatur kelas tetap Admin/Keuangan
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('services/education')
export class EducationController {
  constructor(private readonly svc: EducationService) {}

  @Get('classes') classes(@CurrentUser() u: AuthUser) { return this.svc.classes(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('classes') createClass(@CurrentUser() u: AuthUser, @Body() dto: EduClassDto) { return this.svc.createClass(u, dto); }
  @Roles('ADMIN') @Put('classes/:id') updateClass(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EduClassUpdateDto) { return this.svc.updateClass(u, id, dto); }
  @Get('enrollments') enrollments(@CurrentUser() u: AuthUser, @Query('classId') classId?: string) { return this.svc.enrollments(u.tenantId, classId); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('enrollments') enroll(@CurrentUser() u: AuthUser, @Body() dto: EduEnrollDto) { return this.svc.enroll(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('enrollments/:id/leave') leave(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EduLeaveDto) { return this.svc.leave(u, id, dto); }
  @Get('due') due(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.due(u.tenantId, period); }
  @Roles('ADMIN', 'FINANCE') @Post('bill') bill(@CurrentUser() u: AuthUser, @Body() dto: EduBillDto) { return this.svc.bill(u, dto); }
}
