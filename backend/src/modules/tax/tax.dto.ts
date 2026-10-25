import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TAX_PAYMENT_TYPES, type TaxPaymentType } from '@sansu/shared';

export class CreateTaxPaymentDto {
  @ApiProperty({ enum: TAX_PAYMENT_TYPES }) @IsIn(TAX_PAYMENT_TYPES) type: TaxPaymentType;
  @ApiProperty({ example: '2026-09', description: 'Masa pajak (PPh 29: YYYY-12)' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional({ example: '2026-10-10' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = sebesar kewajiban terhitung' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ description: 'Rekening pembayar; kosong = Bank' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ example: '123456789012345' }) @IsOptional() @IsString() @MaxLength(30) billingCode?: string;
  @ApiPropertyOptional({ example: 'A1B2C3D4E5F6G7H8' }) @IsOptional() @IsString() @MaxLength(30) ntpn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
