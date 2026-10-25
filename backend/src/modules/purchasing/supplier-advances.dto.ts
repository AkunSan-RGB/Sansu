import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSupplierAdvanceDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiPropertyOptional({ description: 'Pesanan pembelian yang dibayar DP-nya (dianjurkan)' }) @IsOptional() @IsUUID() purchaseOrderId?: string;
  @ApiProperty({ example: '5000000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @ApiPropertyOptional({ description: 'Akun kas/bank pembayar; kosong = Bank (atau Kas bila tunai)' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class ApplySupplierAdvanceDto {
  @ApiProperty() @IsUUID() purchaseInvoiceId: string;
  @ApiProperty({ example: '2000000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

export class RefundSupplierAdvanceDto {
  @ApiProperty({ example: '1000000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiProperty({ description: 'Alasan/bukti pengembalian (min. 5 huruf)' }) @IsString() @MinLength(5) @MaxLength(255) note: string;
}

export class VoidSupplierAdvanceDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class AdvanceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ description: '1 = hanya yang masih punya sisa' }) @IsOptional() @IsIn(['1', '0']) open?: string;
}
