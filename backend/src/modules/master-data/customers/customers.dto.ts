import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsLatitude, IsLongitude, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsNpwp } from '../../../common/validators/npwp';

export class CreateCustomerDto {
  @ApiProperty({ example: 'TK-SUMBER' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'Toko Sumber Rejeki' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ example: 'keuangan@pelanggan.co.id', description: 'Untuk pengingat tagihan otomatis' }) @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ example: '0123456789012345' }) @IsOptional() @IsString() @IsNpwp() npwp?: string;
  @ApiPropertyOptional({ example: '10000000', description: '0 = tanpa batas' })
  @IsOptional()
  @IsNumberString()
  creditLimit?: string;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @ApiPropertyOptional({ example: -6.2, description: 'Koordinat outlet (untuk memeriksa kunjungan sales kanvas)' }) @IsOptional() @IsLatitude() geoLat?: number;
  @ApiPropertyOptional({ example: 106.8 }) @IsOptional() @IsLongitude() geoLng?: number;
  @ApiPropertyOptional({ description: 'Peritel modern: pesanan wajib membawa nomor PO outlet' }) @IsOptional() @IsBoolean() requirePo?: boolean;
  @ApiPropertyOptional({ description: 'Daftar harga pelanggan (segmen); kosong = harga jual master' }) @IsOptional() @IsUUID() priceListId?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
