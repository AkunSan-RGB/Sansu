import { BadRequestException, Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { YearPipe } from '../../common/pipes/year.pipe';
import { isDocDate } from '../../common/utils/dates';
import { FxModule } from '../fx/fx.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsModule } from '../assets/assets.module';
import { FiscalService } from './fiscal.service';
import { HealthService } from './health.service';
import { AppendixService } from './appendix.service';
import { DEFAULT_THRESHOLDS, mergeThresholds } from './support-insights';
import { SUPPORT_KINDS, type SupportKind, SupportReportsService } from './support-reports';
import { ApplyEntityProfileDto, EntityAnswersDto, EntityProfileService } from './entity-profile.service';
import { NotesService } from './notes.service';
import { ThresholdsService } from './thresholds.service';

export class FiscalYearDto {
  @ApiPropertyOptional({ example: '0', description: 'Kompensasi kerugian fiskal tahun-tahun sebelumnya' }) @IsOptional() @IsNumberString() lossCarryforward?: string;
  @ApiPropertyOptional({ description: 'Peredaran bruto manual (null = otomatis)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  grossRevenueOverride?: string | null;
  @ApiPropertyOptional({ description: 'Biaya untuk penghasilan PPh final, manual (null = otomatis)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  finalCostOverride?: string | null;
}
export class FiscalAdjustmentDto {
  @ApiProperty({ example: 'Biaya natura tidak memenuhi syarat' }) @IsString() @MaxLength(200) description: string;
  @ApiProperty({ enum: ['POSITIVE', 'NEGATIVE'] }) @IsIn(['POSITIVE', 'NEGATIVE']) kind: 'POSITIVE' | 'NEGATIVE';
  @ApiProperty({ example: '2500000' }) @IsNumberString() amount: string;
}
export class NoteDto {
  @ApiProperty() @IsString() @MaxLength(20000) content: string;
}

@ApiTags('Analisis & pajak')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('accounting')
export class InsightsController {
  constructor(
    private readonly health: HealthService,
    private readonly fiscal: FiscalService,
    private readonly notes: NotesService,
    private readonly appendix: AppendixService,
    private readonly support: SupportReportsService,
    private readonly profile: EntityProfileService,
    private readonly thresholds: ThresholdsService,
  ) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('health')
  check(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.health.run(u.tenantId, isDocDate(asOf) ? asOf : undefined);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('fiscal/:year')
  reconcile(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.fiscal.reconcile(u.tenantId, year);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Put('fiscal/:year')
  saveYear(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Body() dto: FiscalYearDto) {
    return this.fiscal.saveYear(u.tenantId, year, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('fiscal/:year/adjustments')
  addAdjustment(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Body() dto: FiscalAdjustmentDto) {
    return this.fiscal.addAdjustment(u.tenantId, year, dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete('fiscal/:year/adjustments/:id')
  removeAdjustment(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.removeAdjustment(u.tenantId, year, id);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('fiscal/:year/journal')
  postTax(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.fiscal.postTax(u, year);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('notes/:year')
  getNotes(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.notes.build(u.tenantId, year);
  }
  /** Peringatan ambang pajak: PKP, PPh final UMKM, Pasal 31E, kriteria UMKM */
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('tax-thresholds')
  taxThresholds(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.thresholds.evaluate(u.tenantId, isDocDate(asOf) ? asOf : undefined);
  }

  /** Wizard standar akuntansi & pajak: keadaan saat ini, ukuran usaha dari pembukuan, dan rekomendasi */
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('entity-profile')
  entityProfile(@CurrentUser() u: AuthUser) {
    return this.profile.state(u.tenantId);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('entity-profile/recommend')
  recommendProfile(@Body() dto: EntityAnswersDto) {
    return this.profile.recommend(dto);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('entity-profile/apply')
  applyProfile(@CurrentUser() u: AuthUser, @Body() dto: ApplyEntityProfileDto) {
    return this.profile.apply(u, dto);
  }

  /** Laporan pendukung per bidang (penjualan, pembelian, persediaan, kas, lainnya) beserta pencocokan buku besar */
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('support/:kind')
  supportReport(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (!(SUPPORT_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Jenis laporan pendukung tidak dikenal');
    return this.support.build(u.tenantId, kind as SupportKind, isDocDate(from) ? from : undefined, isDocDate(to) ? to : undefined);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('appendix/:year')
  getAppendix(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.appendix.build(u.tenantId, year);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Put('notes/:year/:key')
  saveNote(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('key') key: string, @Body() dto: NoteDto) {
    return this.notes.save(u.tenantId, year, key.slice(0, 40), dto.content);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Delete('notes/:year/:key')
  resetNote(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('key') key: string) {
    return this.notes.reset(u.tenantId, year, key.slice(0, 40));
  }
}

/** Ambang yang dipakai kesimpulan otomatis laporan pendukung; diatur per perusahaan */
@ApiTags('Analisis & pajak')
@ApiBearerAuth()
@Controller('settings/support-insights')
export class SupportInsightsSettingsController {
  constructor(private readonly support: SupportReportsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  async get(@CurrentUser() u: AuthUser) {
    return { values: await this.support.thresholds(u.tenantId), defaults: DEFAULT_THRESHOLDS };
  }

  /** Mengubah sebagian atau seluruh ambang; kirim `reset: true` untuk kembali ke standar */
  @Roles('ADMIN', 'ACCOUNTANT')
  @Put()
  async put(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    const { reset, ...patch } = body ?? {};
    const current = reset === true ? DEFAULT_THRESHOLDS : await this.support.thresholds(u.tenantId);
    const { value, error } = mergeThresholds(current, patch);
    if (error) throw new BadRequestException(error);
    return { values: await this.support.saveThresholds(u.tenantId, value), defaults: DEFAULT_THRESHOLDS };
  }
}

@Module({
  imports: [AccountingModule, AssetsModule, FxModule],
  controllers: [InsightsController, SupportInsightsSettingsController],
  providers: [HealthService, FiscalService, NotesService, AppendixService, SupportReportsService, EntityProfileService, ThresholdsService],
  exports: [FiscalService, HealthService, EntityProfileService, ThresholdsService],
})
export class InsightsModule {}
