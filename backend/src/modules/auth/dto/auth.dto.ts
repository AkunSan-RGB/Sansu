import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** Kata sandi: 8–72 karakter (batas bcrypt), minimal satu huruf dan satu angka */
const StrongPassword = () => (target: object, key: string) => {
  IsString()(target, key);
  MinLength(8, { message: 'Kata sandi minimal 8 karakter' })(target, key);
  MaxLength(72, { message: 'Kata sandi maksimal 72 karakter' })(target, key);
  Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Kata sandi harus mengandung huruf dan angka' })(target, key);
};
export { StrongPassword };
import { BUSINESS_MODEL_KEYS, type BusinessModel } from '@sansu/shared';
import { Role, roleEnum } from '../../../db/schema';

export class RegisterDto {
  @ApiProperty({ example: 'CV Maju Jaya Distribusi' }) @IsString() @MaxLength(160) companyName: string;
  @ApiProperty({ example: 'Budi Santoso' }) @IsString() @MaxLength(120) name: string;
  @ApiProperty({ example: 'budi@majujaya.co.id' }) @IsEmail() email: string;
  @ApiProperty({ example: 'rahasia123' }) @StrongPassword() password: string;
  @ApiPropertyOptional({ enum: BUSINESS_MODEL_KEYS, description: 'Model bisnis — menentukan aplikasi bawaan' })
  @IsOptional()
  @IsIn(BUSINESS_MODEL_KEYS)
  businessModel?: BusinessModel;
  @ApiPropertyOptional({ description: 'Pendaftar menyetujui Syarat Layanan & Kebijakan Privasi (dicatat bersama waktu & versi)' })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@demo.id' }) @IsEmail() email: string;
  @ApiProperty({ example: 'demo12345' }) @IsString() @MaxLength(200) password: string;
}

export class CreateUserDto {
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @StrongPassword() password: string;
  @ApiPropertyOptional({ enum: roleEnum.enumValues, default: 'SALES' }) @IsOptional() @IsIn(roleEnum.enumValues) role?: Role;
  @ApiPropertyOptional({ description: 'Batasi ke gudang tertentu; kosong = semua gudang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  warehouseIds?: string[];
  @ApiPropertyOptional({ description: 'Batasi ke cabang tertentu (laporan & data cabang itu saja); kosong = semua cabang', type: [String] })
  @IsOptional()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(200) currentPassword: string;
  @ApiProperty() @StrongPassword() newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'budi@majujaya.co.id' }) @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token dari tautan email' }) @IsString() @MinLength(20) @MaxLength(200) token: string;
  @ApiProperty() @StrongPassword() password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token dari tautan email' }) @IsString() @MinLength(20) @MaxLength(200) token: string;
}
