import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { TradeService } from './trade.service';
import { PeriodQueryDto, TermDto, PeriodDto, SettleDto, VoidDto, GenerateClaimDto, DecideClaimDto, ReceiveClaimDto } from './trade.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller()
export class TradeController {
  constructor(private readonly svc: TradeService) {}

  @Get('trade-terms')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  terms(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.terms(u.tenantId, q.customerId);
  }
  @Post('trade-terms')
  @Roles('ADMIN')
  createTerm(@CurrentUser() u: AuthUser, @Body() dto: TermDto) {
    return this.svc.saveTerm(u, dto);
  }
  @Put('trade-terms/:id')
  @Roles('ADMIN')
  updateTerm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TermDto) {
    return this.svc.saveTerm(u, dto, id);
  }

  @Get('trade-accruals')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  accruals(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.accruals(u.tenantId, q);
  }
  @Post('trade-accruals/accrue')
  @Roles('ADMIN', 'ACCOUNTANT')
  accrue(@CurrentUser() u: AuthUser, @Body() dto: PeriodDto) {
    return this.svc.accrue(u, dto.period);
  }
  @Post('trade-accruals/:id/settle')
  @Roles('ADMIN', 'FINANCE')
  settle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleDto) {
    return this.svc.settle(u, id, dto);
  }
  @Post('trade-accruals/:id/void')
  @Roles('ADMIN')
  voidAccrual(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.svc.voidAccrual(u, id, dto.reason);
  }

  @Get('principal-claims')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  claims(@CurrentUser() u: AuthUser) {
    return this.svc.claims(u.tenantId);
  }
  @Get('principal-claims/:id')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  claim(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.claim(u.tenantId, id);
  }
  @Post('principal-claims/generate')
  @Roles('ADMIN', 'ACCOUNTANT')
  generate(@CurrentUser() u: AuthUser, @Body() dto: GenerateClaimDto) {
    return this.svc.generateClaim(u, dto);
  }
  @Post('principal-claims/:id/submit')
  @Roles('ADMIN', 'ACCOUNTANT')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitClaim(u, id);
  }
  @Post('principal-claims/:id/decide')
  @Roles('ADMIN', 'ACCOUNTANT')
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideClaimDto) {
    return this.svc.decideClaim(u, id, dto);
  }
  @Post('principal-claims/:id/receive')
  @Roles('ADMIN', 'FINANCE')
  receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveClaimDto) {
    return this.svc.receiveClaim(u, id, dto);
  }
}
