import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const LOT_STATUSES = ['ALL', 'EXPIRED', 'SOON', 'WARNING'] as const;

export class LotQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: LOT_STATUSES, description: 'EXPIRED = sudah lewat, SOON = ≤ 7 hari, WARNING = ≤ 30 hari' }) @IsOptional() @IsIn(LOT_STATUSES) status?: (typeof LOT_STATUSES)[number];
}

export class TraceQueryDto {
  @ApiPropertyOptional() @IsUUID() productId: string;
  @ApiPropertyOptional({ example: 'MIE-2409A' }) @IsString() @MinLength(1) @MaxLength(40) lotNo: string;
}

export class DiscardLotDto {
  @ApiPropertyOptional({ example: 'Dibuang saat pengecekan pagi' }) @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
