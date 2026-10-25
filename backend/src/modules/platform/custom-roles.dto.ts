import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES } from '@sansu/shared';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../db/schema';

const BASE_ROLES = ROLES.filter((r) => r !== 'OWNER');

export class RoleDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40) name: string;
  @ApiProperty({ enum: BASE_ROLES }) @IsIn(BASE_ROLES) baseRole: Role;
  @ApiPropertyOptional({ type: [String], description: 'Hak tulis yang dicabut, mis. "POST /payments"' }) @IsOptional() @IsArray() @ArrayMaxSize(400) @IsString({ each: true }) denied?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(40) name?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(400) @IsString({ each: true }) denied?: string[];
}

export class CatalogQueryDto {
  @ApiProperty({ enum: BASE_ROLES }) @IsIn(BASE_ROLES) baseRole: Role;
}
