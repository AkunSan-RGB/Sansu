import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class ReturnLineDto {
  @ApiProperty({ description: 'Id baris faktur asal' }) @IsUUID() invoiceLineId: string;
  @ApiProperty({ example: '1', description: 'Qty dalam satuan baris faktur' }) @IsNumberString() qty: string;
}

/** Dipakai untuk retur penjualan (invoiceId = faktur jual) dan retur pembelian (invoiceId = faktur beli) */
export class CreateReturnDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 'Kemasan rusak' }) @IsOptional() @IsString() @MaxLength(255) reason?: string;
  @ApiProperty({ type: [ReturnLineDto] })
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  @ArrayMinSize(1)
  lines: ReturnLineDto[];
}
