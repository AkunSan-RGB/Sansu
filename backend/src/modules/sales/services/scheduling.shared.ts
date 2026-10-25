import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const num = (v: unknown) => Number(v ?? 0);

export class BookingsQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
}

export class SlotQuery {
  @ApiProperty() @IsUUID() resourceId: string;
  @ApiProperty({ example: '2026-10-20' }) @IsDateString() from: string;
  @ApiProperty({ example: '2026-10-24' }) @IsDateString() to: string;
  @ApiProperty({ example: 120, description: 'Lama yang dibutuhkan (menit)' }) @Type(() => Number) @IsInt() @Min(15) @Max(600) minutes: number;
}
