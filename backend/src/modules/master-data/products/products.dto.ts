import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ProductUomDto {
  @ApiProperty({ example: 'DUS' }) @IsString() @MaxLength(10) @Matches(/^[A-Z0-9]+$/) uom: string;
  @ApiProperty({ example: '24', description: 'Jumlah satuan dasar per satuan ini' }) @IsNumberString() factor: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'IDM-GRG-85' }) @IsString() @MaxLength(40) sku: string;
  @ApiProperty({ example: 'Mi Goreng 85g' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional({ example: 'Makanan' }) @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ example: 'PCS', default: 'PCS' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]+$/)
  baseUom?: string;
  @ApiProperty({ example: '3500', description: 'Harga jual per satuan dasar (belum PPN)' })
  @IsNumberString()
  sellPrice: string;
  @ApiPropertyOptional({ example: '8991234567890', description: 'Barcode / EAN untuk kasir' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  barcode?: string;
  @ApiPropertyOptional({ type: [ProductUomDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductUomDto)
  uoms?: ProductUomDto[];
  @ApiPropertyOptional({ enum: ['GOODS', 'SEMI'], description: 'SEMI = barang setengah jadi (akun persediaan tersendiri; hanya jenis usaha Produksi/Manufaktur)' })
  @IsOptional()
  @IsIn(['GOODS', 'SEMI'])
  inventoryKind?: 'GOODS' | 'SEMI';
  @ApiPropertyOptional({ description: 'Menu dibuat saat dipesan: kasir memotong bahan sesuai resep aktif dan HPP dihitung dari bahan (butuh resep aktif)' })
  @IsOptional()
  @IsBoolean()
  madeToOrder?: boolean;
  @ApiPropertyOptional({ description: 'Layanan tanpa stok (jenis usaha Jasa): dijual di kasir; bahan habis pakai opsional lewat resep aktif' })
  @IsOptional()
  @IsBoolean()
  isService?: boolean;
  @ApiPropertyOptional({ example: 3, description: 'Umur simpan (hari). Hasil produksi barang ini otomatis dipantau kedaluwarsanya; kosong = tidak dipantau' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  shelfLifeDays?: number | null;
  @ApiPropertyOptional({ example: '0.085', description: 'Berat per satuan dasar (kg); dasar muatan rute pengiriman. Kosong = belum diisi' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  weightKg?: string | null;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class MergeCategoriesDto {
  @ApiProperty({ type: [String], description: 'Kategori yang digabung (ejaan persis seperti di data)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  from: string[];
  @ApiPropertyOptional({ description: 'Kategori tujuan; kosong = hapus kategori (produk menjadi tanpa kategori)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  to?: string | null;
  @ApiPropertyOptional({ description: 'Hanya hitung produk yang terdampak (pratinjau)', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class AddCategoryDto {
  @ApiProperty({ example: 'Makanan Beku', description: 'Kategori baru untuk daftar pilihan form produk' }) @IsString() @MaxLength(60) name: string;
}

export class ListQueryDto {
  @ApiPropertyOptional({ description: 'Cari kode/nama' }) @IsOptional() @IsString() q?: string;
}
