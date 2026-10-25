import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const KINDS = ['PERSON', 'ROOM', 'EQUIPMENT'] as const;

const MAX_OCCURRENCES = 26;

export class ResourceDto {
  @ApiProperty({ example: 'Ruang Rapat A' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind: 'PERSON' | 'ROOM' | 'EQUIPMENT';
  @ApiPropertyOptional({ description: 'Sumber daya orang: karyawan terkait' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Jam mulai kerja (WIB), 0–23', example: 8 }) @IsOptional() @IsInt() @Min(0) @Max(23) workStart?: number;
  @ApiPropertyOptional({ description: 'Jam selesai kerja (WIB), 1–24', example: 17 }) @IsOptional() @IsInt() @Min(1) @Max(24) workEnd?: number;
  @ApiPropertyOptional({ description: 'Hari kerja: 1 = Senin … 7 = Minggu, dipisah koma', example: '1,2,3,4,5,6' }) @IsOptional() @Matches(/^[1-7](,[1-7]){0,6}$/, { message: 'Hari kerja berupa angka 1–7 dipisah koma' }) workDays?: string;
}

export class BookingDto {
  @ApiProperty() @IsUUID() resourceId: string;
  @ApiProperty({ example: 'Survei lokasi PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiProperty({ example: '2026-10-20T09:00:00+07:00' }) @IsDateString() startsAt: string;
  @ApiProperty({ example: '2026-10-20T12:00:00+07:00' }) @IsDateString() endsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class RecurringBookingDto extends BookingDto {
  @ApiProperty({ enum: ['DAILY', 'WEEKLY'] }) @IsIn(['DAILY', 'WEEKLY']) repeat: 'DAILY' | 'WEEKLY';
  @ApiProperty({ description: `Jumlah kejadian (2–${MAX_OCCURRENCES}), termasuk yang pertama` }) @Type(() => Number) @IsInt() @Min(2) @Max(MAX_OCCURRENCES) count: number;
}

export class MoveDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
}

export class CancelDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
