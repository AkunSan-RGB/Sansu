import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateRunDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional({ example: '2026-10-28' }) @IsOptional() @IsDateString() payDate?: string;
}

export class UpdatePayslipDto {
  @ApiPropertyOptional({ example: '250000', description: 'Bonus / insentif / THR bulan ini' }) @IsOptional() @IsNumberString() otherIncome?: string;
  @ApiPropertyOptional({ example: '100000', description: 'Potongan kasbon / lainnya' }) @IsOptional() @IsNumberString() otherDeduction?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class PayRunDto {
  @ApiPropertyOptional({ description: 'Rekening pembayar; kosong = Bank' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
