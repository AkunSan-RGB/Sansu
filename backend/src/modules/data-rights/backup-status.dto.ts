import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { BACKUP_KINDS, BackupKind } from './backup-status.shared';

export class BackupReportDto {
  @IsIn(BACKUP_KINDS) kind: BackupKind;
  @IsIn(['OK', 'FAILED']) status: 'OK' | 'FAILED';
  @IsString() @MaxLength(60) source: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1e13) sizeBytes?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9a-f]{64}$/) sha256?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86400) durationSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offsite?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() encrypted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() detail?: Record<string, number>;
}
