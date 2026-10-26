import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@sansu/shared';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PortalComplaintDto {
  @ApiProperty({ enum: COMPLAINT_CATEGORIES }) @IsIn(COMPLAINT_CATEGORIES) category: ComplaintCategory;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
}
