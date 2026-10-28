import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class RetainerDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ example: 'Retainer konsultasi pajak' }) @IsString() @MinLength(3) @MaxLength(120) title: string;
  @ApiProperty({ example: '5000000' }) @IsNumberString() monthlyFee: string;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ description: 'Dikenai PPN (kosong = bawaan perusahaan)' }) @IsOptional() @IsBoolean() withVat?: boolean;
  @ApiPropertyOptional({ example: '20', description: 'Jam yang sudah termasuk dalam biaya bulanan; kosong = tanpa batas jam' }) @IsOptional() @IsNumberString() includedHours?: string;
  @ApiPropertyOptional({ example: '350000', description: 'Tarif per jam untuk kelebihan jam (wajib bila jam termasuk diisi)' }) @IsOptional() @IsNumberString() overageRate?: string;
}

export class RetainerUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsNumberString() monthlyFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Jam termasuk baru (berlaku untuk periode yang belum ditagih)' }) @IsOptional() @IsNumberString() includedHours?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() overageRate?: string;
  @ApiProperty({ description: 'Alasan perubahan (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class RetainerBillDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD, { message: 'Periode berformat YYYY-MM' }) period: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
