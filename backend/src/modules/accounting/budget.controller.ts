import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { BudgetService } from './budget.service';
import { SaveBudgetDto, SeedBudgetDto, ReopenBudgetDto } from './budget.dto';

const yearOf = (y: number) => {
  if (y < 2000 || y > 2100) throw new BadRequestException('Tahun tidak valid');
  return y;
};

@ApiTags('Akuntansi')
@ApiBearerAuth()
@RequireApp('accounting')
@Controller('budgets')
export class BudgetController {
  constructor(private readonly svc: BudgetService) {}

  @Get('suggested')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  suggested(@CurrentUser() u: AuthUser) {
    return this.svc.suggested(u.tenantId);
  }

  @Get(':year')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  get(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number) {
    return this.svc.get(u.tenantId, yearOf(year));
  }

  @Get(':year/report')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  report(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number, @Query('month') month?: string) {
    return this.svc.report(u.tenantId, yearOf(year), month ? Number(month) : undefined);
  }

  @Put(':year')
  @Roles('ADMIN', 'ACCOUNTANT')
  save(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number, @Body() dto: SaveBudgetDto) {
    return this.svc.save(u, yearOf(year), dto);
  }

  @Post(':year/seed')
  @Roles('ADMIN', 'ACCOUNTANT')
  seed(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number, @Body() dto: SeedBudgetDto) {
    return this.svc.seed(u, yearOf(year), dto);
  }

  @Post(':year/approve')
  @Roles('ADMIN')
  approve(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number) {
    return this.svc.approve(u, yearOf(year));
  }

  @Post(':year/reopen')
  @Roles('ADMIN')
  reopen(@CurrentUser() u: AuthUser, @Param('year', ParseIntPipe) year: number, @Body() dto: ReopenBudgetDto) {
    return this.svc.reopen(u, yearOf(year), dto.reason);
  }
}
