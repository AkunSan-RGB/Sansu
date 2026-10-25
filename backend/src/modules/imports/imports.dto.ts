import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { Row } from './imports.shared';

export const IMPORT_KINDS = ['products', 'customers', 'suppliers', 'stock', 'receivables', 'payables', 'accounts', 'assets'] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export class ImportDto {
  @ApiProperty({ enum: IMPORT_KINDS }) @IsIn(IMPORT_KINDS) kind: ImportKind;
  @ApiProperty({ description: 'Baris data; kunci = nama kolom templat (mis. sku, nama, harga_jual)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  rows: Row[];
  @ApiPropertyOptional({ description: 'Tanggal saldo awal (stok, piutang, utang, akun)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Gudang default untuk stok awal' }) @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() dryRun?: boolean;
}
