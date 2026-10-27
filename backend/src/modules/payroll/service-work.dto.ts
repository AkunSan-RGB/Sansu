import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { WORK_UNITS } from '@sansu/shared';
import { PERIOD } from './service-work.shared';

const UNITS = WORK_UNITS;

export class CreateRateDto {
  @ApiProperty({ example: 'Konsultan senior — per jam' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: UNITS }) @IsIn(UNITS) unit: (typeof UNITS)[number];
  @ApiProperty({ example: '250000', description: 'Rupiah per satuan; untuk komisi = persen (1–100)' }) @IsNumberString() rate: string;
}

export class UpdateRateDto {
  @ApiPropertyOptional() @IsOptional() @IsNumberString() rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateEntryDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsUUID() rateId: string;
  @ApiPropertyOptional({ example: '2026-10-14', description: 'Default hari ini' }) @IsOptional() @IsDateString() workDate?: string;
  @ApiPropertyOptional({ example: '6.5', description: 'Jam / sesi / pekerjaan. Kosong untuk komisi.' }) @IsOptional() @IsNumberString() quantity?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Wajib untuk tarif komisi: faktur jasa yang sudah lunas' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional({ description: 'Tarif per hasil (pabrik): perintah produksi yang dikerjakan; jumlah hasil dibatasi keluaran perintah itu' }) @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class DecideEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class VoidEntryDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class EntryQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'VOID']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}
