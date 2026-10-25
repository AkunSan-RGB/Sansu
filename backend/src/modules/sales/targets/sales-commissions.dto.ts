import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CloseCommissionDto {
  @ApiProperty({ example: '2026-09', description: 'Bulan yang sudah berakhir' }) @Matches(PERIOD) period: string;
}

export class PayCommissionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: '0', description: 'PPh 21 yang dipotong dari komisi ini (bila ada); sisanya dibayar tunai' }) @IsOptional() @IsNumberString() pph21?: string;
}

export class VoidCommissionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class CommissionQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
}
