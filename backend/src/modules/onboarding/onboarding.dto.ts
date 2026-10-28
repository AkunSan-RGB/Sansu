import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';
import { BUSINESS_MODEL_KEYS, SERVICE_PROFILE_KEYS, type BusinessModel, type ServiceProfile } from '@sansu/shared';

export class BusinessModelDto {
  @ApiProperty({ enum: BUSINESS_MODEL_KEYS }) @IsIn(BUSINESS_MODEL_KEYS) model: BusinessModel;
  @ApiProperty({
    required: false,
    description: 'Nyalakan aplikasi yang disarankan untuk model ini (aplikasi lain tidak dimatikan)',
  })
  @IsOptional()
  @IsBoolean()
  applyApps?: boolean;
}

export class DismissDto {
  @ApiProperty() @IsBoolean() dismissed: boolean;
}

export class ServiceProfilesDto {
  @ApiProperty({ enum: SERVICE_PROFILE_KEYS, isArray: true, description: 'Satu atau lebih profil layanan (hanya jenis usaha Jasa)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SERVICE_PROFILE_KEYS, { each: true })
  profiles: ServiceProfile[];
}
