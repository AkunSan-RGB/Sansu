import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class ProductionDto {
  @ApiProperty() @Matches(DATE) date: string;
  @ApiProperty({ example: 'IPA Sungai Tirta' }) @IsString() @MinLength(2) @MaxLength(80) source: string;
  @ApiProperty({ description: 'Air yang diproduksi (m³)' }) @IsNumber() @Min(0) @Max(100_000_000) produced: number;
  @ApiProperty({ description: 'Air yang dialirkan ke jaringan (m³)' }) @IsNumber() @Min(0) @Max(100_000_000) distributed: number;
  @ApiPropertyOptional({ description: 'Pemakaian sendiri / pencucian (m³)' }) @IsOptional() @IsNumber() @Min(0) ownUse?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) energyKwh?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) chemicalNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class WaterQualityDto {
  @ApiProperty() @Matches(DATE) sampledOn: string;
  @ApiProperty({ example: 'Reservoir utama' }) @IsString() @MinLength(2) @MaxLength(80) point: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(14) ph?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) turbidity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) chlorine?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) coliform?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) tds?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
