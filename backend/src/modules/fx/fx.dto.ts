import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertRateDto {
  @ApiProperty({ example: 'USD' }) @IsString() @Matches(/^[A-Z]{3}$/) currency: string;
  @ApiProperty({ example: '16250.5', description: 'Rupiah per 1 satuan mata uang asing' }) @IsNumberString() rate: string;
  @ApiPropertyOptional({ example: '2026-10-03', description: 'Kosong = hari ini' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 'Kurs JISDOR BI' }) @IsOptional() @IsString() @MaxLength(120) note?: string;
}

export class RevaluationDto {
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Tanggal penilaian (akhir periode); kosong = hari ini' }) @IsOptional() @IsDateString() date?: string;
}

export class RateQueryDto {
  @ApiPropertyOptional({ example: 'USD' }) @IsOptional() @IsString() currency?: string;
}

export class ExposureQueryDto {
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() date?: string;
}
