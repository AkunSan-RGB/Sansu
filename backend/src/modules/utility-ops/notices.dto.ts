import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NOTICE_CHANNELS, NOTICE_KINDS, type NoticeChannel, type NoticeKind } from '@sansu/shared';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class NoticeItemDto {
  @ApiProperty() @IsUUID() connectionId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() invoiceId?: string;
}
export class NoticeLogDto {
  @ApiProperty({ enum: NOTICE_KINDS }) @IsIn(NOTICE_KINDS) kind: NoticeKind;
  @ApiProperty({ enum: NOTICE_CHANNELS }) @IsIn(NOTICE_CHANNELS) channel: NoticeChannel;
  @ApiProperty({ type: [NoticeItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => NoticeItemDto) items: NoticeItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
