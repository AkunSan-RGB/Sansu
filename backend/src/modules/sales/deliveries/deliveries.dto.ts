import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

class DeliverLineDto {
  @ApiProperty() @IsUUID() orderLineId: string;
  @ApiProperty({ example: '10', description: 'Jumlah yang dihitung/dikemas Gudang' }) @IsNumberString() qty: string;
}

export class DeliverDto {
  @ApiPropertyOptional({ example: '2026-10-06', description: 'Tanggal kirim (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ type: () => [DeliverLineDto], description: 'Pengiriman buta: jumlah yang dikemas per baris (wajib bila pengiriman buta menyala untuk Gudang)' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DeliverLineDto)
  @ArrayMinSize(1)
  lines?: DeliverLineDto[];
}

export class CancelDeliveryDto {
  @ApiPropertyOptional({ description: 'Tanggal pembatalan (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Alasan pembatalan; wajib bila dibatalkan staf selain Pemilik/Admin' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class DeliveryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
