import { ApiProperty } from '@nestjs/swagger';
import { BUSINESS_MODEL_KEYS, type BusinessModel } from '@sansu/shared';
import { IsIn } from 'class-validator';

export class StartDemoDto {
  @ApiProperty({ enum: BUSINESS_MODEL_KEYS }) @IsIn(BUSINESS_MODEL_KEYS) businessModel: BusinessModel;
}
