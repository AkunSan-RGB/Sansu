import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsInt,
  Max,
  Min,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FISCAL_TREATMENTS, type FiscalTreatment, REPORTING_FRAMEWORKS, type ReportingFramework, RECURRING_FREQUENCIES, type RecurringFrequency, REPORT_GROUP_KEYS, type ReportGroup } from '@sansu/shared';
import { PartialType } from '@nestjs/swagger';
import { AccountType, accountTypeEnum } from '../../../db/schema';

export class CreateAccountDto {
  @ApiProperty({ example: '6-2100' }) @IsString() @MaxLength(20) code: string;
  @ApiProperty({ example: 'Beban Listrik' }) @IsString() @MaxLength(120) name: string;
  @ApiProperty({ enum: accountTypeEnum.enumValues }) @IsIn(accountTypeEnum.enumValues) type: AccountType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional({ description: 'Tandai sebagai akun kas / rekening bank' }) @IsOptional() @IsBoolean() isCashAccount?: boolean;
  @ApiPropertyOptional({ enum: REPORT_GROUP_KEYS, description: 'Kelompok penyajian laporan keuangan' }) @IsOptional() @IsIn(REPORT_GROUP_KEYS) reportGroup?: ReportGroup;
  @ApiPropertyOptional({ enum: FISCAL_TREATMENTS }) @IsOptional() @IsIn(FISCAL_TREATMENTS) fiscalTreatment?: FiscalTreatment;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: REPORT_GROUP_KEYS }) @IsOptional() @IsIn(REPORT_GROUP_KEYS) reportGroup?: ReportGroup;
  @ApiPropertyOptional({ enum: FISCAL_TREATMENTS }) @IsOptional() @IsIn(FISCAL_TREATMENTS) fiscalTreatment?: FiscalTreatment;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class JournalLineDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional({ example: '150000' }) @IsOptional() @IsNumberString() debit?: string;
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() credit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional({ description: 'Proyek (biaya langsung proyek, usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
}

export class CreateJournalDto {
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: 'Bayar sewa gudang Oktober' }) @IsString() @MaxLength(255) description: string;
  @ApiPropertyOptional({ example: 'KW-0012', description: 'Nomor bukti transaksi' }) @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @ApiPropertyOptional({ description: 'Jurnal penyesuaian akhir periode' }) @IsOptional() @IsBoolean() adjustment?: boolean;
  @ApiPropertyOptional({ description: 'Hanya Pemilik: alasan mengecualikan larangan akun kontrol (piutang, hutang, persediaan, aset tetap, kas kecil); min. 10 karakter' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  controlOverrideReason?: string;
  @ApiPropertyOptional({ description: 'Hanya jurnal penyesuaian: dibalik otomatis pada tanggal 1 bulan berikutnya (akrual), tanpa membalik manual' })
  @IsOptional()
  @IsBoolean()
  autoReverse?: boolean;
  @ApiPropertyOptional({ description: 'true = tetap simpan walau ada jurnal serupa (peringatan pencatatan ganda sudah dikonfirmasi)' })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
  @ApiPropertyOptional({ description: 'Cabang untuk seluruh baris jurnal ini; kosong = pusat' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
  @ApiPropertyOptional({ description: 'Hanya Pemilik: alasan menembus blokir anggaran (min. 10 karakter)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  budgetOverrideReason?: string;
  @ApiProperty({ type: [JournalLineDto] })
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  @ArrayMinSize(2)
  lines: JournalLineDto[];
}

export class ReverseJournalDto {
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
}

export class PeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
}

export class LedgerQueryDto extends PeriodQueryDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional({ description: 'Batas baris yang ditampilkan (default 5000, maks 20000); total dan saldo akhir tetap dari seluruh data' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  limit?: number;
}

export class OpeningBalanceDto {
  @ApiProperty({ example: '2026-09-30', description: 'Tanggal saldo awal (biasanya akhir bulan sebelum mulai memakai SANSU)' })
  @IsDateString()
  date: string;
  @ApiProperty({ type: [JournalLineDto] })
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  @ArrayMinSize(1)
  lines: JournalLineDto[];
}

export class LockPeriodDto {
  @ApiProperty({ example: '2026-09-30', description: 'Kunci semua transaksi sampai tanggal ini' }) @IsDateString() until: string;
}

export class CloseYearDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year: number;
  @ApiPropertyOptional({ default: true, description: 'Sekaligus kunci periode sampai 31 Desember' })
  @IsOptional()
  @IsBoolean()
  lock?: boolean;
}

export class JournalQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'Jenis sumber jurnal, mis. MANUAL, ADJUSTMENT' }) @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional({ description: 'Cari nomor / keterangan / bukti' }) @IsOptional() @IsString() q?: string;
}

export class StatementQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'Pembanding: awal periode' }) @IsOptional() @IsDateString() compareFrom?: string;
  @ApiPropertyOptional({ description: 'Pembanding: akhir periode' }) @IsOptional() @IsDateString() compareTo?: string;
  @ApiPropertyOptional({ enum: REPORTING_FRAMEWORKS }) @IsOptional() @IsIn(REPORTING_FRAMEWORKS) framework?: ReportingFramework;
  @ApiPropertyOptional({ enum: ['indirect', 'direct'] }) @IsOptional() @IsIn(['indirect', 'direct']) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) hideZero?: string;
}

export class PositionQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() asOf?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() compareAsOf?: string;
}

export class RecurringLineDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() debit?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() credit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
  @ApiPropertyOptional({ description: 'Proyek (biaya langsung proyek, usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
}

export class CreateRecurringDto {
  @ApiProperty({ example: 'Amortisasi sewa gudang' }) @IsString() @MaxLength(120) name: string;
  @ApiProperty({ example: 'Amortisasi sewa dibayar dimuka' }) @IsString() @MaxLength(255) description: string;
  @ApiProperty({ enum: RECURRING_FREQUENCIES }) @IsIn(RECURRING_FREQUENCIES) frequency: RecurringFrequency;
  @ApiProperty({ example: '2026-10-31' }) @IsDateString() nextDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsInt() @Min(1) @Max(600) remaining?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isAdjustment?: boolean;
  @ApiProperty({ type: [RecurringLineDto] }) @ValidateNested({ each: true }) @Type(() => RecurringLineDto) @ArrayMinSize(2) lines: RecurringLineDto[];
}
export class UpdateRecurringDto extends PartialType(CreateRecurringDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
