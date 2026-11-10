import { ApiProperty } from '@nestjs/swagger';
import { BUSINESS_MODEL_KEYS, SERVICE_PROFILE_KEYS, type BusinessModel, type ServiceProfile } from '@sansu/shared';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';

export class StartDemoDto {
  @ApiProperty({ enum: BUSINESS_MODEL_KEYS }) @IsIn(BUSINESS_MODEL_KEYS) businessModel: BusinessModel;
  /** Hanya untuk Jasa: profil layanan yang didemokan (bawaan Kontraktor) */
  @ApiProperty({ enum: SERVICE_PROFILE_KEYS, required: false }) @IsOptional() @IsIn(SERVICE_PROFILE_KEYS) serviceProfile?: ServiceProfile;
  /** Email pengunjung: menjadi email akun PT DEMO. Kosong = email demo acak (pemanggil lama tetap jalan). */
  @ApiProperty({ example: 'budi@perusahaan.com', required: false })
  @IsOptional()
  @IsEmail({}, { message: 'Format email belum benar' })
  @MaxLength(320)
  email?: string;
}
