import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ShiftsService } from './shifts.service';
import { CreateTemplateDto, UpdateTemplateDto, RosterQueryDto, AssignDto } from './shifts.dto';

@ApiTags('Jadwal shift')
@ApiBearerAuth()
@RequireApp('hr')
@Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly svc: ShiftsService) {}

  @Get('staff')
  staff(@CurrentUser() u: AuthUser) {
    return this.svc.staff(u);
  }
  @Get('templates')
  templates(@CurrentUser() u: AuthUser) {
    return this.svc.templates(u);
  }
  @Roles('HR', 'ADMIN')
  @Post('templates')
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.svc.createTemplate(u, dto);
  }
  @Roles('HR', 'ADMIN')
  @Patch('templates/:id')
  updateTemplate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.updateTemplate(u, id, dto);
  }
  @Get('roster')
  roster(@CurrentUser() u: AuthUser, @Query() q: RosterQueryDto) {
    return this.svc.roster(u, q);
  }
  @Roles('HR', 'ADMIN')
  @Post('roster')
  assign(@CurrentUser() u: AuthUser, @Body() dto: AssignDto) {
    return this.svc.assign(u, dto);
  }
  @Roles('HR', 'ADMIN')
  @Delete('roster/:id')
  unassign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unassign(u, id);
  }
}
