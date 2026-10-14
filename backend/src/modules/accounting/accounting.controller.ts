import { scopeBranch } from '../../common/auth/branch-access';
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
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly svc: AccountingService,
    private readonly statements: StatementsService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('adjustments/checklist')
  adjustmentChecklist(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.adjustments.checklist(u.tenantId, p);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('adjustments/summary')
  adjustmentSummary(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    const today = todayJakarta();
    return this.adjustments.summary(u.tenantId, q.from ?? `${today.slice(0, 4)}-01-01`, q.to ?? today);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('accounts')
  listAccounts(@CurrentUser() u: AuthUser) {
    return this.svc.listAccounts(u.tenantId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('accounts')
  createAccount(@CurrentUser() u: AuthUser, @Body() dto: CreateAccountDto) {
    return this.svc.createAccount(u.tenantId, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('accounts/:id')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.svc.updateAccount(u.tenantId, id, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete('accounts/:id')
  deleteAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteAccount(u.tenantId, id);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('journals')
  listJournals(@CurrentUser() u: AuthUser, @Query() q: JournalQueryDto) {
    return this.svc.listJournals(u.tenantId, q, u.branchIds);
  }

  // ---------- Jurnal berulang ----------
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('recurring')
  recurring(@CurrentUser() u: AuthUser) {
    return this.svc.listRecurring(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('recurring')
  createRecurring(@CurrentUser() u: AuthUser, @Body() dto: CreateRecurringDto) {
    return this.svc.createRecurring(u, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('recurring/:id')
  updateRecurring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurringDto) {
    return this.svc.updateRecurring(u, id, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete('recurring/:id')
  deleteRecurring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRecurring(u, id);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('recurring/run')
  runRecurring(@CurrentUser() u: AuthUser) {
    return this.svc.runDue(u.tenantId, u.sub);
  }

  // ---------- Laporan keuangan SAK EP / SAK EMKM ----------
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/financial-position')
  financialPosition(@CurrentUser() u: AuthUser, @Query() q: PositionQueryDto) {
    return this.statements.financialPosition(u.tenantId, q.asOf, q.compareAsOf, scopeBranch(u, q.branchId));
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/income')
  income(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.income(u.tenantId, { ...q, branchId: scopeBranch(u, q.branchId) }, q.framework);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/equity')
  equity(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.equityChanges(u.tenantId, { ...q, branchId: scopeBranch(u, q.branchId) });
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/cash-flow')
  statementCashFlow(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.cashFlow(u.tenantId, { ...q, branchId: scopeBranch(u, q.branchId) });
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/trial-balance')
  fullTrialBalance(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.trialBalance(u.tenantId, { ...q, branchId: scopeBranch(u, q.branchId) });
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/worksheet')
  worksheet(@CurrentUser() u: AuthUser, @Query() q: StatementQueryDto) {
    return this.statements.worksheet(u.tenantId, { ...q, branchId: scopeBranch(u, q.branchId) });
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/framework')
  async framework(@CurrentUser() u: AuthUser) {
    return { framework: await this.statements.framework(u.tenantId) };
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('journals/:id')
  getJournal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getJournal(u.tenantId, id, u.branchIds);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('journals/:id/document')
  journalDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.journalDocument(u.tenantId, id, u.branchIds);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('journals')
  createJournal(@CurrentUser() u: AuthUser, @Body() dto: CreateJournalDto) {
    return this.svc.createManualJournal(u, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete('journals/:id/scheduled-reversal')
  cancelScheduledReversal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelScheduledReversal(u, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('journals/:id/reverse')
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalDto) {
    return this.svc.reverseJournal(u, id, dto.date);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('opening-balances/status')
  openingStatus(@CurrentUser() u: AuthUser) {
    return this.svc.openingStatus(u.tenantId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('opening-balances')
  openingBalance(@CurrentUser() u: AuthUser, @Body() dto: OpeningBalanceDto) {
    return this.svc.openingBalance(u, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('period')
  period(@CurrentUser() u: AuthUser) {
    return this.svc.periodStatus(u.tenantId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('period/lock')
  lock(@CurrentUser() u: AuthUser, @Body() dto: LockPeriodDto) {
    return this.svc.lockPeriod(u, dto.until);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('period/close-year')
  closeYear(@CurrentUser() u: AuthUser, @Body() dto: CloseYearDto) {
    return this.svc.closeYear(u, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/trial-balance')
  trialBalance(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.trialBalance(u.tenantId, q.from, q.to, scopeBranch(u, q.branchId));
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/profit-loss')
  profitLoss(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.profitLoss(u.tenantId, q.from, q.to);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/balance-sheet')
  balanceSheet(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.balanceSheet(u.tenantId, q.to);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/ledger')
  ledger(@CurrentUser() u: AuthUser, @Query() q: LedgerQueryDto) {
    return this.svc.ledger(u.tenantId, q.accountId, q.from, q.to, q.limit, scopeBranch(u, q.branchId));
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/cash-flow')
  cashFlow(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.cashFlow(u.tenantId, q.from, q.to);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/vat')
  vat(@CurrentUser() u: AuthUser, @Query() q: PeriodQueryDto) {
    return this.svc.vatReport(u.tenantId, q.from, q.to);
  }
}
