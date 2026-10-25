import { Body, Controller, Get, Put, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DEPRECIATION_METHODS } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AssetsService } from './assets.service';
import { CategoryDto, UpdateCategoryDto, RunDepreciationDto, AssetSettingsDto, RegisterFromJournalDto, CreateAssetDto, UpdateAssetDto, ChangeMethodDto, UsageDto, VerifyDto, TransferAssetBranchDto, DisposeDto } from './assets.dto';
import { AssetReportsService } from './asset-reports.service';
import { AssetDisposalService } from './asset-disposal.service';
import { AssetMethodService } from './asset-method.service';

export class MethodPreviewQuery {
  @ApiProperty() @IsIn(DEPRECIATION_METHODS.filter((m) => m !== 'NONE')) method: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveMonth?: string;
}

@ApiTags('Aset tetap')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('assets')
export class AssetsController {
  constructor(private readonly svc: AssetsService,
    private readonly assetReports: AssetReportsService,
    private readonly assetDisposal: AssetDisposalService,
    private readonly assetMethod: AssetMethodService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('categories')
  categories(@CurrentUser() u: AuthUser) {
    return this.svc.listCategories(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) {
    return this.svc.createCategory(u.tenantId, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('categories/:id')
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('depreciation/runs')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.runs(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('depreciation/run')
  run(@CurrentUser() u: AuthUser, @Body() dto: RunDepreciationDto) {
    return this.svc.run(u, dto.period);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/roll-forward')
  rollForward(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.assetReports.rollForward(u.tenantId, Number(year) || new Date().getFullYear());
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reports/fiscal')
  fiscal(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.assetReports.fiscalComparison(u.tenantId, Number(year) || new Date().getFullYear());
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.assetReports.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  assetSettings(@CurrentUser() u: AuthUser) {
    return this.svc.assetSettings(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Put('settings')
  saveAssetSettings(@CurrentUser() u: AuthUser, @Body() dto: AssetSettingsDto) {
    return this.svc.saveAssetSettings(u.tenantId, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('unregistered')
  unregistered(@CurrentUser() u: AuthUser) {
    return this.svc.unregistered(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('from-journal')
  fromJournal(@CurrentUser() u: AuthUser, @Body() dto: RegisterFromJournalDto) {
    return this.svc.registerFromJournal(u, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reconciliation')
  reconciliation(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.assetReports.reconciliation(u.tenantId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.svc.list(u.tenantId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssetDto) {
    return this.svc.create(u, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto) {
    return this.svc.update(u, id, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('categories/:id/change-method')
  changeCategoryMethod(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeMethodDto) {
    return this.assetMethod.changeCategoryMethod(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id/method-preview')
  methodPreview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MethodPreviewQuery) {
    return this.assetReports.methodPreview(u.tenantId, id, q.method, q.effectiveMonth);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id/usage')
  usage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assetMethod.usageList(u.tenantId, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put(':id/usage')
  setUsage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UsageDto) {
    return this.assetMethod.setUsage(u, id, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/change-method')
  changeMethod(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeMethodDto) {
    return this.assetMethod.changeMethod(u, id, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    return this.svc.verify(u, id, dto);
  }
  @Roles('ADMIN')
  @Post(':id/transfer-branch')
  transferBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferAssetBranchDto) {
    return this.assetDisposal.transferBranch(u, id, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post(':id/dispose')
  dispose(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeDto) {
    return this.assetDisposal.dispose(u, id, dto);
  }
}
