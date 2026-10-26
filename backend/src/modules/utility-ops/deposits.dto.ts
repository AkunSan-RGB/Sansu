import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DepositDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() connectionId?: string;
  @ApiProperty({ example: '500000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @ApiPropertyOptional({ description: 'Rekening penerima; kosong = bank utama' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class DepositOffsetDto {
  @ApiProperty({ description: 'Tagihan yang dilunasi dari jaminan' }) @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ description: 'Kosong = sebanyak mungkin' }) @IsOptional() @IsNumberString() amount?: string;
}
export class DepositRefundDto {
  @ApiPropertyOptional({ description: 'Kosong = seluruh sisa jaminan' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
