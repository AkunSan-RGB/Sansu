import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PosTabsService } from './pos-tabs.service';
import { WarehouseQueryDto, CreateTableDto, UpdateTableDto, TabQueryDto, CreateTabDto, AddTabLinesDto, VoidTabLineDto, CancelTabDto, MoveTabDto, PayTabDto, KitchenStatusDto } from './pos-tabs.dto';

@ApiTags('Meja & dapur')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN', 'ACCOUNTANT')
@Controller('pos')
export class PosTabsController {
  constructor(private readonly svc: PosTabsService) {}

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN', 'ACCOUNTANT')
  @Get('tables')
  tables(@CurrentUser() u: AuthUser, @Query() q: WarehouseQueryDto) {
    return this.svc.listTables(u, q);
  }
  @Post('tables')
  @Roles('ADMIN')
  createTable(@CurrentUser() u: AuthUser, @Body() dto: CreateTableDto) {
    return this.svc.createTable(u, dto);
  }
  @Patch('tables/:id')
  @Roles('ADMIN')
  updateTable(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.svc.updateTable(u, id, dto);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN', 'ACCOUNTANT')
  @Get('tabs')
  tabs(@CurrentUser() u: AuthUser, @Query() q: TabQueryDto) {
    return this.svc.list(u, q);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTabDto) {
    return this.svc.create(u, dto);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN', 'ACCOUNTANT')
  @Get('tabs/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs/:id/lines')
  addLines(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTabLinesDto) {
    return this.svc.addLines(u, id, dto);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs/:id/send')
  send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.send(u, id);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs/:id/lines/:lineId/void')
  voidLine(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: VoidTabLineDto) {
    return this.svc.voidLine(u, id, lineId, dto);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTabDto) {
    return this.svc.cancel(u, id, dto);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Patch('tabs/:id/move')
  move(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveTabDto) {
    return this.svc.move(u, id, dto);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('tabs/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayTabDto) {
    return this.svc.pay(u, id, dto);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN', 'ACCOUNTANT')
  @Get('kitchen')
  kitchen(@CurrentUser() u: AuthUser, @Query() q: WarehouseQueryDto) {
    return this.svc.kitchen(u, q);
  }
  @Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
  @Post('kitchen/lines/:lineId/status')
  status(@CurrentUser() u: AuthUser, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: KitchenStatusDto) {
    return this.svc.setLineStatus(u, lineId, dto.status);
  }
}
