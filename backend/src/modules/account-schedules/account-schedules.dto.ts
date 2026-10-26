import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class FreezeSnapshotDto {
  @ApiProperty({ example: 2025, description: 'Tahun laporan yang dibekukan' }) @IsInt() @Min(2000) @Max(2100) year: number;
  @ApiPropertyOptional({ description: 'Catatan pembekuan, mis. penandatangan dan nomor persetujuan RUPS' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
