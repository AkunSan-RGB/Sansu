import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { todayJakarta } from '../../common/utils/dates';
import { BankService } from './bank.service';
import { ImportStatementDto, MatchDto, MatchManyDto, ReasonDto, CreateFromLineDto, BankRuleDto, SignReconciliationDto } from './bank.dto';

@ApiTags('Rekonsiliasi bank')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('bank')
export class BankController {
  constructor(private readonly svc: BankService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements')
  list(@CurrentUser() u: AuthUser, @Query('cashAccountId') cashAccountId?: string) {
    return this.svc.list(u.tenantId, cashAccountId && /^[0-9a-f-]{36}$/.test(cashAccountId) ? cashAccountId : undefined);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('statements')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportStatementDto) {
    return this.svc.import(u, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('statements/:id/auto-match')
  autoMatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.autoMatch(u, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Delete('statements/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('reason') reason?: string) {
    return this.svc.remove(u, id, reason ?? '');
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('lines/:id/candidates')
  candidates(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidates(u.tenantId, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/match')
  match(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchDto) {
    return this.svc.match(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/match-many')
  matchMany(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchManyDto) {
    return this.svc.matchMany(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/unmatch')
  unmatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unmatch(u, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/ignore')
  ignore(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.ignore(u, id, dto.reason);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/create')
  createFromLine(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFromLineDto) {
    return this.svc.createFromLine(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reconciliation')
  reconciliation(@CurrentUser() u: AuthUser, @Query('cashAccountId', ParseUUIDPipe) cashAccountId: string, @Query('asOf') asOf?: string) {
    return this.svc.reconciliation(u.tenantId, cashAccountId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : todayJakarta());
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('rules')
  rules(@CurrentUser() u: AuthUser) {
    return this.svc.listRules(u.tenantId);
  }
  @Roles('ADMIN')
  @Post('rules/defaults')
  installDefaults(@CurrentUser() u: AuthUser) {
    return this.svc.installDefaultRules(u);
  }
  @Roles('ADMIN')
  @Post('rules')
  createRule(@CurrentUser() u: AuthUser, @Body() dto: BankRuleDto) {
    return this.svc.saveRule(u, dto);
  }
  @Roles('ADMIN')
  @Put('rules/:id')
  updateRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BankRuleDto) {
    return this.svc.saveRule(u, dto, id);
  }
  @Roles('ADMIN')
  @Delete('rules/:id')
  deleteRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeRule(u, id);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('signoffs')
  signoffs(@CurrentUser() u: AuthUser, @Query('cashAccountId') cashAccountId?: string) {
    return this.svc.listSignoffs(u.tenantId, cashAccountId && /^[0-9a-f-]{36}$/.test(cashAccountId) ? cashAccountId : undefined);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('signoffs')
  sign(@CurrentUser() u: AuthUser, @Body() dto: SignReconciliationDto) {
    return this.svc.sign(u, dto);
  }
}
