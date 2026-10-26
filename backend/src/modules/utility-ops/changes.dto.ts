import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHANGE_KINDS, type ChangeKind } from '@sansu/shared';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChangeRequestDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiProperty({ enum: CHANGE_KINDS }) @IsIn(CHANGE_KINDS) kind: ChangeKind;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @ApiPropertyOptional({ description: 'Balik nama: pelanggan pemilik baru' }) @IsOptional() @IsUUID() newCustomerId?: string;
  @ApiPropertyOptional({ description: 'Ganti golongan: tarif baru' }) @IsOptional() @IsUUID() newTariffId?: string;
  @ApiPropertyOptional({ description: 'Ubah alamat: alamat baru' }) @IsOptional() @IsString() @MaxLength(300) newAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) newZone?: string;
}
export class DecideChangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class RejectChangeDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) note: string;
}
