import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ADJUSTMENT_REASONS, AdjustmentReason } from '@sansu/shared';


export class AdjustmentLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '120', description: 'Satuan dasar. Positif = tambah, negatif = kurangi' })
  @IsNumberString()
  qty: string;
  @ApiPropertyOptional({ example: '8500', description: 'Wajib jika qty positif' })
  @IsOptional()
  @IsNumberString()
  unitCost?: string;
  @ApiPropertyOptional({ example: 'LOT-2310A', description: 'Barang masuk: nomor lot' }) @IsOptional() @IsString() @MaxLength(40) lotNo?: string;
  @ApiPropertyOptional({ example: '2026-11-30', description: 'Barang masuk: tanggal kedaluwarsa' }) @IsOptional() @IsDateString() expiryDate?: string;
  @ApiPropertyOptional({ description: 'Barang keluar: kurangi hanya lot ini (membuang lot tertentu); kosong = lot yang paling cepat kedaluwarsa' }) @IsOptional() @IsUUID() lotId?: string;
}

export class StockAdjustmentDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ enum: ADJUSTMENT_REASONS }) @IsIn(ADJUSTMENT_REASONS) reason: AdjustmentReason;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [AdjustmentLineDto] })
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  @ArrayMinSize(1)
  lines: AdjustmentLineDto[];
}

export class StockQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
}
