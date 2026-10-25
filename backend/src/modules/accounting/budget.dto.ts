import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class BudgetRowDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiProperty({ type: [String], description: '12 angka, Januari–Desember (Rupiah, ≥ 0)' }) @IsArray() @ArrayMinSize(12) @ArrayMaxSize(12) @IsNumberString({}, { each: true }) months: string[];
}

export class SaveBudgetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ description: 'Toleransi realisasi beban terhadap anggaran (%) sebelum diberi peringatan' }) @IsOptional() @IsInt() @Min(0) @Max(100) tolerancePct?: number;
  @ApiProperty({ type: [BudgetRowDto] }) @ValidateNested({ each: true }) @Type(() => BudgetRowDto) @ArrayMaxSize(500) rows: BudgetRowDto[];
}

export class SeedBudgetDto {
  @ApiProperty({ description: 'Tahun realisasi yang dijadikan dasar' }) @IsInt() @Min(2000) @Max(2100) fromYear: number;
  @ApiProperty({ example: 5, description: 'Kenaikan/penurunan (%) dari realisasi' }) @IsNumber({ maxDecimalPlaces: 1 }) @Min(-90) @Max(500) growthPct: number;
}

export class ReopenBudgetDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) reason: string;
}
