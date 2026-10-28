import { ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, type Role } from '@sansu/shared';
import { IsArray, IsIn, IsObject, IsOptional } from 'class-validator';

export class RoleCustomizationDto {
  @ApiPropertyOptional({ description: 'Sebutan peran khusus perusahaan ini, mis. { "SALES": "Admin akademik" }' }) @IsOptional() @IsObject() labels?: Partial<Record<Role, string>>;
  @ApiPropertyOptional({ enum: ROLES, isArray: true, description: 'Peran yang tidak ditawarkan lagi (Pemilik dan Admin tidak dapat disembunyikan)' }) @IsOptional() @IsArray() @IsIn(ROLES, { each: true }) hidden?: Role[];
  @ApiPropertyOptional({ enum: ROLES, isArray: true, description: 'Peran tambahan yang ditawarkan walau jenis usahanya tidak menawarkannya' }) @IsOptional() @IsArray() @IsIn(ROLES, { each: true }) extra?: Role[];
}
