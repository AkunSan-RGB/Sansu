import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
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
@Roles('ADMIN', 'FINANCE')
@Controller('accounting')
export class InsightsController {
  constructor(
    private readonly health: HealthService,
    private readonly fiscal: FiscalService,
    private readonly notes: NotesService,
    private readonly appendix: AppendixService,
    private readonly profile: EntityProfileService,
    private readonly thresholds: ThresholdsService,
  ) {}

  @Get('health')
  check(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.health.run(u.tenantId, isDocDate(asOf) ? asOf : undefined);
  }

  @Get('fiscal/:year')
  reconcile(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.fiscal.reconcile(u.tenantId, year);
  }
  @Put('fiscal/:year')
  saveYear(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Body() dto: FiscalYearDto) {
    return this.fiscal.saveYear(u.tenantId, year, dto);
  }
  @Post('fiscal/:year/adjustments')
  addAdjustment(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Body() dto: FiscalAdjustmentDto) {
    return this.fiscal.addAdjustment(u.tenantId, year, dto);
  }
  @Delete('fiscal/:year/adjustments/:id')
  removeAdjustment(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.removeAdjustment(u.tenantId, year, id);
  }
  @Post('fiscal/:year/journal')
  postTax(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.fiscal.postTax(u, year);
  }

  @Get('notes/:year')
  getNotes(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.notes.build(u.tenantId, year);
  }
  /** Peringatan ambang pajak: PKP, PPh final UMKM, Pasal 31E, kriteria UMKM */
  @Get('tax-thresholds')
  taxThresholds(@CurrentUser() u: AuthUser, @Query('asOf') asOf?: string) {
    return this.thresholds.evaluate(u.tenantId, isDocDate(asOf) ? asOf : undefined);
  }

  /** Wizard standar akuntansi & pajak: keadaan saat ini, ukuran usaha dari pembukuan, dan rekomendasi */
  @Get('entity-profile')
  entityProfile(@CurrentUser() u: AuthUser) {
    return this.profile.state(u.tenantId);
  }
  @Post('entity-profile/recommend')
  recommendProfile(@Body() dto: EntityAnswersDto) {
    return this.profile.recommend(dto);
  }
  @Post('entity-profile/apply')
  applyProfile(@CurrentUser() u: AuthUser, @Body() dto: ApplyEntityProfileDto) {
    return this.profile.apply(u, dto);
  }

  @Get('appendix/:year')
  getAppendix(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number) {
    return this.appendix.build(u.tenantId, year);
  }

  @Put('notes/:year/:key')
  saveNote(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('key') key: string, @Body() dto: NoteDto) {
    return this.notes.save(u.tenantId, year, key.slice(0, 40), dto.content);
  }
  @Delete('notes/:year/:key')
  resetNote(@CurrentUser() u: AuthUser, @Param('year', YearPipe) year: number, @Param('key') key: string) {
    return this.notes.reset(u.tenantId, year, key.slice(0, 40));
  }
}

@Module({
  imports: [AccountingModule, AssetsModule, FxModule],
  controllers: [InsightsController],
  providers: [HealthService, FiscalService, NotesService, AppendixService, EntityProfileService, ThresholdsService],
  exports: [FiscalService, HealthService, EntityProfileService, ThresholdsService],
})
export class InsightsModule {}
