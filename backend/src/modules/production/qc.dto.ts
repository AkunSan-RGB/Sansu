import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class QcParamDto {
  @ApiProperty({ example: 'Berat bersih (g)' }) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty({ enum: ['NUMERIC', 'PASSFAIL'] }) @IsIn(['NUMERIC', 'PASSFAIL']) kind: 'NUMERIC' | 'PASSFAIL';
  @ApiPropertyOptional() @IsOptional() @IsNumber() minValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ description: 'Gagal pada parameter kritis = seluruh lot gagal' }) @IsOptional() @IsBoolean() critical?: boolean;
}

export class QcPlanDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty({ type: [QcParamDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => QcParamDto) params: QcParamDto[];
  @ApiPropertyOptional({ description: 'Hasil produksi/penerimaan produk ini wajib QC (masuk karantina dulu)', default: true }) @IsOptional() @IsBoolean() requireOnProduction?: boolean;
  @ApiPropertyOptional({ description: 'Sampling: persen dari jumlah lot yang diperiksa (kosong = periksa seluruh lot)', example: 10 }) @IsOptional() @IsNumber() @Min(0.1) @Max(100) samplePct?: number;
  @ApiPropertyOptional({ description: 'Ukuran sampel minimum' }) @IsOptional() @IsInt() @Min(1) sampleMin?: number;
  @ApiPropertyOptional({ description: 'Ukuran sampel maksimum' }) @IsOptional() @IsInt() @Min(1) sampleMax?: number;
  @ApiPropertyOptional({ description: 'Jumlah cacat dalam sampel yang masih diterima (wajib bila sampling)', example: 0 }) @IsOptional() @IsInt() @Min(0) acceptDefects?: number;
}

export class ResultDto {
  @ApiProperty() @IsUUID() resultId: string;
  @ApiPropertyOptional({ description: 'Angka hasil ukur (parameter angka)' }) @IsOptional() @IsNumber() value?: number;
  @ApiPropertyOptional({ description: 'Lulus/gagal (parameter lulus-gagal)' }) @IsOptional() @IsBoolean() pass?: boolean;
}

export class DecideDto {
  @ApiProperty({ type: [ResultDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ResultDto) results: ResultDto[];
  @ApiPropertyOptional({ description: 'Jumlah yang dinyatakan lolos; kosong = seluruhnya bila semua parameter lolos, 0 bila ada yang gagal' }) @IsOptional() @IsNumber() @Min(0) qtyPass?: number;
  @ApiPropertyOptional({ description: 'Sampling: jumlah unit cacat yang ditemukan dalam sampel' }) @IsOptional() @IsInt() @Min(0) sampleDefects?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ReworkDto {
  @ApiProperty() @IsNumber() @Min(0.0001) qty: number;
  @ApiProperty({ description: 'Apa yang dikerjakan ulang (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class AttachmentDto {
  @ApiProperty({ enum: ['PHOTO', 'COA'] }) @IsIn(['PHOTO', 'COA']) kind: 'PHOTO' | 'COA';
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) filename: string;
  @ApiProperty({ description: 'Data URL png/jpeg/webp atau PDF (PDF ≤ 800 KB)' }) @IsString() dataUrl: string;
}

export class ScrapDto {
  @ApiProperty() @IsNumber() @Min(0.0001) qty: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
