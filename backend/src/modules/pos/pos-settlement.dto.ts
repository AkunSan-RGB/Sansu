import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { type CardSettlementSettings } from '@sansu/shared';
import { METHODS } from './pos-settlement.shared';

export class CardSettingsDto implements CardSettlementSettings {
  @ApiProperty({ example: 0.7 }) @IsNumber() @Min(0) @Max(10) qrisPct: number;
  @ApiProperty({ example: 1 }) @IsNumber() @Min(0) @Max(10) debitPct: number;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(30) lateAfterDays: number;
  @ApiProperty({ example: 5000 }) @IsNumber() @Min(0) @Max(10_000_000) toleranceRp: number;
}

export class BankReceiptDto {
  @ApiProperty() @IsUUID() bankAccountId: string;
  @ApiProperty({ example: '1985000' }) @IsNumberString() received: string;
}

export class SettleDto {
  @ApiProperty({ enum: METHODS }) @IsIn(METHODS) method: 'QRIS' | 'DEBIT';
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID('all', { each: true }) paymentIds: string[];
  @ApiPropertyOptional({ type: [String], description: 'Retur non-tunai (refund lewat rekening) yang dipotongkan penyelenggara dari pencairan ini' }) @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) returnIds?: string[];
  @ApiPropertyOptional({ example: '1985000', description: 'Uang bersih yang benar-benar masuk menurut rekening koran (satu rekening)' }) @IsOptional() @IsNumberString() received?: string;
  @ApiPropertyOptional({ type: [BankReceiptDto], description: 'Wajib bila pembayaran/retur menyangkut lebih dari satu rekening bank: uang masuk per rekening' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BankReceiptDto) bankReceipts?: BankReceiptDto[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Wajib bila ada selisih dari perhitungan MDR kontrak' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class CancelSettleDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
