import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class TermDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: 'Rebate pencapaian 2%' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: ['PCT_SALES', 'FIXED_MONTHLY'] }) @IsIn(['PCT_SALES', 'FIXED_MONTHLY']) kind: 'PCT_SALES' | 'FIXED_MONTHLY';
  @ApiProperty({ example: '2', description: 'PCT_SALES: persen penjualan neto; FIXED_MONTHLY: rupiah per bulan' }) @IsNumberString() value: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PeriodDto {
  @ApiProperty({ example: '2026-09' }) @Matches(PERIOD) period: string;
}

export class PeriodQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}

export class SettleDto {
  @ApiProperty({ enum: ['DEDUCT', 'PAY'], description: 'DEDUCT = potong tagihan outlet; PAY = bayar tunai ke outlet' }) @IsIn(['DEDUCT', 'PAY']) mode: 'DEDUCT' | 'PAY';
  @ApiProperty({ example: '500000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ description: 'Wajib untuk DEDUCT' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

export class VoidDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class GenerateClaimDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty({ example: '2026-09' }) @Matches(PERIOD) period: string;
}

export class DecideClaimDto {
  @ApiProperty({ example: '1500000', description: 'Jumlah yang disetujui prinsipal (0 = ditolak)' }) @IsNumberString() approvedAmount: string;
  @ApiPropertyOptional({ description: 'Nomor persetujuan/nota kredit dari prinsipal' }) @IsOptional() @IsString() @MaxLength(60) principalRef?: string;
}

export class ReceiveClaimDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
