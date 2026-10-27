import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SalesCommissionsService } from './sales-commissions.service';
import { CommissionQueryDto, CloseCommissionDto, PayCommissionDto, VoidCommissionDto } from './sales-commissions.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller('sales-commissions')
export class SalesCommissionsController {
  constructor(private readonly svc: SalesCommissionsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  list(@CurrentUser() u: AuthUser, @Query() q: CommissionQueryDto) {
    return this.svc.list(u, q.period);
  }
  @Post('close')
  @Roles('ADMIN', 'ACCOUNTANT')
  close(@CurrentUser() u: AuthUser, @Body() dto: CloseCommissionDto) {
    return this.svc.close(u, dto.period);
  }
  @Post(':id/pay')
  @Roles('FINANCE')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayCommissionDto) {
    return this.svc.pay(u, id, dto);
  }
  @Post(':id/void')
  @Roles('OWNER')
  voidIt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidCommissionDto) {
    return this.svc.voidIt(u, id, dto);
  }
}
