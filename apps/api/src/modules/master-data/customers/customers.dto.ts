import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'TK-SUMBER' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'Toko Sumber Rejeki' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() npwp?: string;
  @ApiPropertyOptional({ example: '10000000', description: '0 = tanpa batas' })
  @IsOptional()
  @IsNumberString()
  creditLimit?: string;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
