import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export class TransferLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '24', description: 'Satuan dasar' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ description: 'Gudang asal memakai rak: rak yang diutamakan untuk diambil' }) @IsOptional() @IsUUID() fromBinId?: string;
  @ApiPropertyOptional({ description: 'Kirim langsung ke gudang tujuan yang memakai rak: rak tujuan' }) @IsOptional() @IsUUID() toBinId?: string;
}

export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromWarehouseId: string;
  @ApiProperty() @IsUUID() toWarehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiPropertyOptional({
    enum: ['DIRECT', 'IN_TRANSIT'],
    description: 'DIRECT = langsung diterima; IN_TRANSIT = dikirim, diterima belakangan oleh gudang tujuan',
  })
  @IsOptional()
  @IsIn(['DIRECT', 'IN_TRANSIT'])
  mode?: 'DIRECT' | 'IN_TRANSIT';
  @ApiProperty({ type: [TransferLineDto] })
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  lines: TransferLineDto[];
}

export class ReceiveLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '24', description: 'Jumlah yang benar-benar diterima (satuan dasar)' })
  @IsNumberString()
  receivedQty: string;
  @ApiPropertyOptional({ description: 'Gudang tujuan memakai rak: rak tempat barang diletakkan' }) @IsOptional() @IsUUID() binId?: string;
}

export class ReceiveTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ type: [ReceiveLineDto], description: 'Kosong = semua diterima sesuai kiriman' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  @ArrayMaxSize(1000)
  lines?: ReceiveLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class CancelTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class CreateCountDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Hanya produk kategori ini' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
  @ApiPropertyOptional({ description: 'Gudang berrak: hitung hanya isi satu rak' }) @IsOptional() @IsUUID() binId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class CountLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ nullable: true, description: 'Jumlah fisik (satuan dasar); null = belum dihitung' })
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  countedQty: string | null;
}

export class UpdateCountDto {
  @ApiProperty({ type: [CountLineDto] })
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  @ArrayMaxSize(20000)
  lines: CountLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class MinimumItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ nullable: true, description: 'null / 0 = hapus stok minimum' })
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  minQty: string | null;
}

export class SaveMinimumsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [MinimumItemDto] })
  @ValidateNested({ each: true })
  @Type(() => MinimumItemDto)
  @ArrayMaxSize(20000)
  items: MinimumItemDto[];
}
