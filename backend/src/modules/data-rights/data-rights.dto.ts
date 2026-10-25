import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ExportDto {
  @IsString() @MaxLength(200) password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) code?: string;
}

export class DeletionRequestDto {
  @IsString() @MaxLength(200) password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsString() @MaxLength(200) confirmName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsBoolean() ackRetention: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() exportWaived?: boolean;
}

export class HoldDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
