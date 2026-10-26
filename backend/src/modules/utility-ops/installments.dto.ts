import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class InstallmentPlanDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ description: 'Tagihan tunggakan yang dicicil' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(24) @IsUUID('all', { each: true }) invoiceIds: string[];
  @ApiProperty({ example: 3 }) @IsInt() @Min(2) @Max(12) count: number;
  @ApiProperty({ example: '2026-11-15' }) @IsDateString() firstDue: string;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(7) @Max(60) intervalDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class DecidePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class CancelPlanDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
