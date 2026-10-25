import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateBillingInvoiceDto {
  @ApiProperty() @IsString() planId: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) @IsIn(['MONTHLY', 'YEARLY']) cycle: 'MONTHLY' | 'YEARLY';
}

export class ProofDto {
  @ApiProperty({ description: 'Foto/PDF bukti transfer sebagai data URL (maks. ±2 MB)' })
  @IsString()
  @MaxLength(2_800_000, { message: 'File bukti terlalu besar (maks. ±2 MB)' })
  @Matches(/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/, {
    message: 'Bukti harus gambar (PNG/JPG/WebP) atau PDF',
  })
  proof: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RejectDto {
  @ApiProperty() @IsString() @MaxLength(300) reason: string;
}

export class PlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'Kode hanya huruf besar, angka, - dan _' })
  code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() priceMonthly?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() priceYearly?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxUsers?:
    number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  maxWarehouses?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() planId?: string;
  @ApiPropertyOptional({ enum: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'])
  status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] }) @IsOptional() @IsIn(['MONTHLY', 'YEARLY']) cycle?:
    'MONTHLY' | 'YEARLY';
  @ApiPropertyOptional({ description: 'Akhir trial (ISO)' }) @IsOptional() @IsDateString() trialEndsAt?: string;
  @ApiPropertyOptional({ description: 'Akhir masa aktif (ISO); null = tanpa batas', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  currentPeriodEnd?: string | null;
  @ApiPropertyOptional({ description: 'Tambah hari ke masa trial / aktif' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3660)
  extendDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class BillingSettingsDto {
  @ApiPropertyOptional({ description: 'Saklar utama langganan (mati selama tahap uji)' }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) bankHolder?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) trialDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(30) graceDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() trialPlanCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) supportWhatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(30) renewalNoticeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sellerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) sellerNpwp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) sellerAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vatEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(20) vatRate?: number;
}

export class TestEmailDto {
  @ApiProperty() @IsEmail() to: string;
}
