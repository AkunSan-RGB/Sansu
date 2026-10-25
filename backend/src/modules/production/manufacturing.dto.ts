import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';

export class RequirementItemDto {
  @ApiProperty() @IsUUID() bomId: string;
  @ApiProperty({ example: '5', description: 'Jumlah batch yang direncanakan' }) @IsNumberString() batches: string;
}

export class RequirementsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [RequirementItemDto] })
  @ValidateNested({ each: true })
  @Type(() => RequirementItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: RequirementItemDto[];
}

export class PlanDto extends RequirementsDto {
  @ApiPropertyOptional({ example: '2026-10-05', description: 'Tanggal perintah; default hari ini' }) @IsOptional() @IsDateString() date?: string;
}

export class VarianceQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ example: '3', description: 'Toleransi pemakaian bahan di atas standar (%) sebelum ditandai' }) @IsOptional() @Matches(/^\d{1,3}(\.\d)?$/) tolerancePct?: string;
}
