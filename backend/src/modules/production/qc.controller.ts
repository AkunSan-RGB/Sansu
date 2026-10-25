import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { QcService } from './qc.service';
import { QcPlanDto, DecideDto, ReworkDto, AttachmentDto, ScrapDto } from './qc.dto';
import { InspectionsQuery } from './qc.shared';

@ApiTags('Pengendalian mutu')
@ApiBearerAuth()
@RequireApp('inventory')
@Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
@Controller('qc')
export class QcController {
  constructor(private readonly svc: QcService) {}

  @Roles('ADMIN') @Post('setup') setup(@CurrentUser() u: AuthUser) { return this.svc.setup(u); }
  @Get('plans') plans(@CurrentUser() u: AuthUser) { return this.svc.plans(u.tenantId); }
  @Roles('ADMIN') @Put('plans/:productId') savePlan(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: QcPlanDto) { return this.svc.savePlan(u, productId, dto); }
  @Get('inspections') list(@CurrentUser() u: AuthUser, @Query() q: InspectionsQuery) { return this.svc.list(u.tenantId, q); }
  @Get('inspections/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('inspections/:id/decide') decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) { return this.svc.decide(u, id, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('inspections/:id/rework') rework(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReworkDto) { return this.svc.rework(u, id, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('inspections/:id/attachments') addAttachment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachmentDto) { return this.svc.addAttachment(u, id, dto); }
  @Get('inspections/:id/attachments/:attId') attachment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string) { return this.svc.attachment(u.tenantId, id, attId); }
  @Roles('ADMIN') @Delete('inspections/:id/attachments/:attId') removeAttachment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string) { return this.svc.removeAttachment(u, id, attId); }
  @Roles('ADMIN') @Post('inspections/:id/scrap') scrap(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScrapDto) { return this.svc.scrap(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}
