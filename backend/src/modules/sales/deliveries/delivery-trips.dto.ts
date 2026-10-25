import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsLatitude, IsLongitude, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTripDto {
  @ApiPropertyOptional({ example: '2026-10-20', description: 'Tanggal pengiriman (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 'B 1234 XY' }) @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @ApiPropertyOptional({ description: 'Kendaraan terdaftar (kapasitas dipakai untuk memeriksa muatan)' }) @IsOptional() @IsUUID() vehicleId?: string;
  @ApiPropertyOptional({ example: 'Pak Slamet' }) @IsOptional() @IsString() @MaxLength(100) driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ type: [String], description: 'Surat jalan yang langsung dimasukkan (urutan = urutan stop)' }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) deliveryIds?: string[];
}

export class AddStopsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) deliveryIds: string[];
}

export class ReorderDto {
  @ApiProperty({ type: [String], description: 'Seluruh id stop pada rute ini, dalam urutan baru' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) stopIds: string[];
}

const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const MAX_IMAGE_CHARS = 450_000;
 // ± 330 KB gambar

export class DepartDto {
  @ApiPropertyOptional({ description: 'Berangkat walau muatan melebihi kapasitas (hanya Admin/Pemilik, wajib alasan)' }) @IsOptional() @IsBoolean() acceptOverCapacity?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) reason?: string;
}

export class PositionDto {
  @ApiProperty() @IsLatitude() lat: number;
  @ApiProperty() @IsLongitude() lng: number;
}

export class VehicleDto {
  @ApiProperty({ example: 'B 1234 XY' }) @IsString() @MinLength(3) @MaxLength(20) plate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional({ example: '1500', description: 'Kapasitas muat (kg); kosong = tanpa batas' }) @IsOptional() @IsNumberString() capacityKg?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) defaultDriver?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StopResultDto {
  @ApiProperty({ enum: ['DELIVERED', 'FAILED'] }) @IsIn(['DELIVERED', 'FAILED']) result: 'DELIVERED' | 'FAILED';
  @ApiPropertyOptional({ description: 'Nama penerima (wajib bila terkirim)' }) @IsOptional() @IsString() @MaxLength(120) receivedBy?: string;
  @ApiPropertyOptional({ description: 'Alasan gagal (wajib bila gagal)' }) @IsOptional() @IsString() @MaxLength(300) failReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'Lokasi saat hasil dicatat' }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'Foto bukti (data URL png/jpeg/webp, maks ± 330 KB)' }) @IsOptional() @IsString() @MaxLength(MAX_IMAGE_CHARS) @Matches(IMAGE_URL, { message: 'Foto harus berupa gambar png/jpeg/webp' }) photo?: string;
  @ApiPropertyOptional({ description: 'Tanda tangan penerima (data URL png/jpeg/webp)' }) @IsOptional() @IsString() @MaxLength(MAX_IMAGE_CHARS) @Matches(IMAGE_URL, { message: 'Tanda tangan harus berupa gambar png/jpeg/webp' }) signature?: string;
}

export class CancelTripDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class TripQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED']) status?: string;
}
