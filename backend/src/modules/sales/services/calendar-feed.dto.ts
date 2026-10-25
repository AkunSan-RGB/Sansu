import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class FeedDto {
  @ApiProperty({ example: 'Kalender tim' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiPropertyOptional({ description: 'Kosong = semua sumber daya' }) @IsOptional() @IsUUID() resourceId?: string;
}
