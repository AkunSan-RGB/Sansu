import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class TimeEntryDto {
  @ApiPropertyOptional({ description: 'Kosong = karyawan yang terhubung dengan akun Anda' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Wajib bila tanpa proyek' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiProperty({ example: '2026-10-19' }) @IsDateString() workDate: string;
  @ApiProperty({ example: '2.5' }) @IsNumberString() hours: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() billable?: boolean;
}

export class UpdateTimeEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() workDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() hours?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() billable?: boolean;
}

export class TimerStartDto {
  @ApiPropertyOptional({ description: 'Kosong = karyawan yang terhubung dengan akun Anda' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Wajib bila tanpa proyek' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() billable?: boolean;
}

export class TimerWhoDto {
  @ApiPropertyOptional({ description: 'Kosong = karyawan yang terhubung dengan akun Anda' }) @IsOptional() @IsUUID() employeeId?: string;
}

export class TimerDiscardDto extends TimerWhoDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class IdsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
}

export class ApproveDto {
  @ApiPropertyOptional({ description: 'Ubah tarif (Admin/Pemilik; wajib rateNote)' }) @IsOptional() @IsNumberString() rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) rateNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class RateDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ example: '350000', description: 'Tarif per jam (Rp, belum PPN)' }) @IsNumberString() rate: string;
  @ApiProperty() @IsDateString() validFrom: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class BillDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) entryIds: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() withVat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}
