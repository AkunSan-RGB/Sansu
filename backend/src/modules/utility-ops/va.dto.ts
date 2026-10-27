import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** Pembayaran masuk dari bank/penyedia pembayaran untuk satu nomor virtual account */
export class VaPaymentDto {
  @ApiProperty({ example: '880800000012', description: 'Nomor virtual account lengkap' }) @IsString() @MinLength(6) @MaxLength(40) vaNumber: string;
  @ApiProperty({ example: '132090' }) @IsNumberString() amount: string;
  @ApiProperty({ description: 'Referensi unik dari bank/penyedia; pengiriman ulang dengan referensi sama tidak menggandakan pembayaran' }) @IsString() @MinLength(3) @MaxLength(100) reference: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() paidAt?: string;
  @ApiPropertyOptional({ example: 'BCA' }) @IsOptional() @IsString() @MaxLength(40) channel?: string;
}
export class VaSettingsDto {
  @ApiPropertyOptional({ example: '8808', description: 'Kode perusahaan dari bank (angka)' }) @IsOptional() @Matches(/^\d{0,8}$/, { message: 'Kode perusahaan berupa angka, maksimal 8 digit' }) prefix?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) bankName?: string;
}
export class VaApplyDto {
  @ApiPropertyOptional({ description: 'Wajib untuk pembayaran yang nomornya tidak dikenal' }) @IsOptional() @IsUUID() connectionId?: string;
}
