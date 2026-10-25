import { TaxFocusService } from './tax-focus';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { todayJakarta } from '../../common/utils/dates';
import { yearQuery } from '../../common/pipes/year.pipe';
import { TaxService } from './tax.service';
import { CreateTaxPaymentDto } from './tax.dto';

@ApiTags('Setoran pajak')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('tax')
export class TaxController {
  constructor(private readonly svc: TaxService, private readonly focusSvc: TaxFocusService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('focus')
  focus(@CurrentUser() u: AuthUser) {
    return this.focusSvc.focus(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('obligations')
  obligations(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.svc.obligations(u.tenantId, p);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/annual')
  annual(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.annualRecap(u.tenantId, yearQuery(year, Number(todayJakarta().slice(0, 4))));
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/withholding')
  withholding(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.svc.withholdingRecap(u.tenantId, p);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('payments')
  list(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.list(u.tenantId, yearQuery(year, undefined));
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('payments')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTaxPaymentDto) {
    return this.svc.create(u, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Delete('payments/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
}
