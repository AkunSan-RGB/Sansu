import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ADJUSTMENT_KINDS, type AdjustmentKind } from '@sansu/shared';
import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AdjustmentDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty({ enum: ADJUSTMENT_KINDS }) @IsIn(ADJUSTMENT_KINDS) kind: AdjustmentKind;
  @ApiPropertyOptional({ description: 'Jumlah pengurangan (termasuk PPN bila ada); kosong untuk pembatalan = seluruh sisa tagihan' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(500) reason: string;
}
export class DecideAdjustmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class RejectAdjustmentDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) note: string;
}
