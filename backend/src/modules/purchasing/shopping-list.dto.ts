import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DraftOrderDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
}

export class ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
