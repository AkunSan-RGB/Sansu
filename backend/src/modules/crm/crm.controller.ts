import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LEAD_STATUSES, type LeadStatus } from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CrmService } from './crm.service';
import { StageDto, CreateLeadDto, UpdateLeadDto, MarkLeadDto, CreateActivityDto, DoneActivityDto, QuotationQueryDto, CreateQuotationDto } from './crm.dto';

@ApiTags('CRM')
@ApiBearerAuth()
@RequireApp('crm')
@Roles('SALES', 'ADMIN')
@Controller('crm')
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @Get('profile')
  profile(@CurrentUser() u: AuthUser) {
    return this.svc.profile(u.tenantId);
  }
  @Get('stages')
  stages(@CurrentUser() u: AuthUser) {
    return this.svc.stages(u.tenantId);
  }
  @Roles('ADMIN')
  @Post('stages')
  addStage(@CurrentUser() u: AuthUser, @Body() dto: StageDto) {
    return this.svc.addStage(u.tenantId, dto);
  }
  @Roles('ADMIN')
  @Patch('stages/:id')
  renameStage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.svc.renameStage(u.tenantId, id, dto);
  }
  @Roles('ADMIN')
  @Delete('stages/:id')
  deleteStage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteStage(u.tenantId, id);
  }

  @Get('pipeline')
  pipeline(@CurrentUser() u: AuthUser, @Query('mine') mine?: string) {
    return this.svc.pipeline(u.tenantId, mine === '1' ? u.sub : undefined);
  }
  @Get('summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u.tenantId);
  }
  @Get('agenda')
  agenda(@CurrentUser() u: AuthUser) {
    return this.svc.myAgenda(u);
  }

  @Get('leads')
  leads(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.listLeads(u.tenantId, LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined);
  }
  @Get('leads/:id')
  lead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getLead(u.tenantId, id);
  }
  @Post('leads')
  createLead(@CurrentUser() u: AuthUser, @Body() dto: CreateLeadDto) {
    return this.svc.createLead(u, dto);
  }
  @Patch('leads/:id')
  updateLead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.svc.updateLead(u, id, dto);
  }
  @Post('leads/:id/mark')
  mark(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkLeadDto) {
    return this.svc.mark(u, id, dto);
  }

  @Post('activities')
  addActivity(@CurrentUser() u: AuthUser, @Body() dto: CreateActivityDto) {
    return this.svc.addActivity(u, dto);
  }
  @Post('activities/:id/done')
  done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DoneActivityDto) {
    return this.svc.doneActivity(u, id, dto);
  }

  @Get('quotations')
  quotations(@CurrentUser() u: AuthUser, @Query() q: QuotationQueryDto) {
    return this.svc.listQuotations(u.tenantId, q);
  }
  @Get('quotations/:id')
  quotation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getQuotation(u.tenantId, id);
  }
  @Post('quotations')
  createQuotation(@CurrentUser() u: AuthUser, @Body() dto: CreateQuotationDto) {
    return this.svc.createQuotation(u, dto);
  }
  @Post('quotations/:id/send')
  send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'SENT');
  }
  @Post('quotations/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'REJECTED');
  }
  @Post('quotations/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'CANCELLED');
  }
  @Post('quotations/:id/convert')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.convert(u, id);
  }
}
