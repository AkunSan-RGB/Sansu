import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { DEPRECIATION_METHODS, FISCAL_ASSET_GROUPS, type FiscalAssetGroup } from '@sansu/shared';

export class CategoryDto {
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty() @IsUUID() assetAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumulatedAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() expenseAccountId?: string;
  @ApiProperty({ enum: DEPRECIATION_METHODS }) @IsIn(DEPRECIATION_METHODS) method: string;
  @ApiProperty({ example: 96 }) @IsInt() @Min(0) @Max(600) usefulLifeMonths: number;
  @ApiProperty({ enum: FISCAL_ASSET_GROUPS }) @IsIn(FISCAL_ASSET_GROUPS) fiscalGroup: FiscalAssetGroup;
  @ApiPropertyOptional({ enum: ['STRAIGHT_LINE', 'DECLINING_BALANCE'] }) @IsOptional() @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE']) fiscalMethod?: string;
}

export class UpdateCategoryDto extends PartialType(CategoryDto) {}

export class TransferAssetBranchDto {
  @ApiPropertyOptional({ description: 'Cabang tujuan; kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional({ example: '2026-10-15' }) @IsOptional() @IsDateString() date?: string;
}

export class CreateAssetDto {
  @ApiPropertyOptional({ description: 'Cabang pemilik aset (penyusutan masuk laporan cabang itu); kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Kosong = otomatis AT-0001' }) @IsOptional() @IsString() @MaxLength(30) code?: string;
  @ApiProperty({ example: 'Truk Colt Diesel B 9123 XY' }) @IsString() @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: '2026-07-15' }) @IsDateString() acquisitionDate: string;
  @ApiProperty({ example: '240000000' }) @IsNumberString() cost: string;
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() residualValue?: string;
  @ApiPropertyOptional({ description: 'Kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional({ enum: DEPRECIATION_METHODS }) @IsOptional() @IsIn(DEPRECIATION_METHODS) method?: string;
  @ApiPropertyOptional({ example: '200000', description: 'Metode unit produksi: kapasitas total aset (wajib untuk metode itu)' }) @IsOptional() @IsNumberString() totalUnits?: string;
  @ApiPropertyOptional({ example: 'km', description: 'Satuan unit produksi (km, jam, unit, ...)' }) @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
  @ApiPropertyOptional({ description: 'Bulan mulai disusutkan; kosong = bulan perolehan' }) @IsOptional() @IsDateString() depreciationStart?: string;
  @ApiProperty({ enum: ['CASH', 'PAYABLE', 'EXISTING'], description: 'CASH = dibayar dari kas/bank, PAYABLE = utang lain-lain, EXISTING = aset lama (tanpa jurnal)' })
  @IsIn(['CASH', 'PAYABLE', 'EXISTING'])
  funding: 'CASH' | 'PAYABLE' | 'EXISTING';
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Aset lama: akumulasi penyusutan s/d sebelum mulai disusutkan di SANSU' }) @IsOptional() @IsNumberString() openingAccumulated?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Tetap kapitalisasi walau di bawah batas kapitalisasi perusahaan' })
  @IsOptional()
  @IsBoolean()
  ignoreCapitalizationThreshold?: boolean;
}

export class UpdateAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional({ description: 'Penanggung jawab aset' }) @IsOptional() @IsString() @MaxLength(120) custodian?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ChangeMethodDto {
  @ApiProperty({ enum: DEPRECIATION_METHODS.filter((m) => m !== 'NONE') }) @IsIn(DEPRECIATION_METHODS.filter((m) => m !== 'NONE')) method: string;
  @ApiPropertyOptional({ example: '2026-11', description: 'Bulan mulai berlaku (bawaan: bulan ini). Tidak boleh pada/ sebelum bulan yang sudah disusutkan.' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveMonth?: string;
  @ApiProperty({ description: 'Alasan perubahan (minimal 5 huruf)' }) @IsString() @MaxLength(300) reason: string;
}

export class UsageDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiProperty({ example: '3500', description: 'Pemakaian bulan itu dalam satuan aset (km, jam, ...)' }) @IsNumberString() units: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RunDepreciationDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
}

export class DisposeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ example: '150000000', description: 'Harga jual (0 bila dihapus/rusak)' }) @IsNumberString() price: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
}

export class VerifyDto {
  @ApiProperty({ enum: ['FOUND', 'DAMAGED', 'MISSING'], description: 'Hasil pemeriksaan fisik' }) @IsIn(['FOUND', 'DAMAGED', 'MISSING']) status: 'FOUND' | 'DAMAGED' | 'MISSING';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'Lokasi terbaru bila berpindah' }) @IsOptional() @IsString() @MaxLength(120) location?: string;
}

export class RegisterFromJournalDto {
  @ApiProperty({ description: 'Jurnal yang mencatat pembelian aset (mis. kas keluar lama)' }) @IsUUID() journalId: string;
  @ApiProperty({ description: 'Akun aset tetap yang didebit di jurnal itu' }) @IsUUID() accountId: string;
  @ApiPropertyOptional({ description: 'Kategori aset (wajib bila akun dipakai >1 kategori)' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ example: 'Mobil operasional' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional({ description: 'Nilai yang didaftarkan; kosong = seluruh sisa yang belum jadi kartu aset' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ description: 'Masa manfaat (bulan); kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) location?: string;
  @ApiPropertyOptional({ example: '200000', description: 'Kategori bermetode unit produksi: kapasitas total aset (wajib untuk metode itu)' }) @IsOptional() @IsNumberString() totalUnits?: string;
  @ApiPropertyOptional({ example: 'km' }) @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
}

export class AssetSettingsDto {
  @ApiPropertyOptional({ description: 'Jalankan penyusutan bulan lalu otomatis' }) @IsOptional() @IsBoolean() autoDepreciation?: boolean;
}
