import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSET_CONDITIONS, NETWORK_ASSET_TYPES, PRIORITIES, WORK_ORDER_STATUSES, WORK_ORDER_TYPES, type AssetCondition, type NetworkAssetType, type Priority, type WorkOrderStatus, type WorkOrderType } from '@sansu/shared';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class NetworkAssetDto {
  @ApiProperty({ example: 'RSV-01' }) @IsString() @MinLength(2) @MaxLength(30) code: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) name: string;
  @ApiProperty({ enum: NETWORK_ASSET_TYPES }) @IsIn(NETWORK_ASSET_TYPES) type: NetworkAssetType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() installedOn?: string;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class WorkOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() complaintId?: string;
  @ApiProperty({ enum: WORK_ORDER_TYPES }) @IsIn(WORK_ORDER_TYPES) type: WorkOrderType;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES) priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedOn?: string;
}
export class WorkOrderStatusDto {
  @ApiProperty({ enum: WORK_ORDER_STATUSES }) @IsIn(WORK_ORDER_STATUSES) status: WorkOrderStatus;
  @ApiPropertyOptional({ description: 'Wajib saat selesai: hasil pekerjaan' }) @IsOptional() @IsString() @MaxLength(1000) result?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() laborCost?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() materialCost?: string;
  @ApiPropertyOptional({ description: 'Kondisi aset sesudah dikerjakan' }) @IsOptional() @IsIn(ASSET_CONDITIONS) assetCondition?: AssetCondition;
}
