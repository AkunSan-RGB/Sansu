import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { UTILITY_SERVICE_TYPES, type UtilityServiceType } from '@sansu/shared';

export class BlockDto {
  @ApiPropertyOptional({ description: 'Sampai pemakaian ini (kosong = tanpa batas, hanya blok terakhir)' }) @IsOptional() @IsNumber() @Min(0) upTo?: number | null;
  @ApiProperty() @IsNumber() @Min(0) price: number;
}

export class TariffDto {
  @ApiProperty({ example: 'Air rumah tangga' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: UTILITY_SERVICE_TYPES }) @IsIn(UTILITY_SERVICE_TYPES) serviceType: UtilityServiceType;
  @ApiPropertyOptional({ example: 'm³' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiProperty({ example: 10000 }) @IsNumber() @Min(0) fixedFee: number;
  @ApiProperty({ example: 2500 }) @IsNumber() @Min(0) adminFee: number;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsNumber() @Min(0) minUsage?: number;
  @ApiProperty({ type: [BlockDto] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BlockDto) blocks: BlockDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vatable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ConnectionDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() tariffId: string;
  @ApiPropertyOptional({ description: 'Nomor meter (wajib untuk layanan terukur)' }) @IsOptional() @IsString() @MaxLength(60) meterNo?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) address: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() installedAt?: string;
  @ApiPropertyOptional({ example: '0', description: 'Angka meter saat dipasang' }) @IsOptional() @IsNumberString() initialReading?: string;
  @ApiPropertyOptional({ example: 'Zona A', description: 'Zona/wilayah layanan (untuk menghitung kehilangan)' }) @IsOptional() @IsString() @MaxLength(60) zone?: string;
}

export class ZoneDto {
  @ApiPropertyOptional({ description: 'Kosong = keluarkan dari zona' }) @IsOptional() @IsString() @MaxLength(60) zone?: string;
}

export class ZoneSupplyDto {
  @ApiProperty({ example: 'Zona A' }) @IsString() @MinLength(1) @MaxLength(60) zone: string;
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiProperty({ example: '12500', description: 'Jumlah yang masuk ke zona menurut meter induk/sumber (satuan sama dengan tarif zona itu)' }) @IsNumberString() supplied: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ReadingDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiProperty({ example: '1234.5', description: 'Angka meter sekarang (meter diganti: angka meter BARU)' }) @IsNumberString() current: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() meterReplaced?: boolean;
  @ApiPropertyOptional({ description: 'Meter diganti: angka akhir meter LAMA' }) @IsOptional() @IsNumberString() oldMeterFinal?: string;
  @ApiPropertyOptional({ description: 'Meter diganti: angka awal meter BARU' }) @IsOptional() @IsNumberString() newMeterStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ description: 'Lokasi petugas saat mencatat (lintang)' }) @IsOptional() @IsNumber() lat?: number;
  @ApiPropertyOptional({ description: 'Lokasi petugas saat mencatat (bujur)' }) @IsOptional() @IsNumber() lng?: number;
  @ApiPropertyOptional({ description: 'Foto meter (data URL png/jpeg/webp)' }) @IsOptional() @IsString() @MaxLength(450_000) @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) photo?: string;
}

export class EstimateDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional({ description: 'Alasan meter tidak terbaca (mis. meter tertutup, pagar terkunci)' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class VerifyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class SuspendDto extends ReasonDto {
  @ApiPropertyOptional({ description: 'Atas permintaan pelanggan (boleh tanpa tunggakan)' }) @IsOptional() @IsBoolean() onRequest?: boolean;
}

export class BillRunDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
}

export class RulesDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() graceDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lateFeePct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lateFeeCapPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() suspendAfterDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() spikeFactor?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() spikeMinUsage?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() dueDays?: number;
  @ApiPropertyOptional({ description: 'Penerimaan loket hanya non-tunai (setoran kas tidak dipakai)' }) @IsOptional() @IsBoolean() cashless?: boolean;
}
