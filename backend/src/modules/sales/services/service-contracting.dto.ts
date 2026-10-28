import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class BoqItemDto {
  @ApiPropertyOptional({ description: 'Isi untuk memperbarui item yang ada; kosong = item baru' }) @IsOptional() @IsUUID() id?: string;
  @ApiPropertyOptional({ example: 'A.1.2' }) @IsOptional() @IsString() @MaxLength(30) code?: string;
  @ApiProperty({ example: 'Pekerjaan pondasi batu kali' }) @IsString() @MinLength(2) @MaxLength(200) description: string;
  @ApiProperty({ example: 'M3' }) @IsString() @MinLength(1) @MaxLength(20) unit: string;
  @ApiProperty({ example: '120' }) @IsNumberString() qty: string;
  @ApiProperty({ example: '850000', description: 'Harga satuan (DPP, belum PPN)' }) @IsNumberString() unitPrice: string;
}

export class SaveBoqDto {
  @ApiProperty({ type: [BoqItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BoqItemDto) items: BoqItemDto[];
  @ApiPropertyOptional({ description: 'true = nilai kontrak proyek disamakan dengan total BoQ' }) @IsOptional() @IsBoolean() syncContract?: boolean;
}

export class BoqProgressItemDto {
  @ApiProperty() @IsUUID() itemId: string;
  @ApiProperty({ example: '60', description: 'Volume selesai KUMULATIF sampai tanggal ini (tidak boleh turun, tidak boleh melebihi volume BoQ)' }) @IsNumberString() completedQty: string;
}

export class BoqProgressDto {
  @ApiProperty({ example: '2026-10-31' }) @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiProperty({ type: [BoqProgressItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BoqProgressItemDto) items: BoqProgressItemDto[];
}

export class ReleaseRetentionDto {
  @ApiProperty({ example: '2027-04-30', description: 'Tanggal jatuh tempo baru retensi (setelah serah terima akhir / masa pemeliharaan selesai)' }) @IsDateString() dueDate: string;
  @ApiProperty({ description: 'Dasar pencairan, mis. nomor BA serah terima akhir (min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
