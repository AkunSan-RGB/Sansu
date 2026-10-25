import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'GDG-02' }) @IsString() @MaxLength(20) code: string;
  @ApiProperty({ example: 'Gudang Cabang Bekasi' }) @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ description: 'Nonaktifkan gudang yang sudah tidak dipakai (stok harus kosong)' }) @IsOptional() @IsBoolean() isActive?: boolean;
}
