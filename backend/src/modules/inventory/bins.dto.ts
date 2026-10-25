import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CREATABLE_KINDS } from './bins.shared';

const MAX_BATCH = 200;

const MAX_IMPORT = 2000;

export class BinWarehouseDto {
  @ApiProperty() @IsUUID() warehouseId: string;
}

export class CreateBinsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ example: ['A-01-01', 'A-01-02'], description: 'Kode rak; huruf besar, angka, titik, garis, garis miring (maks 30 karakter)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BATCH) @IsString({ each: true }) codes: string[];
  @ApiPropertyOptional({ enum: CREATABLE_KINDS }) @IsOptional() @IsIn(CREATABLE_KINDS as unknown as string[]) kind?: (typeof CREATABLE_KINDS)[number];
  @ApiPropertyOptional({ example: 'A' }) @IsOptional() @IsString() @MaxLength(30) zone?: string;
}

export class ImportBinRowDto {
  @ApiProperty() @IsString() @MaxLength(60) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional({ description: 'Simpan / Penyiapan / Rusak / Karantina (atau STORAGE / STAGING / DAMAGED / QUARANTINE)' }) @IsOptional() @IsString() @MaxLength(30) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
}

export class ImportBinsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [ImportBinRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_IMPORT) @ValidateNested({ each: true }) @Type(() => ImportBinRowDto) rows: ImportBinRowDto[];
  @ApiPropertyOptional({ description: 'true = hanya periksa, tidak menyimpan' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class UpdateBinDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BinMoveLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ description: 'Kosong = bagian stok yang tidak bernomor lot' }) @IsOptional() @IsUUID() lotId?: string;
  @ApiProperty() @IsUUID() fromBinId: string;
  @ApiProperty() @IsUUID() toBinId: string;
  @ApiProperty({ example: '12' }) @Matches(/^\d+(\.\d{1,4})?$/, { message: 'Jumlah tidak valid' }) qty: string;
}

export class MoveBinsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [BinMoveLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BinMoveLineDto) lines: BinMoveLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}
