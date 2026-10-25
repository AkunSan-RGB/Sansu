import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PettyFundDto {
  @ApiProperty({ description: 'Akun kas kecil di bagan akun (akun kas/bank)' }) @IsUUID() accountId: string;
  @ApiProperty({ description: 'Sumber pengisian: kas besar / bank' }) @IsUUID() fundingAccountId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ description: 'Juru kas (pemegang dana)' }) @IsString() @MinLength(2) @MaxLength(120) custodianName: string;
  @ApiProperty({ example: '2000000', description: 'Dana tetap (plafon)' }) @IsNumberString() imprestAmount: string;
  @ApiProperty({ example: '200000', description: 'Batas nilai per bukti kas kecil' }) @IsNumberString() maxVoucher: string;
}

export class PettyVoucherDto {
  @ApiProperty() @IsUUID() fundId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ description: 'Penerima pembayaran' }) @IsString() @MinLength(2) @MaxLength(120) payee: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) description: string;
  @ApiProperty({ description: 'Akun beban' }) @IsUUID() expenseAccountId: string;
  @ApiProperty({ example: '75000' }) @IsNumberString() amount: string;
  @ApiProperty({ description: 'Nomor nota/kuitansi (wajib)' }) @IsString() @MinLength(1) @MaxLength(60) receiptRef: string;
}

export class PettyReplenishDto {
  @ApiPropertyOptional({ description: 'Kosong = hari ini' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = semua bukti yang belum diganti' }) @IsOptional() @IsArray() @IsUUID('all', { each: true }) voucherIds?: string[];
}

export class PettyVoidDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class PettyFundTopUpDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
