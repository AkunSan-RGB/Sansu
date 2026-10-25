import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ATTENDANCE_STATUSES, type AttendanceStatus, LEAVE_TYPES, type LeaveType, PTKP_STATUSES, type PtkpStatus } from '@sansu/shared';
import { IsNik, IsNpwp } from '../../common/validators/npwp';
import { EMPLOYMENT_TYPES, type EmploymentType } from './employment.shared';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-001' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'Siti Rahma' }) @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNik() nik?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) @IsNpwp() npwp?: string;
  @ApiProperty({ enum: PTKP_STATUSES }) @IsIn(PTKP_STATUSES) ptkp: PtkpStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiProperty({ example: '2025-01-02' }) @IsDateString() joinDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankAccount?: string;
  @ApiProperty({ example: '5000000' }) @IsNumberString() baseSalary: string;
  @ApiPropertyOptional({ example: '500000' }) @IsOptional() @IsNumberString() fixedAllowance?: string;
  @ApiPropertyOptional({ example: '30000' }) @IsOptional() @IsNumberString() dailyAllowance?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsKes?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsTk?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bpjsJp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(60) annualLeave?: number;
  @ApiPropertyOptional({ description: 'Ditempatkan di proyek (gaji jadi biaya langsung proyek); null = kantor' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  projectId?: string | null;
  @ApiPropertyOptional({ description: 'Tenaga kerja langsung produksi (gaji masuk harga pokok produksi)' }) @IsOptional() @IsBoolean() isProduction?: boolean;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES, description: 'Status kepegawaian; selain TETAP khusus usaha jasa' }) @IsOptional() @IsIn(EMPLOYMENT_TYPES as unknown as string[]) employmentType?: EmploymentType;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() contractStart?: string | null;
  @ApiPropertyOptional({ description: 'Akhir kontrak / magang; gaji berhenti otomatis di tanggal ini' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() contractEnd?: string | null;
  @ApiPropertyOptional({ example: '150000', description: 'Upah per hari hadir (status harian)' }) @IsOptional() @IsNumberString() dailyWage?: string;
  @ApiPropertyOptional({ description: 'Cabang tempat bekerja: gaji & BPJS otomatis masuk laporan cabang itu; null = pusat' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId?: string | null;
}

export class LinkAccountDto {
  @ApiPropertyOptional({ description: 'Akun pengguna yang dihubungkan; null = lepaskan' }) @IsOptional() @IsUUID() userId?: string | null;
  @ApiPropertyOptional({ description: 'Wajib saat mengganti atau melepas hubungan yang sudah ada' }) @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @ApiPropertyOptional({ description: 'Usaha jasa: alasan perubahan data sensitif (tampil bagi penyetuju)' }) @IsOptional() @IsString() @MaxLength(255) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() resignDate?: string;
}

export class AttendanceRowDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES }) @IsIn(ATTENDANCE_STATUSES) status: AttendanceStatus;
  @ApiPropertyOptional({ example: '08:00' }) @IsOptional() @Matches(/^\d{2}:\d{2}$/) checkIn?: string;
  @ApiPropertyOptional({ example: '17:00' }) @IsOptional() @Matches(/^\d{2}:\d{2}$/) checkOut?: string;
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @IsNumberString() overtimeHours?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class SaveAttendanceDto {
  @ApiProperty({ example: '2026-10-05' }) @IsDateString() date: string;
  @ApiProperty({ type: [AttendanceRowDto] })
  @ValidateNested({ each: true })
  @Type(() => AttendanceRowDto)
  @ArrayMinSize(1)
  rows: AttendanceRowDto[];
}

export class CreateLeaveDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ enum: LEAVE_TYPES }) @IsIn(LEAVE_TYPES) type: LeaveType;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() endDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class DecideLeaveDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
}
