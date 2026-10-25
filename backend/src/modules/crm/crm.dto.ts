import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ACTIVITY_TYPES, type ActivityType, LEAD_STATUSES, type LeadStatus, QUOTATION_STATUSES, type QuotationStatus } from '@sansu/shared';

export class CreateLeadDto {
  @ApiProperty({ example: 'Toko Makmur — pasok mi & minuman' }) @IsString() @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ example: 'Kunjungan lapangan' }) @IsOptional() @IsString() @MaxLength(80) source?: string;
  @ApiPropertyOptional({ example: '15000000' }) @IsOptional() @IsNumberString() expectedRevenue?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedCloseDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class MarkLeadDto {
  @ApiProperty({ enum: ['WON', 'LOST', 'OPEN'] }) @IsIn(LEAD_STATUSES) status: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) lostReason?: string;
  @ApiPropertyOptional({ description: 'Menang: buat pelanggan baru dari data prospek bila belum ada' })
  @IsOptional()
  @IsBoolean()
  createCustomer?: boolean;
}

export class CreateActivityDto {
  @ApiProperty() @IsUUID() leadId: string;
  @ApiProperty({ enum: ACTIVITY_TYPES }) @IsIn(ACTIVITY_TYPES) type: ActivityType;
  @ApiProperty({ example: 'Telepon tanya kebutuhan bulanan' }) @IsString() @MaxLength(255) summary: string;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString() dueDate: string;
}

export class DoneActivityDto {
  @ApiPropertyOptional({ example: 'Minta penawaran 50 dus' }) @IsOptional() @IsString() @MaxLength(500) result?: string;
}

export class StageDto {
  @ApiProperty() @IsString() @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
}

export class QuotationLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '10' }) @IsNumberString() qty: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discountPct?: string;
}

export class CreateQuotationDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 14, description: 'Masa berlaku (hari)' }) @IsOptional() @IsInt() @Min(1) @Max(365) validDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ example: 'Harga belum termasuk ongkos kirim. Pembayaran 30 hari.' }) @IsOptional() @IsString() terms?: string;
  @ApiPropertyOptional({ description: 'Harga yang diinput sudah termasuk PPN' }) @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @ApiProperty({ type: [QuotationLineDto] })
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  @ArrayMinSize(1)
  lines: QuotationLineDto[];
}

export class QuotationQueryDto {
  @ApiPropertyOptional({ enum: QUOTATION_STATUSES }) @IsOptional() @IsIn(QUOTATION_STATUSES) status?: QuotationStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
}
