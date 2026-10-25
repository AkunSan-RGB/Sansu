import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class PosReturnLineDto {
  @ApiProperty() @IsUUID() orderLineId: string;
  @ApiProperty({ example: '1' }) @IsNumberString() qty: string;
}

export class CreatePosReturnDto {
  @ApiPropertyOptional({ description: 'true = batalkan seluruh sisa transaksi (abaikan lines)' }) @IsOptional() @IsBoolean() all?: boolean;
  @ApiPropertyOptional({ type: [PosReturnLineDto] }) @IsOptional() @ValidateNested({ each: true }) @Type(() => PosReturnLineDto) @ArrayMinSize(1) lines?: PosReturnLineDto[];
  @ApiProperty({ description: 'Alasan retur (wajib, min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
  @ApiPropertyOptional({ enum: ['CASH', 'BANK'], description: 'Uang dikembalikan lewat laci kas atau rekening; kosong = ikut cara bayar asal' }) @IsOptional() @IsIn(['CASH', 'BANK']) refundMethod?: 'CASH' | 'BANK';
}
