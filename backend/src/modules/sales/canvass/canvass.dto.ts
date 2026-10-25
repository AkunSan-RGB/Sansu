import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class VanDto {
  @ApiProperty({ description: 'Pengguna berperan Sales pemilik mobil' }) @IsUUID() userId: string;
}

export class VanLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '48', description: 'Satuan dasar' }) @IsNumberString() qty: string;
}

export class VanMoveDto {
  @ApiProperty({ description: 'Gudang biasa (asal saat muat, tujuan saat bongkar)' }) @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [VanLineDto] }) @ValidateNested({ each: true }) @Type(() => VanLineDto) @ArrayMinSize(1) @ArrayMaxSize(500) lines: VanLineDto[];
}

export class CanvassLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '6' }) @IsNumberString() qty: string;
}

export class CollectDto {
  @ApiProperty({ example: '150000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
}

export class CanvassSaleDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional({ description: 'Mobil (hanya Admin; Sales memakai mobilnya sendiri)' }) @IsOptional() @IsUUID() vanId?: string;
  @ApiPropertyOptional({ description: 'Nomor PO outlet (wajib untuk outlet peritel modern)' }) @IsOptional() @IsString() @MaxLength(60) customerPoNo?: string;
  @ApiProperty({ type: [CanvassLineDto] }) @ValidateNested({ each: true }) @Type(() => CanvassLineDto) @ArrayMinSize(1) @ArrayMaxSize(200) lines: CanvassLineDto[];
  @ApiPropertyOptional({ description: 'Uang yang diterima di tempat (menunggu verifikasi Keuangan)' }) @IsOptional() @ValidateNested() @Type(() => CollectDto) collect?: CollectDto;
}

export class CollectionDto extends CollectDto {
  @ApiProperty() @IsUUID() invoiceId: string;
}

export class VerifyDto {
  @ApiProperty({ example: '150000', description: 'Uang yang benar-benar diterima Keuangan' }) @IsNumberString() receivedAmount: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

export class RejectCollectionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class RouteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiProperty() @IsUUID() salespersonId: string;
  @ApiPropertyOptional({ description: '1 = Senin … 7 = Minggu' }) @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [String], description: 'Outlet sesuai urutan kunjungan' }) @IsArray() @ArrayMaxSize(300) @IsUUID(undefined, { each: true }) customerIds: string[];
}

export class VisitDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() routeId?: string;
  @ApiProperty({ enum: ['ORDER', 'NO_ORDER', 'CLOSED'] }) @IsIn(['ORDER', 'NO_ORDER', 'CLOSED']) result: 'ORDER' | 'NO_ORDER' | 'CLOSED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ example: -6.2 }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: 106.8 }) @IsOptional() @IsLongitude() lng?: number;
}

export class SummaryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

export class CollectionQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'VERIFIED', 'REJECTED'] }) @IsOptional() @IsIn(['PENDING', 'VERIFIED', 'REJECTED']) status?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}
