import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** Satu baris data pelanggan lama; semua isian berupa teks apa adanya dari berkas (diperiksa server) */
export class ImportRowDto {
  @ApiPropertyOptional({ description: 'Kode pelanggan lama; kosong = dibuat otomatis' }) @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) email?: string;
  @ApiProperty() @IsString() @MaxLength(300) address: string;
  @ApiProperty({ description: 'Nama golongan tarif (sama dengan di Tarif air)' }) @IsString() @MaxLength(120) tariff: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) meterNo?: string;
  @ApiPropertyOptional({ description: 'Angka meter terakhir/awal' }) @IsOptional() @IsString() @MaxLength(30) initialReading?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' }) @IsOptional() @IsString() @MaxLength(20) installedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional({ description: 'Kode rute (harus sudah dibuat)' }) @IsOptional() @IsString() @MaxLength(20) route?: string;
}
export class ImportConnectionsDto {
  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows: ImportRowDto[];
  @ApiPropertyOptional({ description: 'Hanya periksa, jangan simpan (pratinjau)' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}
