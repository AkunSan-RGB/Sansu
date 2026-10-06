import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProductUomDto {
  @ApiProperty({ example: 'DUS' }) @IsString() @MaxLength(10) @Matches(/^[A-Z0-9]+$/) uom: string;
  @ApiProperty({ example: '24', description: 'Jumlah satuan dasar per satuan ini' }) @IsNumberString() factor: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'IDM-GRG-85' }) @IsString() @MaxLength(40) sku: string;
  @ApiProperty({ example: 'Mi Goreng 85g' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional({ example: 'Makanan' }) @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional({ example: 'PCS', default: 'PCS' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]+$/)
  baseUom?: string;
  @ApiProperty({ example: '3500', description: 'Harga jual per satuan dasar (belum PPN)' })
  @IsNumberString()
  sellPrice: string;
  @ApiPropertyOptional({ example: '8991234567890', description: 'Barcode / EAN untuk kasir' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  barcode?: string;
  @ApiPropertyOptional({ type: [ProductUomDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductUomDto)
  uoms?: ProductUomDto[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListQueryDto {
  @ApiPropertyOptional({ description: 'Cari kode/nama' }) @IsOptional() @IsString() q?: string;
}
