import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ONLINE_CHANNELS, type OnlineChannel, POS_ORDER_TYPES, type PosOrderType } from '@sansu/shared';
import { PosPaymentDto } from './pos.dto';

export class CreateTableDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ example: 'M05' }) @IsString() @MinLength(1) @MaxLength(20) code: string;
  @ApiProperty({ example: 'Meja 5' }) @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiPropertyOptional({ example: 4 }) @IsOptional() @IsInt() @Min(1) @Max(200) seats?: number;
}

export class UpdateTableDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) seats?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TabLineInputDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ example: 'Tanpa gula, es sedikit' }) @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class CreateTabDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional({ example: 'Meja 5', description: 'Label bebas bila tanpa meja (nama pemesan, nomor antrean)' }) @IsOptional() @IsString() @MaxLength(40) tableLabel?: string;
  @ApiPropertyOptional({ enum: POS_ORDER_TYPES }) @IsOptional() @IsIn(POS_ORDER_TYPES) orderType?: PosOrderType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) guestName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @ApiPropertyOptional({ enum: ONLINE_CHANNELS, description: 'Pesanan online dari platform; wajib disertai nomor pesanan platform' }) @IsOptional() @IsIn(ONLINE_CHANNELS) channel?: OnlineChannel;
  @ApiPropertyOptional({ example: 'GF-123456', description: 'Nomor pesanan di platform (unik per kanal)' }) @IsOptional() @IsString() @MinLength(1) @MaxLength(60) externalRef?: string;
  @ApiPropertyOptional({ type: [TabLineInputDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabLineInputDto) lines?: TabLineInputDto[];
}

export class AddTabLinesDto {
  @ApiProperty({ type: [TabLineInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabLineInputDto) lines: TabLineInputDto[];
}

export class VoidTabLineDto {
  @ApiPropertyOptional({ description: 'Wajib (min. 5 karakter) untuk menu yang sudah dikirim ke dapur' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class CancelTabDto {
  @ApiProperty({ description: 'Alasan (min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class MoveTabDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) tableLabel?: string;
}

export class PayTabDto {
  @ApiProperty() @IsUUID() sessionId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ type: [String], description: 'Baris yang dibayar sekarang (pisah bill); kosong = semua yang belum dibayar' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  lineIds?: string[];
  @ApiPropertyOptional({ type: [PosPaymentDto], description: 'Wajib untuk pesanan biasa; pesanan online otomatis dibayar platform' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments?: PosPaymentDto[];
}

export class KitchenStatusDto {
  @ApiProperty({ enum: ['PREPARING', 'READY', 'SERVED'] }) @IsIn(['PREPARING', 'READY', 'SERVED']) status: 'PREPARING' | 'READY' | 'SERVED';
}

export class TabQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'PAID', 'CANCELLED'] }) @IsOptional() @IsIn(['OPEN', 'PAID', 'CANCELLED']) status?: 'OPEN' | 'PAID' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}

export class WarehouseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
