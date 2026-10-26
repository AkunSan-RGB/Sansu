import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NON_AIR_CHARGE_KEYS, type NonAirChargeKey } from '@sansu/shared';
import { IsBoolean, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChargeDto {
  @ApiProperty({ example: 'Sambung kembali setelah pemutusan' }) @IsString() @MinLength(3) @MaxLength(120) name: string;
  @ApiProperty({ example: '150000' }) @IsNumberString() defaultPrice: string;
  @ApiProperty({ enum: NON_AIR_CHARGE_KEYS, description: 'Akun pendapatan non-air tempat layanan ini dicatat' }) @IsIn(NON_AIR_CHARGE_KEYS) revenueKey: NonAirChargeKey;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vatable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IssueChargeDto {
  @ApiProperty() @IsUUID() chargeId: string;
  @ApiProperty({ description: 'Pelanggan yang ditagih (lewat sambungan atau langsung)' }) @IsUUID() customerId: string;
  @ApiPropertyOptional({ description: 'Sambungan terkait (dicantumkan di keterangan faktur)' }) @IsOptional() @IsUUID() connectionId?: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsNumberString() qty?: string;
  @ApiPropertyOptional({ description: 'Kosong = harga bawaan layanan' }) @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
