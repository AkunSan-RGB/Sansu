import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { INVOICE_STATUSES, InvoiceStatus, PURCHASE_ORDER_STATUSES, PurchaseOrderStatus } from '@sansu/shared';
import { IsNpwp } from '../../common/validators/npwp';

export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-INDOFOOD' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'PT Sumber Pangan Prima' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ example: '0123456789012345' }) @IsOptional() @IsString() @IsNpwp() npwp?: string;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PurchaseLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ example: 'DUS' }) @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '10' }) @IsNumberString() qty: string;
  @ApiProperty({ example: '116000', description: 'Harga beli per satuan, belum PPN' }) @IsNumberString() price: string;
  @ApiPropertyOptional({ example: '0' }) @IsOptional() @IsNumberString() discountPct?: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiProperty({ type: [PurchaseLineDto] })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  @ArrayMinSize(1)
  lines: PurchaseLineDto[];
}

export class PurchaseOrderQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_ORDER_STATUSES }) @IsOptional() @IsIn(PURCHASE_ORDER_STATUSES) status?: PurchaseOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
}

export class CreatePurchaseInvoiceDto {
  @ApiProperty() @IsUUID() purchaseOrderId: string;
  @ApiProperty({ example: 'INV/SPP/2026/0912', description: 'Nomor faktur dari supplier' })
  @IsString()
  @MaxLength(60)
  supplierInvoiceNo: string;
  @ApiPropertyOptional({ example: '2026-10-03', description: 'Tanggal terima barang & faktur' })
  @IsOptional()
  @IsDateString()
  date?: string;
  @ApiPropertyOptional({
    type: () => [OrderLineQtyDto],
    description: 'Jumlah yang ditagih per baris pesanan. Kosong = seluruh barang yang sudah diterima dan belum ditagih (pesanan tanpa penerimaan: diterima dan ditagih sekaligus).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderLineQtyDto)
  @ArrayMinSize(1)
  lines?: OrderLineQtyDto[];
}

/** Jumlah per baris pesanan pembelian (penerimaan barang atau penagihan sebagian) */
export class OrderLineQtyDto {
  @ApiProperty() @IsUUID() orderLineId: string;
  @ApiProperty({ example: '6' }) @IsNumberString() qty: string;
}

export class CreateGoodsReceiptDto {
  @ApiPropertyOptional({ example: '2026-10-03', description: 'Tanggal barang diterima' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Nomor surat jalan dari supplier' }) @IsOptional() @IsString() @MaxLength(60) supplierDeliveryNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ type: () => [OrderLineQtyDto], description: 'Jumlah diterima per baris; kosong = seluruh sisa pesanan' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderLineQtyDto)
  @ArrayMinSize(1)
  lines?: OrderLineQtyDto[];
}

export class CancelGoodsReceiptDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

export class PurchaseInvoiceQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
}

export class CreateSupplierPaymentDto {
  @ApiProperty() @IsUUID() purchaseInvoiceId: string;
  @ApiProperty({ example: '500000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ description: 'Akun kas/bank pembayar; kosong = Bank' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class BillLineDto {
  @ApiProperty({ enum: ['EXPENSE', 'ASSET'], description: 'EXPENSE = biaya ke akun beban, ASSET = aset tetap baru' })
  @IsIn(['EXPENSE', 'ASSET'])
  type: 'EXPENSE' | 'ASSET';
  @ApiProperty({ example: 'Jasa servis AC gudang' }) @IsString() @MaxLength(200) description: string;
  @ApiPropertyOptional({ description: 'EXPENSE: akun beban / aset lain' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ description: 'ASSET: kategori aset tetap' }) @IsOptional() @IsUUID() assetCategoryId?: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsNumberString() qty?: string;
  @ApiProperty({ example: '1500000', description: 'Harga satuan sebelum PPN' }) @IsNumberString() price: string;
  @ApiPropertyOptional({ description: 'ASSET: umur manfaat (bulan); kosong = ikut kategori' }) @IsOptional() @IsInt() @Min(0) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) location?: string;
  @ApiPropertyOptional({ description: 'Baris ini objek PPh yang dipotong (jasa / sewa)' }) @IsOptional() @IsBoolean() withholding?: boolean;
}

export class CreateBillDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty({ example: 'INV-0931' }) @IsString() @MaxLength(60) supplierInvoiceNo: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = tanggal + termin supplier' }) @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
  @ApiPropertyOptional({ description: 'Faktur dikenai PPN (tarif perusahaan)', default: true }) @IsOptional() @IsBoolean() withVat?: boolean;
  @ApiPropertyOptional({ description: 'Biaya langsung proyek (usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ enum: ['PPH23', 'PPH4_2'], description: 'PPh yang dipotong dari pembayaran' }) @IsOptional() @IsIn(['PPH23', 'PPH4_2']) withholdingType?: 'PPH23' | 'PPH4_2';
  @ApiPropertyOptional({ example: '2', description: 'Tarif PPh dipotong (%) — PPh 23 jasa 2%, sewa bangunan 4(2) 10%' })
  @IsOptional()
  @IsNumberString()
  withholdingRate?: string;
  @ApiProperty({ type: [BillLineDto] })
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  @ArrayMinSize(1)
  lines: BillLineDto[];
}
