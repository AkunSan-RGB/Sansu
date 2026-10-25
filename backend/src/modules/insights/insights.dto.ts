import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class FiscalYearDto {
  @ApiPropertyOptional({ example: '0', description: 'Kompensasi kerugian fiskal tahun-tahun sebelumnya' }) @IsOptional() @IsNumberString() lossCarryforward?: string;
  @ApiPropertyOptional({ description: 'Peredaran bruto manual (null = otomatis)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  grossRevenueOverride?: string | null;
  @ApiPropertyOptional({ description: 'Biaya untuk penghasilan PPh final, manual (null = otomatis)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  finalCostOverride?: string | null;
}

export class FiscalAdjustmentDto {
  @ApiProperty({ example: 'Biaya natura tidak memenuhi syarat' }) @IsString() @MaxLength(200) description: string;
  @ApiProperty({ enum: ['POSITIVE', 'NEGATIVE'] }) @IsIn(['POSITIVE', 'NEGATIVE']) kind: 'POSITIVE' | 'NEGATIVE';
  @ApiProperty({ example: '2500000' }) @IsNumberString() amount: string;
}

export class NoteDto {
  @ApiProperty() @IsString() @MaxLength(20000) content: string;
}
