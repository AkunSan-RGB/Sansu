import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CASH_TX_TYPES, CashTxType, CASH_SOURCE_KEYS, type CashInSourceKey, type CashOutSourceKey } from '@sansu/shared';

export class CashLineDto {
  @ApiPropertyOptional({ description: 'Akun lawan, mis. Beban Listrik atau Modal Pemilik (khusus pembukuan; kosong bila memakai sumber)' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ enum: CASH_SOURCE_KEYS, description: 'Kas masuk: sumber uang (Keuangan wajib). Kas keluar: jenis biaya. Sistem menentukan akun' }) @IsOptional() @IsIn(CASH_SOURCE_KEYS as unknown as string[]) source?: CashInSourceKey | CashOutSourceKey;
  @ApiProperty({ example: '350000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) memo?: string;
  @ApiPropertyOptional({ description: 'Kas keluar: biaya langsung proyek (usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Kas keluar ke akun aset tetap: kategori aset (wajib bila akun dipakai >1 kategori)' }) @IsOptional() @IsUUID() assetCategoryId?: string;
  @ApiPropertyOptional({ description: 'Nama aset (kosong = memo/keterangan transaksi)' }) @IsOptional() @IsString() @MaxLength(160) assetName?: string;
  @ApiPropertyOptional({ description: 'Masa manfaat bulan (kosong = ikut kategori)' }) @IsOptional() @IsInt() @Min(0) @Max(600) assetUsefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) assetLocation?: string;
  @ApiPropertyOptional({ description: 'Kategori bermetode unit produksi: kapasitas total aset' }) @IsOptional() @IsNumberString() assetTotalUnits?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) assetUnitLabel?: string;
}

export class CreateCashTxDto {
  @ApiProperty({ enum: CASH_TX_TYPES }) @IsIn(CASH_TX_TYPES) type: CashTxType;
  @ApiProperty({ description: 'Akun kas/bank (sumber untuk OUT/TRANSFER, tujuan untuk IN)' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional({ description: 'TRANSFER: akun kas/bank tujuan' }) @IsOptional() @IsUUID() toCashAccountId?: string;
  @ApiPropertyOptional({ example: '1000000', description: 'TRANSFER: jumlah' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: 'Bayar listrik gudang Oktober' }) @IsString() @MaxLength(255) description: string;
  @ApiPropertyOptional({ example: 'No. tagihan PLN 123' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional({ description: 'Cabang transaksi ini (biaya/pendapatan cabang tertentu); kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Hanya Pemilik: alasan menembus blokir anggaran (min. 10 karakter)' }) @IsOptional() @IsString() @MaxLength(300) budgetOverrideReason?: string;
  @ApiPropertyOptional({ type: [CashLineDto], description: 'IN/OUT: rincian akun lawan' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CashLineDto)
  @ArrayMinSize(1)
  lines?: CashLineDto[];
}

export class CashQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class VoidCashDto {
  @ApiProperty({ description: 'Alasan pembatalan (wajib, min. 5 karakter)' }) @IsString() @MaxLength(300) reason: string;
}

export class CashEvidenceDto {
  @ApiProperty({ description: 'Nomor bukti (kuitansi/nota/bukti transfer)', example: 'KW-2026-0123' }) @IsString() @MaxLength(100) reference: string;
}

export class CashSettingsDto {
  @ApiPropertyOptional({ description: 'Kas keluar/transfer mulai nilai ini wajib punya nomor bukti (0 = tidak wajib)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) evidenceFrom?: number;
  @ApiPropertyOptional({ description: 'Tolak kas keluar/transfer yang membuat saldo akun kas/bank negatif' }) @IsOptional() @IsBoolean() blockNegative?: boolean;
  @ApiPropertyOptional({ description: 'Peringatkan bila saldo satu akun kas melebihi nilai ini (0 = nonaktif)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) maxCashBalance?: number;
}
