import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { PURCHASE_REQUEST_STATUSES, type PurchaseRequestStatus } from '../../db/schema';

export class PurchaseRequestLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ example: 'DUS' }) @IsOptional() @IsString() @MaxLength(20) uom?: string;
  @ApiProperty({ example: '10' }) @IsNumberString() @MaxLength(18) qty: string;
  @ApiPropertyOptional({ description: 'Supplier usulan; bisa ditentukan saat dijadikan PO' }) @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ example: '116000', description: 'Perkiraan harga beli per satuan, belum PPN' }) @IsOptional() @IsNumberString() @MaxLength(18) estPrice?: string;
}

export class CreatePurchaseRequestDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: '2026-10-10', description: 'Barang dibutuhkan paling lambat' }) @IsOptional() @IsDateString() neededBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'true = langsung diajukan (tanpa draft)' }) @IsOptional() @IsBoolean() submit?: boolean;
  @ApiProperty({ type: [PurchaseRequestLineDto] })
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  lines: PurchaseRequestLineDto[];
}

export class PurchaseRequestQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_REQUEST_STATUSES }) @IsOptional() @IsIn(PURCHASE_REQUEST_STATUSES) status?: PurchaseRequestStatus;
}

export class SuggestionQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}

export class DecisionNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ConvertLineDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ example: '116000' }) @IsOptional() @Matches(/^\d{1,15}(\.\d{1,2})?$/) price?: string;
}

export class ConvertPurchaseRequestDto {
  @ApiPropertyOptional({ example: '2026-10-03', description: 'Tanggal PO; default hari ini' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ type: [ConvertLineDto], description: 'Menimpa supplier / harga per baris' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ConvertLineDto)
  @ArrayMaxSize(500)
  lines?: ConvertLineDto[];
}
