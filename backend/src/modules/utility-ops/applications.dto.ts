import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ApplicationDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) applicantName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional({ description: 'Nomor KTP' }) @IsOptional() @IsString() @MaxLength(32) idNumber?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) address: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() geoLat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() geoLng?: number;
  @ApiPropertyOptional({ description: 'Golongan tarif yang diminta' }) @IsOptional() @IsUUID() tariffId?: string;
  @ApiPropertyOptional({ description: 'Pelanggan lama yang menambah sambungan' }) @IsOptional() @IsUUID() customerId?: string;
}
export class SurveyDto {
  @ApiProperty({ description: 'Layak dipasang?' }) @IsBoolean() feasible: boolean;
  @ApiPropertyOptional({ description: 'Panjang pipa yang dibutuhkan (m)' }) @IsOptional() @IsNumberString() pipeLength?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) note: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tariffId?: string;
}
export class QuoteDto {
  @ApiPropertyOptional({ description: 'Layanan non-air yang ditagih; kosong = "Biaya sambung baru"' }) @IsOptional() @IsUUID() chargeId?: string;
  @ApiPropertyOptional({ description: 'Harga; kosong = harga bawaan layanan' }) @IsOptional() @IsNumberString() price?: string;
}
export class InstallDto {
  @ApiProperty() @IsUUID() installerId: string;
  @ApiProperty({ description: 'Nomor seri meter yang dipasang' }) @IsString() @MinLength(2) @MaxLength(60) meterSerial: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ActivateDto {
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() initialReading?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() installedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
}
export class CloseApplicationDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
  @ApiPropertyOptional({ description: 'true = ditolak; false = dibatalkan pemohon' }) @IsOptional() @IsBoolean() rejected?: boolean;
}
