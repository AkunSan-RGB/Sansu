import { assertAllBranches } from '../../common/auth/branch-access';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto, ToggleBranchesDto, AssignWarehouseDto } from './branches.dto';

@ApiTags('Cabang')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly svc: BranchesService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'CASHIER', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Get('report')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  report(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    assertAllBranches(u);
    return this.svc.report(u.tenantId, from, to);
  }

  @Get('balance-sheet')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  balanceSheet(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    assertAllBranches(u);
    return this.svc.balanceSheet(u.tenantId, asOf);
  }

  @Get('controls')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    assertAllBranches(u);
    return this.svc.controls(u.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBranchDto) {
    return this.svc.create(u, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.svc.update(u, id, dto);
  }

  @Put('feature')
  @Roles('ADMIN')
  feature(@CurrentUser() u: AuthUser, @Body() dto: ToggleBranchesDto) {
    return this.svc.setEnabled(u, dto.enabled);
  }

  @Put('accounts/:accountId')
  @Roles('ADMIN')
  assignAccount(@CurrentUser() u: AuthUser, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() dto: AssignWarehouseDto) {
    return this.svc.assignAccount(u, accountId, dto.branchId ?? null);
  }

  @Put('warehouses/:warehouseId')
  @Roles('ADMIN')
  assign(@CurrentUser() u: AuthUser, @Param('warehouseId', ParseUUIDPipe) warehouseId: string, @Body() dto: AssignWarehouseDto) {
    return this.svc.assignWarehouse(u, warehouseId, dto.branchId ?? null);
  }
}
