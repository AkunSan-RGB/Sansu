import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AccountingService } from './accounting.service';
import { StatementsService } from './statements.service';
import { AdjustmentsService } from './adjustments.service';
import { todayJakarta } from '../../common/utils/dates';
import {
  CloseYearDto,
  CreateAccountDto,
  CreateJournalDto,
  CreateRecurringDto,
  JournalQueryDto,
  LedgerQueryDto,
  PositionQueryDto,
  StatementQueryDto,
  UpdateAccountDto,
  UpdateRecurringDto,
  LockPeriodDto,
  OpeningBalanceDto,
  PeriodQueryDto,
  ReverseJournalDto,
} from './dto/accounting.dto';

@ApiTags('Akuntansi')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE')
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly svc: AccountingService,
    private readonly statements: StatementsService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  @Get('adjustments/checklist')
  adjustmentChecklist(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.adjustments.checklist(u.tenantId, p);
  }

  @Get('adjustments/summary')
  adjustmentSummary(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    const today = todayJakarta();
    return this.adjustments.summary(u.tenantId, q.from ?? `${today.slice(0, 4)}-01-01`, q.to ?? today);
  }

  @Get('accounts')
  listAccounts(@CurrentUser() u: AuthUser) {
    return this.svc.listAccounts(u.tenantId);
  }

  @Post('accounts')
  createAccount(@CurrentUser() u: AuthUser, @Body() dto: CreateAccountDto) {
    return this.svc.createAccount(u.tenantId, dto);
  }

  @Patch('accounts/:id')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.svc.updateAccount(u.tenantId, id, dto);
  }

  @Delete('accounts/:id')
  deleteAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteAccount(u.tenantId, id);
  }

  @Get('journals')
  listJournals(@CurrentUser() u: AuthUser, @Query() q: JournalQueryDto) {
    return this.svc.listJournals(u.tenantId, q);
  }

  // ---------- Jurnal berulang ----------
  @Get('recurring')
  recurring(@CurrentUser() u: AuthUser) {
    return this.svc.listRecurring(u.tenantId);
  }
  @Post('recurring')
  createRecurring(@CurrentUser() u: AuthUser, @Body() dto: CreateRecurringDto) {
    return this.svc.createRecurring(u, dto);
  }
  @Patch('recurring/:id')
  updateRecurring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurringDto) {
    return this.svc.updateRecurring(u, id, dto);
  }
  @Delete('recurring/:id')
  deleteRecurring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRecurring(u, id);
  }
  @Post('recurring/run')
  runRecurring(@CurrentUser() u: AuthUser) {
    return this.svc.runDue(u.tenantId, u.sub);
  }

  // ---------- Laporan keuangan SAK EP / SAK EMKM ----------
  @Get('statements/financial-position')
  financialPosition(@CurrentUser() u: AuthUser, @Query() q: PositionQueryDto) {
    return this.statements.financialPosition(u.tenantId, q.asOf, q.compareAsOf);
  }
  @Get('statements/income')
  income(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.income(u.tenantId, q, q.framework);
  }
  @Get('statements/equity')
  equity(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.equityChanges(u.tenantId, q);
  }
  @Get('statements/cash-flow')
  statementCashFlow(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.cashFlow(u.tenantId, q);
  }
  @Get('statements/trial-balance')
  fullTrialBalance(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.trialBalance(u.tenantId, q);
  }
  @Get('statements/worksheet')
  worksheet(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.worksheet(u.tenantId, q);
  }
  @Get('statements/framework')
  async framework(@CurrentUser() u: AuthUser) {
    return { framework: await this.statements.framework(u.tenantId) };
  }

  @Get('journals/:id')
  getJournal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getJournal(u.tenantId, id);
  }

  @Post('journals')
  createJournal(@CurrentUser() u: AuthUser, @Body() dto: CreateJournalDto) {
    return this.svc.createManualJournal(u, dto);
  }

  @Post('journals/:id/reverse')
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalDto) {
    return this.svc.reverseJournal(u, id, dto.date);
  }

  @Post('opening-balances')
  openingBalance(@CurrentUser() u: AuthUser, @Body() dto: OpeningBalanceDto) {
    return this.svc.openingBalance(u, dto);
  }

  @Get('period')
  period(@CurrentUser() u: AuthUser) {
    return this.svc.periodStatus(u.tenantId);
  }

  @Post('period/lock')
  lock(@CurrentUser() u: AuthUser, @Body() dto: LockPeriodDto) {
    return this.svc.lockPeriod(u, dto.until);
  }

  @Post('period/close-year')
  closeYear(@CurrentUser() u: AuthUser, @Body() dto: CloseYearDto) {
    return this.svc.closeYear(u, dto);
  }

  @Get('reports/trial-balance')
  trialBalance(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.trialBalance(u.tenantId, q.from, q.to);
  }

  @Get('reports/profit-loss')
  profitLoss(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.profitLoss(u.tenantId, q.from, q.to);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.balanceSheet(u.tenantId, q.to);
  }

  @Get('reports/ledger')
  ledger(@CurrentUser() u: AuthUser, @Query() q: LedgerQueryDto) {
    return this.svc.ledger(u.tenantId, q.accountId, q.from, q.to);
  }

  @Get('reports/cash-flow')
  cashFlow(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.cashFlow(u.tenantId, q.from, q.to);
  }

  @Get('reports/vat')
  vat(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.vatReport(u.tenantId, q.from, q.to);
  }
}
