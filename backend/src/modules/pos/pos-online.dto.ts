import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ONLINE_CHANNELS, type OnlineChannel } from '@sansu/shared';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Aplikasi pesanan GoFood' }) @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiProperty({ description: 'Outlet tujuan pesanan yang masuk lewat kunci ini' }) @IsUUID() warehouseId: string;
}

export class CommissionsDto {
  @ApiProperty({ example: { GOFOOD: 20, GRABFOOD: 20 }, description: 'Komisi (% dari harga menu sebelum pajak) per kanal, 0–50' })
  @IsObject()
  commissions: Record<string, number>;
}

export class InboundItemDto {
  @ApiProperty({ example: 'MN-KOPSU' }) @IsString() @MinLength(1) @MaxLength(40) sku: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class InboundOrderDto {
  @ApiProperty({ enum: ONLINE_CHANNELS }) @IsIn(ONLINE_CHANNELS) channel: OnlineChannel;
  @ApiProperty({ example: 'GF-123456', description: 'Nomor pesanan di platform; mengirim ulang nomor yang sama tidak membuat pesanan ganda' }) @IsString() @MinLength(1) @MaxLength(60) externalRef: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @ApiProperty({ type: [InboundItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InboundItemDto) items: InboundItemDto[];
}

export class UnsettledQueryDto {
  @ApiPropertyOptional({ enum: ONLINE_CHANNELS }) @IsOptional() @IsIn(ONLINE_CHANNELS) channel?: OnlineChannel;
}

export class CreateSettlementDto {
  @ApiProperty({ enum: ONLINE_CHANNELS }) @IsIn(ONLINE_CHANNELS) channel: OnlineChannel;
  @ApiPropertyOptional({ example: '2026-10-14' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Rekening bank penerima; kosong = Bank' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) orderIds: string[];
  @ApiProperty({ example: '1250000', description: 'Dana yang benar-benar masuk dari platform' }) @IsNumberString() received: string;
  @ApiPropertyOptional({ description: 'Wajib (min. 5 karakter) bila dana yang masuk berbeda dari seharusnya' }) @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
