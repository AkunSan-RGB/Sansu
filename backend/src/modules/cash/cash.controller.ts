import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CashService } from './cash.service';
import { CreateForeignCashDto } from './foreign-cash-tx.dto';
import { ForeignCashTxService } from './foreign-cash-tx.service';
import { CashQueryDto, CashSettingsDto, CashEvidenceDto, VoidCashDto, CreateCashTxDto } from './cash.dto';

@ApiTags('Kas & Bank')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('cash')
@Controller('cash')
export class CashController {
  constructor(private readonly svc: CashService, private readonly foreignTx: ForeignCashTxService) {}

  /** Dipakai juga layar kasir untuk memilih laci kas & rekening QRIS */
  @Get('accounts')
  @Roles('ADMIN', 'FINANCE', 'CASHIER', 'ACCOUNTANT')
  @RequireApp('cash', 'pos')
  accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('counter-accounts')
  counter(@CurrentUser() u: AuthUser) {
    return this.svc.counterAccounts(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('transactions')
  list(@CurrentUser() u: AuthUser, @Query() q: CashQueryDto) {
    return this.svc.list(u.tenantId, q, u.branchIds);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('income-sources')
  incomeSources(@CurrentUser() u: AuthUser, @Query() q: CashQueryDto) {
    return this.svc.incomeSources(u.tenantId, q);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  cashSettings(@CurrentUser() u: AuthUser) {
    return this.svc.cashSettings(u.tenantId);
  }
  @Roles('ADMIN')
  @Put('settings')
  saveCashSettings(@CurrentUser() u: AuthUser, @Body() dto: CashSettingsDto) {
    return this.svc.saveCashSettings(u.tenantId, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('transactions/:id/evidence')
  evidence(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashEvidenceDto) {
    return this.svc.setEvidence(u, id, dto);
  }
  @Roles('OWNER')
  @Post('transactions/:id/void')
  void(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidCashDto) {
    return this.svc.void(u, id, dto);
  }

  @Roles('FINANCE')
  @Post('transactions')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCashTxDto) {
    return this.svc.create(u, dto);
  }

  /** Transaksi rekening valas: terima/bayar, beli/jual valas, pindah antar rekening valas */
  @Roles('FINANCE')
  @Post('foreign')
  createForeign(@CurrentUser() u: AuthUser, @Body() dto: CreateForeignCashDto) {
    return this.foreignTx.create(u, dto);
  }
}
