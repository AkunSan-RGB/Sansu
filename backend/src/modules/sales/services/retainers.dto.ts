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
}

export class RetainerUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsNumberString() monthlyFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ description: 'Alasan perubahan (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class RetainerBillDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD, { message: 'Periode berformat YYYY-MM' }) period: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
