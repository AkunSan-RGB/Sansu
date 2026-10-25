import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsIn, IsInt, IsNumberString, Min, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { POS_ORDER_TYPES, POS_PAYMENT_METHODS, type PosOrderType, type PosPaymentMethod } from '@sansu/shared';

export class OpenSessionDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: 'Akun kas laci; kosong = Kas' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Rekening QRIS/debit/transfer; kosong = Bank' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiProperty({ example: '500000', description: 'Modal awal di laci' }) @IsNumberString() openingCash: string;
}

export class CloseSessionDto {
  @ApiProperty({ example: '2350000', description: 'Uang tunai dihitung di laci' }) @IsNumberString() countedCash: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class PosLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ description: 'Kosong = harga jual master' }) @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discountPct?: string;
}

export class PosPaymentDto {
  @ApiProperty({ enum: POS_PAYMENT_METHODS }) @IsIn(POS_PAYMENT_METHODS) method: PosPaymentMethod;
  @ApiProperty({ example: '100000', description: 'Uang diterima (tunai boleh lebih, kembalian dihitung)' }) @IsNumberString() amount: string;
}

export class CreatePosOrderDto {
  @ApiProperty() @IsUUID() sessionId: string;
  @ApiPropertyOptional({ enum: POS_ORDER_TYPES, description: 'Jenis pesanan (usaha makanan & minuman): makan di tempat, bawa pulang, antar' }) @IsOptional() @IsIn(POS_ORDER_TYPES) orderType?: PosOrderType;
  @ApiPropertyOptional({ example: 'Meja 5', description: 'Nomor meja atau nama pemesan' }) @IsOptional() @IsString() @MaxLength(40) tableLabel?: string;
  @ApiPropertyOptional({ description: 'Pelanggan terdaftar (opsional)' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: 'Poin loyalitas yang ditukar menjadi potongan pembayaran (wajib bersama pelanggan terdaftar)' }) @IsOptional() @IsInt() @Min(1) redeemPoints?: number;
  @ApiProperty({ type: [PosLineDto] }) @ValidateNested({ each: true }) @Type(() => PosLineDto) @ArrayMinSize(1) lines: PosLineDto[];
  @ApiProperty({ type: [PosPaymentDto] }) @ValidateNested({ each: true }) @Type(() => PosPaymentDto) @ArrayMinSize(1) payments: PosPaymentDto[];
}

export class PosProductQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ description: 'Nama / SKU / barcode' }) @IsOptional() @IsString() q?: string;
}
