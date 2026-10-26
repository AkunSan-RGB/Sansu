import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COMPLAINT_CATEGORIES, COMPLAINT_CHANNELS, COMPLAINT_STATUSES, PRIORITIES, type ComplaintCategory, type ComplaintChannel, type ComplaintStatus, type Priority } from '@sansu/shared';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ComplaintDto {
  @ApiPropertyOptional({ description: 'Sambungan yang dilaporkan (pelanggan terisi otomatis)' }) @IsOptional() @IsUUID() connectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) reporterName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) reporterPhone?: string;
  @ApiProperty({ enum: COMPLAINT_CATEGORIES }) @IsIn(COMPLAINT_CATEGORIES) category: ComplaintCategory;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES) priority?: Priority;
  @ApiPropertyOptional({ enum: COMPLAINT_CHANNELS }) @IsOptional() @IsIn(COMPLAINT_CHANNELS) channel?: ComplaintChannel;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) location?: string;
}
export class AssignDto {
  @ApiProperty() @IsUUID() assigneeId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ComplaintStatusDto {
  @ApiProperty({ enum: COMPLAINT_STATUSES }) @IsIn(COMPLAINT_STATUSES) status: ComplaintStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ description: 'Wajib saat selesai: apa yang dikerjakan' }) @IsOptional() @IsString() @MaxLength(1000) resolution?: string;
}
export class NoteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) note: string;
}
