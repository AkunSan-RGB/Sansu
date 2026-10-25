import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsDateString, IsIn, IsInt, IsNumberString, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CashCountItemDto {
  @ApiProperty({ enum: ['ADD', 'LESS'] }) @IsIn(['ADD', 'LESS']) type: 'ADD' | 'LESS';
  @ApiProperty({ example: 'Bon sementara pembelian ATK (belum dicatat)' })
  @IsString()
  @MaxLength(200)
  description: string;
  @ApiProperty({ example: '150000' }) @IsNumberString() amount: string;
}

export class CreateCashCountDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Nama pemegang kas' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  custodianName?: string;
}

export class UpdateCashCountDto {
  @ApiPropertyOptional({ description: 'Jumlah lembar/keping per pecahan, mis. {"K100000": 12}' })
  @IsOptional()
  @IsObject()
  denominations?: Record<string, number>;
  @ApiPropertyOptional({ type: [CashCountItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CashCountItemDto)
  @ArrayMaxSize(50)
  items?: CashCountItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) custodianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'Penjelasan selisih' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RejectCashCountDto {
  @ApiProperty() @IsString() @MaxLength(300) reason: string;
}

export class CashCountSettingsDto {
  @ApiProperty({ example: 50000 }) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) approvalThreshold: number;
}
