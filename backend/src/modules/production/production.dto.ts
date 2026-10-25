import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class BomLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '2.5', description: 'Kebutuhan per batch (satuan dasar), termasuk susut normal' })
  @IsNumberString()
  qty: string;
}

export class SaveBomDto {
  @ApiPropertyOptional({ description: 'Kosong = kode otomatis dari SKU produk' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;
  @ApiProperty({ example: 'Kemeja katun L' }) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '12', description: 'Hasil per batch (satuan dasar)' }) @IsNumberString() outputQty: string;
  @ApiPropertyOptional({ example: '120000', description: 'Upah langsung standar per batch' })
  @IsOptional()
  @IsNumberString()
  laborCost?: string;
  @ApiPropertyOptional({ example: '45000', description: 'Overhead pabrik standar per batch' })
  @IsOptional()
  @IsNumberString()
  overheadCost?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [BomLineDto] })
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  lines: BomLineDto[];
}

export class CreateProductionDto {
  @ApiProperty() @IsUUID() bomId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: '3', description: 'Jumlah batch' }) @IsNumberString() batches: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class IssueLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '7.5' }) @IsNumberString() qty: string;
}

export class StartProductionDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({
    type: [IssueLineDto],
    description: 'Bahan yang benar-benar dikeluarkan; kosong = sesuai resep',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines?: IssueLineDto[];
}

export class CompleteProductionDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: '35', description: 'Hasil baik (satuan dasar)' }) @IsNumberString() outputQty: string;
  @ApiPropertyOptional({ description: 'Upah langsung dibebankan; kosong = standar resep × batch' })
  @IsOptional()
  @IsNumberString()
  laborCost?: string;
  @ApiPropertyOptional({ description: 'Overhead dibebankan; kosong = standar resep × batch' })
  @IsOptional()
  @IsNumberString()
  overheadCost?: string;
}

export class CancelProductionDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
