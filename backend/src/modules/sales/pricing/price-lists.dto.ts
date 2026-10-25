import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class PriceListDto {
  @ApiProperty({ example: 'Grosir' }) @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class UpdatePriceListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PriceItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '1', description: 'Jumlah beli minimum (satuan dasar)' }) @IsNumberString() minQty: string;
  @ApiProperty({ example: '1200', description: 'Harga per satuan dasar' }) @IsNumberString() price: string;
}

export class ReplaceItemsDto {
  @ApiProperty({ type: [PriceItemDto] }) @IsArray() @ArrayMaxSize(3000) @ValidateNested({ each: true }) @Type(() => PriceItemDto) items: PriceItemDto[];
}

export class PromoDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: ['DISCOUNT', 'BONUS'] }) @IsIn(['DISCOUNT', 'BONUS']) kind: 'DISCOUNT' | 'BONUS';
  @ApiPropertyOptional({ description: 'Produk pemicu; kosong = semua produk (hanya potongan)' }) @IsOptional() @IsUUID() productId?: string;
  @ApiProperty({ example: '10' }) @IsNumberString() minQty: string;
  @ApiPropertyOptional({ example: '5' }) @IsOptional() @IsNumberString() discountPct?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bonusProductId?: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsNumberString() bonusQty?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceListId?: string;
  @ApiPropertyOptional({ description: 'Prinsipal yang ikut menanggung biaya promo (dasar klaim)' }) @IsOptional() @IsUUID() fundedSupplierId?: string;
  @ApiPropertyOptional({ example: '50', description: 'Persen biaya promo yang ditanggung prinsipal' }) @IsOptional() @IsNumberString() fundedPct?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QuoteLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty() @IsNumberString() qty: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discountPct?: string;
}

export class QuoteDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() applyPromos?: boolean;
  @ApiProperty({ type: [QuoteLineDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
}
