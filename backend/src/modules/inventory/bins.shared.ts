import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const CREATABLE_KINDS = ['STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE'] as const;

export class PickPlanQuery {
  @ApiPropertyOptional({ description: 'Wajib bila tanpa pesanan penjualan' }) @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ description: 'Daftar kebutuhan: idBarang:jumlah,idBarang:jumlah (satuan dasar)' }) @IsOptional() @IsString() @MaxLength(6000) items?: string;
  @ApiPropertyOptional({ description: 'Ambil kebutuhan dari sisa pesanan penjualan yang belum dikirim' }) @IsOptional() @IsUUID() salesOrderId?: string;
}

export class BinStockQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() binId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ description: 'Cari kode barang / nama / barcode' }) @IsOptional() @IsString() @MaxLength(60) q?: string;
}
