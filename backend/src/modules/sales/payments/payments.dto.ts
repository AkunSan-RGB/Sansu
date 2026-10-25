import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class WriteOffDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ description: 'Jumlah dihapus; kosong = seluruh sisa tagihan' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiProperty({ description: 'Alasan (minimal 5 huruf)' }) @IsString() @MaxLength(300) reason: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
