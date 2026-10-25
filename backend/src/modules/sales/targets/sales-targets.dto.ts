import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumberString, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class TargetQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Bulan; kosong = bulan berjalan' }) @IsOptional() @Matches(PERIOD) month?: string;
}

export class TargetItemDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ example: '150000000' }) @IsNumberString() targetAmount: string;
  @ApiProperty({ example: '1.5' }) @IsNumberString() commissionPct: string;
  @ApiPropertyOptional({ example: '80', description: 'Komisi hanya bila pencapaian ≥ persen ini' }) @IsOptional() @IsNumberString() minAchievementPct?: string;
}

export class SaveTargetsDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD) period: string;
  @ApiProperty({ type: [TargetItemDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TargetItemDto) items: TargetItemDto[];
}
