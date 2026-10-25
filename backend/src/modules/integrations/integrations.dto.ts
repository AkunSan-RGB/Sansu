import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class IntegrationSettingsDto {
  @ApiPropertyOptional({ example: { PCS: 'UM.0021' } }) @IsOptional() @IsObject() coretaxUnits?: Record<string, string>;
}

export class MarketplaceLineDto {
  @ApiProperty({ example: 'MIE-GRG-85' }) @IsString() @MaxLength(60) sku: string;
  @ApiProperty({ example: '40' }) @IsNumberString() qty: string;
  @ApiProperty({ example: '3500', description: 'Harga satuan seperti di file marketplace' }) @IsNumberString() price: string;
}

export class MarketplaceOrderDto {
  @ApiProperty({ example: '240915ABCD1234' }) @IsString() @MaxLength(60) orderNo: string;
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() date: string;
  @ApiProperty({ type: [MarketplaceLineDto] }) @ValidateNested({ each: true }) @Type(() => MarketplaceLineDto) @ArrayMinSize(1) lines: MarketplaceLineDto[];
}

export class MarketplaceImportDto {
  @ApiProperty({ example: 'Shopee' }) @IsString() @MaxLength(40) channel: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: 'Harga di file sudah termasuk PPN', default: true }) @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @ApiProperty({ type: [MarketplaceOrderDto] })
  @ValidateNested({ each: true })
  @Type(() => MarketplaceOrderDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  orders: MarketplaceOrderDto[];
}

export class MarketplaceSettleDto {
  @ApiProperty({ example: 'Shopee' }) @IsString() @MaxLength(40) channel: string;
  @ApiProperty({ example: '2026-09-20' }) @IsDateString() date: string;
  @ApiProperty({ description: 'Rekening penerima pencairan' }) @IsUUID() cashAccountId: string;
  @ApiProperty({ example: '1250000', description: 'Dana yang benar-benar masuk ke rekening' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ description: 'Nomor pesanan yang dicairkan; kosong = semua faktur terbuka terlama sampai jumlahnya cukup' })
  @IsOptional()
  @IsString({ each: true })
  orderNos?: string[];
}
