import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { BUSINESS_MODEL_KEYS, type BusinessModel } from '@sansu/shared';

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
