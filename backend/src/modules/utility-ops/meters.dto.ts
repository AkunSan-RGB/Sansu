import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { METER_STATUSES, type MeterStatus } from '@sansu/shared';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class MeterDto {
  @ApiProperty({ example: 'MTR-2026-0001' }) @IsString() @MinLength(2) @MaxLength(60) serial: string;
  @ApiPropertyOptional({ example: 'Itron' }) @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @ApiPropertyOptional({ example: '1/2"' }) @IsOptional() @IsString() @MaxLength(20) size?: string;
  @ApiPropertyOptional({ description: 'Tanggal tera terakhir; tera berikutnya dihitung 5 tahun sesudahnya' }) @IsOptional() @IsDateString() lastCalibratedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() initialReading?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class CalibrateDto {
  @ApiPropertyOptional({ description: 'Kosong = hari ini' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class MeterStatusDto {
  @ApiProperty({ enum: ['RUSAK', 'PENSIUN', 'STOK'] }) @IsIn(['RUSAK', 'PENSIUN', 'STOK']) status: Extract<MeterStatus, 'RUSAK' | 'PENSIUN' | 'STOK'>;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) note: string;
}
export class ReplaceMeterDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ description: 'Meter pengganti (harus berstatus di gudang)' }) @IsUUID() newMeterId: string;
  @ApiProperty({ enum: ['RUSAK', 'STOK', 'PENSIUN'], description: 'Keadaan meter lama setelah dilepas' }) @IsIn(['RUSAK', 'STOK', 'PENSIUN']) oldStatus: 'RUSAK' | 'STOK' | 'PENSIUN';
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export const METER_FILTER_STATUSES = METER_STATUSES;
