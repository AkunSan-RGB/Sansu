import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class WritedownLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ description: 'Nilai realisasi neto per satuan dasar', example: '8000' })
  @IsNumberString()
  newCost!: string;
}

export class CreateWritedownDto {
  @ApiProperty({ example: '2026-12-31' }) @IsDateString() date!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiProperty({ example: 'Harga jual turun di bawah harga pokok (barang mendekati kedaluwarsa)' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
  @ApiPropertyOptional({ enum: ['WRITEDOWN', 'REVERSAL'], description: 'REVERSAL = pemulihan nilai (harga naik lagi)' })
  @IsOptional()
  @IsIn(['WRITEDOWN', 'REVERSAL'])
  kind?: 'WRITEDOWN' | 'REVERSAL';
  @ApiProperty({ type: [WritedownLineDto] })
  @ValidateNested({ each: true })
  @Type(() => WritedownLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  lines!: WritedownLineDto[];
}
