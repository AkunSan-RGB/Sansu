import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsUUID, IsInt, IsNumber, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { LEGAL_FORMS, RECIPE_TERMS, REPORTING_FRAMEWORKS, type ReportingFramework, TAX_SCHEMES, VAT_ROUNDINGS, type VatRounding } from '@sansu/shared';
import { StrongPassword } from '../auth/dto/auth.dto';
import { Role, roleEnum } from '../../db/schema';
import { IsNpwp } from '../../common/validators/npwp';

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: roleEnum.enumValues }) @IsOptional() @IsIn(roleEnum.enumValues) role?: Role;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Peran khusus (hanya Pemilik); null = kembali ke peran bawaan', nullable: true }) @IsOptional() @IsUUID() customRoleId?: string | null;
  @ApiPropertyOptional({ description: 'Atur ulang kata sandi' }) @IsOptional() @StrongPassword() password?: string;
  @ApiPropertyOptional({ description: 'Matikan verifikasi 2 langkah pengguna ini (mis. HP hilang)' })
  @IsOptional()
  @IsBoolean()
  resetTwoFactor?: boolean;
  @ApiPropertyOptional({ description: 'Batasi ke gudang tertentu; [] = semua gudang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  warehouseIds?: string[];
  @ApiPropertyOptional({ description: 'Batasi ke cabang tertentu; [] = semua cabang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class UpdateCompanyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional({ example: '0123456789012345' }) @IsOptional() @IsString() @IsNpwp() npwp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ example: '11' }) @IsOptional() @IsNumberString() ppnRate?: string;
  @ApiPropertyOptional({ description: 'Pengusaha Kena Pajak (memungut PPN)' }) @IsOptional() @IsBoolean() pkp?: boolean;
  @ApiPropertyOptional({ description: 'Harga kasir sudah termasuk PPN' }) @IsOptional() @IsBoolean() posPricesIncludeVat?: boolean;
  @ApiPropertyOptional({ description: 'Bawaan harga penawaran/pesanan termasuk PPN' }) @IsOptional() @IsBoolean() salesPricesIncludeVat?: boolean;
  @ApiPropertyOptional({ description: 'Hari libur nasional / cuti bersama (YYYY-MM-DD) untuk menggeser tenggat pajak', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'Tanggal libur harus berformat YYYY-MM-DD' })
  holidays?: string[];
  @ApiPropertyOptional({ enum: VAT_ROUNDINGS, description: 'Pembulatan PPN dokumen ke rupiah penuh' }) @IsOptional() @IsIn(VAT_ROUNDINGS) vatRounding?: VatRounding;
  @ApiPropertyOptional({ description: 'Pajak restoran daerah (PB1/PBJT) menggantikan PPN pada penjualan kasir' }) @IsOptional() @IsBoolean() localTaxEnabled?: boolean;
  @ApiPropertyOptional({ example: '10', description: 'Tarif pajak daerah (%), 0–10 menurut peraturan daerah' }) @IsOptional() @IsNumberString() @Matches(/^(10(\.0+)?|[0-9](\.\d{1,2})?)$/, { message: 'Tarif pajak daerah harus 0–10 persen' }) localTaxRate?: string;
}

export class BrandingDto {
  @ApiPropertyOptional({
    description: 'Logo sebagai data URL PNG/JPEG/WebP (maks. ±300 KB); kosongkan untuk menghapus',
  })
  @IsOptional()
  @IsString()
  @MaxLength(420_000, { message: 'Logo terlalu besar (maks. ±300 KB)' })
  @Matches(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, {
    message: 'Logo harus gambar PNG, JPG, atau WebP',
  })
  logo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) email?: string;
  @ApiPropertyOptional({ example: 'BCA 123-456-7890 a.n. PT Maju Jaya' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bankInfo?: string;
  @ApiPropertyOptional({ example: 'Barang yang sudah dibeli tidak dapat dikembalikan.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoiceNote?: string;
}

export class TermsSettingsDto {
  @ApiProperty({ enum: RECIPE_TERMS }) @IsIn(RECIPE_TERMS as unknown as string[]) recipe: string;
}

export class ReportingSettingsDto {
  @ApiPropertyOptional({ enum: REPORTING_FRAMEWORKS }) @IsOptional() @IsIn(REPORTING_FRAMEWORKS) framework?: ReportingFramework;
  @ApiPropertyOptional({ enum: LEGAL_FORMS }) @IsOptional() @IsIn(LEGAL_FORMS) legalForm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) businessActivity?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1900) @Max(2100) establishedYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) directorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) directorTitle?: string;
  @ApiPropertyOptional({ enum: TAX_SCHEMES }) @IsOptional() @IsIn(TAX_SCHEMES) taxScheme?: 'GENERAL' | 'FINAL_UMKM';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1980) @Max(2100) taxRegisteredYear?: number;
  @ApiPropertyOptional({ description: 'Batas kapitalisasi aset tetap (Rp per unit); 0 = kapitalisasi semua' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  capitalizationThreshold?: number;
}

export class PayrollSettingsDto {
  @ApiPropertyOptional({ enum: [5, 6] }) @IsOptional() @IsIn([5, 6]) workDaysPerWeek?: 5 | 6;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) bpjsKesCap?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) jpCap?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) jkkRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) jkmRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) overtimeDivisor?: number;
}
