import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ConsignLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '24', description: 'Satuan dasar' }) @IsNumberString() qty: string;
}

export class ShipDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ description: 'Gudang biasa asal barang' }) @IsUUID() fromWarehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [ConsignLineDto] }) @ValidateNested({ each: true }) @Type(() => ConsignLineDto) @ArrayMinSize(1) @ArrayMaxSize(500) lines: ConsignLineDto[];
}

export class ReportLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ description: 'Kosong = satuan dasar' }) @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '6' }) @IsNumberString() qty: string;
}

export class ReportSoldDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: 'LP-OUTLET-0912', description: 'Nomor laporan penjualan dari outlet (unik per outlet)' }) @IsString() @MinLength(3) @MaxLength(60) reference: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [ReportLineDto] }) @ValidateNested({ each: true }) @Type(() => ReportLineDto) @ArrayMinSize(1) @ArrayMaxSize(500) lines: ReportLineDto[];
}

export class ReturnConsignDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ description: 'Gudang biasa tujuan' }) @IsUUID() toWarehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [ConsignLineDto] }) @ValidateNested({ each: true }) @Type(() => ConsignLineDto) @ArrayMinSize(1) @ArrayMaxSize(500) lines: ConsignLineDto[];
}

export class RejectDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class DocQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}
