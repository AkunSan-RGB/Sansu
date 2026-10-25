import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'CB-BKS' }) @IsString() @MinLength(2) @MaxLength(20) code: string;
  @ApiProperty({ example: 'Cabang Bekasi' }) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignWarehouseDto {
  @ApiPropertyOptional({ description: 'Cabang pemilik gudang/toko; kosong = lepas dari cabang' }) @IsOptional() @IsUUID() branchId?: string | null;
}

export class ToggleBranchesDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
