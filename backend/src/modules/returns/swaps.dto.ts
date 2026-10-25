import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

const REASONS = ['EXPIRED', 'DAMAGED', 'RECALL'] as const;

export class SwapLineDto {
  @ApiProperty() @IsUUID() invoiceLineId: string;
  @ApiProperty({ example: '2', description: 'Jumlah (satuan baris faktur) yang ditarik dan diganti' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ example: 'MIE-2409A' }) @IsOptional() @IsString() @MaxLength(40) lotNo?: string;
}

export class CreateSwapDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty({ enum: REASONS }) @IsIn(REASONS) reason: (typeof REASONS)[number];
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [SwapLineDto] }) @ValidateNested({ each: true }) @Type(() => SwapLineDto) @ArrayMinSize(1) @ArrayMaxSize(200) lines: SwapLineDto[];
}

export class RejectSwapDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

export class SwapQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}
