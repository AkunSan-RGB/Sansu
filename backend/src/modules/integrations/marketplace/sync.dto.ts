import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { type ProviderKey } from './providers';
import { KEYS } from './sync.shared';

export class StartConnectionDto {
  @ApiProperty({ enum: KEYS }) @IsIn(KEYS) provider: ProviderKey;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
