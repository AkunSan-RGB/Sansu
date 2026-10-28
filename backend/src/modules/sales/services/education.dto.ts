import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class EduClassDto {
  @ApiProperty({ example: 'MAT-7' }) @IsString() @MinLength(2) @MaxLength(30) code: string;
  @ApiProperty({ example: 'Matematika kelas 7' }) @IsString() @MinLength(3) @MaxLength(120) name: string;
  @ApiProperty({ example: '350000', description: 'SPP per bulan' }) @IsNumberString() monthlyFee: string;
  @ApiPropertyOptional({ description: 'Kuota peserta; kosong = tanpa batas' }) @IsOptional() @IsInt() @Min(1) @Max(10000) capacity?: number;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
}

export class EduClassUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsNumberString() monthlyFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ description: 'Alasan perubahan (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class EduEnrollDto {
  @ApiProperty() @IsUUID() classId: string;
  @ApiProperty({ description: 'Wali / pihak yang ditagih' }) @IsUUID() customerId: string;
  @ApiProperty({ example: 'Andi Pratama' }) @IsString() @MinLength(2) @MaxLength(120) studentName: string;
  @ApiProperty() @IsDateString() enrolledOn: string;
  @ApiPropertyOptional({ example: '10', description: 'Diskon SPP persen (saudara kandung, beasiswa)' }) @IsOptional() @IsNumberString() discountPct?: string;
}

export class EduLeaveDto {
  @ApiProperty() @IsDateString() leftOn: string;
  @ApiProperty({ description: 'Alasan keluar (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class EduBillDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Periode berformat YYYY-MM' }) period: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
