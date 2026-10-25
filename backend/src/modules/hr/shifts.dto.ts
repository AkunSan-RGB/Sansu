import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export class CreateTemplateDto {
  @ApiProperty({ example: 'Pagi' }) @IsString() @MinLength(2) @MaxLength(40) name: string;
  @ApiProperty({ example: '07:00' }) @Matches(HHMM) startTime: string;
  @ApiProperty({ example: '15:00' }) @Matches(HHMM) endTime: string;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(0) @Max(50) minStaff?: number;
  @ApiPropertyOptional({ description: 'Tarif premi (kartu tarif satuan per shift)' }) @IsOptional() @IsUUID() premiumRateId?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(50) minStaff?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() premiumRateId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) employeeIds: string[];
  @ApiProperty({ type: [String], example: ['2026-10-20'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31) @IsDateString({}, { each: true }) dates: string[];
  @ApiProperty() @IsUUID() templateId: string;
}

export class RosterQueryDto {
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
}
