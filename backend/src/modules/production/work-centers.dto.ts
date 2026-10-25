import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const KINDS = ['MACHINE', 'LINE', 'STATION'] as const;

export class WorkCenterDto {
  @ApiProperty({ example: 'MSN-01' }) @IsString() @MinLength(2) @MaxLength(30) code: string;
  @ApiProperty({ example: 'Mesin Potong 1' }) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: 'MACHINE' | 'LINE' | 'STATION';
  @ApiProperty({ example: 25000, description: 'Tarif upah per jam' }) @IsNumber() @Min(0) @Max(100_000_000) laborRate: number;
  @ApiProperty({ example: 40000, description: 'Tarif overhead (listrik, penyusutan, dll.) per jam' }) @IsNumber() @Min(0) @Max(100_000_000) overheadRate: number;
  @ApiPropertyOptional({ example: 8, description: 'Kapasitas jam per hari' }) @IsOptional() @IsNumber() @Min(0.5) @Max(24) capacityHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DowntimeDto {
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

export class BomOpDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @IsUUID() workCenterId: string;
  @ApiProperty({ example: 30, description: 'Menit per batch' }) @IsNumber() @Min(1) @Max(100_000) minutesPerBatch: number;
}

export class BomOpsDto {
  @ApiProperty({ type: [BomOpDto], description: 'Urutan operasi (menggantikan yang lama)' }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BomOpDto) operations: BomOpDto[];
}

export class ScheduleDto {
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiPropertyOptional({ description: 'Hanya Admin: izinkan di luar shift pusat kerja dengan alasan (ditandai di kontrol)' }) @IsOptional() @IsString() @MaxLength(255) offShiftReason?: string;
}

export class ShiftDto {
  @ApiProperty({ description: '1 = Senin … 7 = Minggu' }) @IsInt() @Min(1) @Max(7) weekday: number;
  @ApiProperty({ example: '07:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Jam berformat HH:MM' }) start: string;
  @ApiProperty({ example: '15:00' }) @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { message: 'Jam berformat HH:MM' }) end: string;
}

export class ShiftsDto {
  @ApiProperty({ type: [ShiftDto], description: 'Kalender shift mingguan (menggantikan yang lama); kosong = tanpa kalender (hanya kapasitas jam/hari)' }) @IsArray() @ArrayMaxSize(28) @ValidateNested({ each: true }) @Type(() => ShiftDto) shifts: ShiftDto[];
}

export class FinishOpDto {
  @ApiPropertyOptional({ description: 'Menit aktual; kosong = selisih waktu mulai–selesai' }) @IsOptional() @IsNumber() @Min(1) @Max(1440) actualMinutes?: number;
  @ApiPropertyOptional({ description: 'Wajib bila aktual > 150% rencana' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() operatorEmployeeId?: string;
}

export class CorrectOpDto {
  @ApiProperty() @IsNumber() @Min(1) @Max(1440) actualMinutes: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
