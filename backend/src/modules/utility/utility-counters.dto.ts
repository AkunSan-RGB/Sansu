import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CounterDto {
  @ApiProperty({ example: 'LKT-01' }) @IsString() @MinLength(2) @MaxLength(20) code: string;
  @ApiProperty({ example: 'Loket Kantor Pusat' }) @IsString() @MinLength(3) @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: 'Jl. Merdeka No. 1' }) @IsOptional() @IsString() @MaxLength(255) location?: string;
  @ApiPropertyOptional({ description: 'Rekening bank penerima pembayaran non-tunai di loket ini' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CloseDayDto {
  @ApiProperty() @IsUUID() counterId: string;
  @ApiProperty({ example: '2026-10-26' }) @IsDateString() date: string;
  @ApiPropertyOptional({ description: 'Tandai rekap berselisih dengan mutasi bank (wajib catatan)' }) @IsOptional() @IsBoolean() dispute?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
