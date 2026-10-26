import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RouteDto {
  @ApiProperty({ example: 'R-01' }) @IsString() @MinLength(2) @MaxLength(20) code: string;
  @ApiProperty({ example: 'Rute Griya Asri' }) @IsString() @MinLength(3) @MaxLength(120) name: string;
  @ApiPropertyOptional({ description: 'Petugas baca meter' }) @IsOptional() @IsUUID() readerId?: string;
  @ApiPropertyOptional({ description: 'Kolektor penagihan' }) @IsOptional() @IsUUID() collectorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class AssignRouteDto {
  @ApiProperty() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) connectionIds: string[];
  @ApiPropertyOptional({ description: 'Kosong = keluarkan dari rute' }) @IsOptional() @IsUUID() routeId?: string;
}
