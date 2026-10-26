import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VISIT_OUTCOMES, type VisitOutcome } from '@sansu/shared';
import { IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class VisitDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ enum: VISIT_OUTCOMES }) @IsIn(VISIT_OUTCOMES) outcome: VisitOutcome;
  @ApiPropertyOptional({ description: 'Wajib untuk janji bayar (YYYY-MM-DD)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) promisedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) promisedAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}
