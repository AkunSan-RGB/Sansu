import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PettyCashService } from './petty-cash.service';
import { PettyFundDto, PettyFundTopUpDto, PettyReplenishDto, PettyVoucherDto, PettyVoidDto } from './petty-cash.dto';

@ApiTags('Kas Kecil')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('cash')
@Controller('petty-cash')
export class PettyCashController {
  constructor(private readonly svc: PettyCashService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('funds')
  funds(@CurrentUser() u: AuthUser) {
    return this.svc.funds(u.tenantId);
  }
  @Roles('ADMIN')
  @Put('funds')
  saveFund(@CurrentUser() u: AuthUser, @Body() dto: PettyFundDto) {
    return this.svc.saveFund(u, dto);
  }
  @Roles('ADMIN')
  @Post('funds/:id/top-up')
  topUp(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PettyFundTopUpDto) {
    return this.svc.topUp(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('funds/:id/replenish')
  replenish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PettyReplenishDto) {
    return this.svc.replenish(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('vouchers')
  vouchers(@CurrentUser() u: AuthUser, @Query('fundId') fundId?: string, @Query('status') status?: string) {
    return this.svc.vouchers(u.tenantId, fundId, status);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('vouchers')
  createVoucher(@CurrentUser() u: AuthUser, @Body() dto: PettyVoucherDto) {
    return this.svc.createVoucher(u, dto);
  }
  @Roles('ADMIN')
  @Post('vouchers/:id/void')
  voidVoucher(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PettyVoidDto) {
    return this.svc.voidVoucher(u, id, dto);
  }
}
