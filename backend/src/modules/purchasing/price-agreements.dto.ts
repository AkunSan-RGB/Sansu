import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateAgreementDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '9000', description: 'Rupiah per satuan dasar, sebelum PPN' }) @IsNumberString() price: string;
  @ApiProperty({ example: '2026-11-01' }) @IsDateString() validFrom: string;
  @ApiProperty({ example: '2027-10-31' }) @IsDateString() validTo: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class DecideAgreementDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class LookupDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
