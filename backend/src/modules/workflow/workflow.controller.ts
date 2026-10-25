import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type WorkflowLinkType } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { WorkflowService } from './workflow.service';
import { WorkflowSettingsDto, CaseQueryDto, CreateCaseDto, AddLinkDto, AdvanceDto, NoteDto } from './workflow.dto';

const ACT = ['ADMIN', 'FINANCE', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER'] as const;

@ApiTags('Alur kerja')
@ApiBearerAuth()
@Roles(...ACT, 'ACCOUNTANT')
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly svc: WorkflowService) {}

  @Get('pipelines')
  pipelines(@CurrentUser() u: AuthUser) {
    return this.svc.pipelines(u);
  }
  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.svc.getSettings(u);
  }
  @Roles('ADMIN')
  @Put('settings')
  saveSettings(@CurrentUser() u: AuthUser, @Body() dto: WorkflowSettingsDto) {
    return this.svc.saveSettings(u, dto);
  }
  @Get('cases')
  cases(@CurrentUser() u: AuthUser, @Query() q: CaseQueryDto) {
    return this.svc.list(u, q);
  }
  @Get('alerts')
  alerts(@CurrentUser() u: AuthUser) {
    return this.svc.alerts(u);
  }
  @Get('candidates')
  candidates(@CurrentUser() u: AuthUser, @Query('type') type: WorkflowLinkType) {
    return this.svc.candidates(u, type);
  }
  @Get('by-doc')
  byDoc(@CurrentUser() u: AuthUser, @Query('type') type: WorkflowLinkType, @Query('id', ParseUUIDPipe) id: string) {
    return this.svc.byDoc(u, type, id);
  }
  @Get('cases/:id')
  one(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles(...ACT)
  @Post('cases')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCaseDto) {
    return this.svc.create(u, dto);
  }
  @Roles(...ACT)
  @Post('cases/:id/links')
  async link(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddLinkDto) {
    await this.svc.addLink(u, id, dto);
    return this.svc.get(u, id);
  }
  @Roles(...ACT)
  @Post('cases/:id/advance')
  advance(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceDto) {
    return this.svc.advance(u, id, dto);
  }
  @Roles('ADMIN')
  @Post('cases/:id/back')
  back(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.svc.back(u, id, dto);
  }
  @Roles('ADMIN')
  @Post('cases/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.svc.cancel(u, id, dto);
  }
}
