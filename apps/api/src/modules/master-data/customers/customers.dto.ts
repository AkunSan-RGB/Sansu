import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsNpwp } from '../../../common/validators/npwp';

export class CreateCustomerDto {
  @ApiProperty({ example: 'TK-SUMBER' }) @IsString() @MaxLength(30) code: string;
  @ApiProperty({ example: 'Toko Sumber Rejeki' }) @IsString() @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ example: '0123456789012345' }) @IsOptional() @IsString() @IsNpwp() npwp?: string;
  @ApiPropertyOptional({ example: '10000000', description: '0 = tanpa batas' })
  @IsOptional()
  @IsNumberString()
  creditLimit?: string;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
