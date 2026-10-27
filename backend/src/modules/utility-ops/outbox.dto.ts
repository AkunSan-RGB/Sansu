import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';

export class OutboxItemDto { @ApiProperty() @IsUUID() connectionId: string }
export class OutboxEnqueueDto {
  @ApiProperty({ enum: ['REKENING', 'PENGINGAT', 'SP1', 'SP2', 'SP3'] }) @IsIn(['REKENING', 'PENGINGAT', 'SP1', 'SP2', 'SP3']) kind: 'REKENING' | 'PENGINGAT' | 'SP1' | 'SP2' | 'SP3';
  @ApiProperty({ enum: ['WHATSAPP', 'SMS'] }) @IsIn(['WHATSAPP', 'SMS']) channel: 'WHATSAPP' | 'SMS';
  @ApiPropertyOptional({ description: 'Periode rekening (YYYY-MM)' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period?: string;
  @ApiPropertyOptional({ type: [OutboxItemDto], description: 'Pelanggan yang dipilih; abaikan bila all = true' }) @IsOptional() @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => OutboxItemDto) items?: OutboxItemDto[];
  @ApiPropertyOptional({ description: 'Antrekan SEMUA penerima jenis surat ini (termasuk di luar 1.000 yang tampil)' }) @IsOptional() @IsBoolean() all?: boolean;
}
export class MessagingConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ example: 'https://api.penyedia-pesan.example/send' }) @IsOptional() @IsString() @MaxLength(300) url?: string;
  @ApiPropertyOptional({ example: 'Authorization' }) @IsOptional() @IsString() @MaxLength(60) authHeader?: string;
  @ApiPropertyOptional({ description: 'Kosong = tidak diubah' }) @IsOptional() @IsString() @MaxLength(300) token?: string;
  @ApiPropertyOptional({ example: '{"to":"{to}","message":"{message}"}', description: 'Badan permintaan JSON; {to} dan {message} diganti' }) @IsOptional() @IsString() @MaxLength(1000) bodyTemplate?: string;
}
export class TestSendDto { @ApiProperty() @IsString() @MaxLength(40) to: string }
