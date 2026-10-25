import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApprovalPolicy } from '../../common/approvals/approvals.service';

export class PolicyDto implements Partial<ApprovalPolicy> {
  @ApiPropertyOptional({ description: 'Pesanan pembelian dengan total ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseOrder?: number;
  @ApiPropertyOptional({ description: 'Jurnal manual dengan total debit ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) manualJournal?: number;
  @ApiPropertyOptional({ description: 'Penyesuaian stok bernilai ≥ batas ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) stockAdjustment?: number;
  @ApiPropertyOptional({ description: 'Kas keluar / transfer dengan nilai ≥ batas ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) cashOut?: number;
  @ApiPropertyOptional({ description: 'Pelepasan aset tetap dengan harga perolehan ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) assetDisposal?: number;
  @ApiPropertyOptional({ description: 'Permintaan pembelian dengan perkiraan nilai ≤ batas ini langsung disetujui otomatis; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseRequestAuto?: number;
  @ApiPropertyOptional({ description: 'Aktifkan pengendalian selisih harga faktur terhadap PO' }) @IsOptional() @IsBoolean() priceControl?: boolean;
  @ApiPropertyOptional({ description: 'Toleransi kenaikan harga faktur vs PO (%) per baris' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceTolerancePct?: number;
  @ApiPropertyOptional({ description: 'Toleransi harga faktur di atas rata-rata harga beli 90 hari (%)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceBenchmarkPct?: number;
  @ApiPropertyOptional({ enum: ['OFF', 'APPROVAL', 'BLOCK'], description: 'Pengendalian belanja yang melewati anggaran' }) @IsOptional() @IsIn(['OFF', 'APPROVAL', 'BLOCK']) budgetControl?: 'OFF' | 'APPROVAL' | 'BLOCK';
  @ApiPropertyOptional({ description: 'Pembayaran pertama ke supplier wajib disetujui' }) @IsOptional() @IsBoolean() firstSupplierPayment?: boolean;
  @ApiPropertyOptional({ description: 'Penerimaan buta: Gudang mengisi jumlah yang dihitung sendiri' }) @IsOptional() @IsBoolean() blindReceiving?: boolean;
  @ApiPropertyOptional({ description: 'Pengiriman buta: Gudang mengisi jumlah yang dikemas sendiri' }) @IsOptional() @IsBoolean() blindDelivery?: boolean;
  @ApiPropertyOptional({ description: 'Pesanan penjualan bernilai ≥ ini oleh staf perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) salesOrder?: number;
  @ApiPropertyOptional({ description: 'Diskon per baris di atas persen ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(100) salesDiscountMaxPct?: number;
  @ApiPropertyOptional({ description: 'Retur penjualan bernilai ≥ ini oleh staf perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) salesReturn?: number;
  @ApiPropertyOptional({ description: 'Harga jual di bawah harga pokok rata-rata perlu persetujuan' }) @IsOptional() @IsBoolean() salesBelowCost?: boolean;
  @ApiPropertyOptional({ description: 'Pembayaran/retur atas faktur oleh pembuat fakturnya sendiri perlu persetujuan' }) @IsOptional() @IsBoolean() salesSeparateDuties?: boolean;
  @ApiPropertyOptional({ description: 'Pemilik diberi tahu bila penyesuaian stok keluar / selisih opname bernilai ≥ ini; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) stockAlertValue?: number;
  @ApiPropertyOptional({ description: 'Yang mengisi jumlah fisik opname tidak boleh memposting selisihnya' }) @IsOptional() @IsBoolean() stockCountSod?: boolean;
  @ApiPropertyOptional({ description: 'Opname buta: penghitung tidak melihat stok sistem' }) @IsOptional() @IsBoolean() blindCount?: boolean;
  @ApiPropertyOptional({ description: 'Tutup kasir buta: Kasir menghitung uang laci tanpa melihat jumlah yang seharusnya' }) @IsOptional() @IsBoolean() blindCashClose?: boolean;
  @ApiPropertyOptional({ description: 'Penyesuaian stok masuk dengan harga pokok di atas rata-rata lebih dari persen ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1000) stockInCostTolerancePct?: number;
  @ApiPropertyOptional({ description: 'Pembuat transfer gudang tidak boleh menerimanya sendiri' }) @IsOptional() @IsBoolean() transferSod?: boolean;
  @ApiPropertyOptional({ description: 'Pembayaran ke supplier yang rekeningnya baru diubah (hari terakhir) wajib disetujui; 0 = nonaktif' }) @IsOptional() @IsInt() @Min(0) @Max(60) bankChangeHoldDays?: number;
  @ApiPropertyOptional({ description: 'Masa berlaku tautan persetujuan lewat Telegram (jam, 1–72)' }) @IsOptional() @IsInt() @Min(1) @Max(72) telegramLinkHours?: number;
}

export class AssignDto {
  @ApiProperty({ description: 'Pengguna berwenang yang dipilih untuk memutuskan; kosong = semua penyetuju' }) @IsOptional() @IsUUID() approverId?: string;
}

export class DecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ListDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'ALL'] }) @IsOptional() @IsIn(['PENDING', 'ALL']) status?: 'PENDING' | 'ALL';
  @ApiPropertyOptional({ description: 'true = hanya permintaan saya' }) @IsOptional() @IsIn(['true', 'false']) mine?: string;
}

export class LinkDecisionDto {
  @ApiProperty() @IsBoolean() approve: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
