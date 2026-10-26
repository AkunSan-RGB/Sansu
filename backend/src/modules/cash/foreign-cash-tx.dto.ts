import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const FOREIGN_CASH_KINDS = ['IN', 'OUT', 'BUY', 'SELL', 'MOVE'] as const;
export type ForeignCashKind = (typeof FOREIGN_CASH_KINDS)[number];

export class CreateForeignCashDto {
  @ApiProperty({ enum: FOREIGN_CASH_KINDS, description: 'IN/OUT: terima/bayar valas lewat akun lawan; BUY: beli valas dengan Rupiah; SELL: jual valas ke Rupiah; MOVE: pindah antar rekening valas sama mata uang' })
  @IsIn(FOREIGN_CASH_KINDS) kind: ForeignCashKind;
  @ApiProperty({ description: 'IN/OUT/SELL/MOVE: rekening valas; BUY: rekening Rupiah sumber' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional({ description: 'BUY/MOVE: rekening valas tujuan; SELL: rekening Rupiah tujuan' }) @IsOptional() @IsUUID() toCashAccountId?: string;
  @ApiProperty({ example: '1000.00', description: 'Jumlah dalam valas' }) @IsNumberString() amountForeign: string;
  @ApiPropertyOptional({ example: '16000000', description: 'BUY/SELL: Rupiah yang benar-benar dibayar/diterima' }) @IsOptional() @IsNumberString() amountIdr?: string;
  @ApiPropertyOptional({ example: '16100', description: 'IN/OUT: kurs transaksi; kosong = kurs tersimpan terbaru' }) @IsOptional() @IsNumberString() fxRate?: string;
  @ApiPropertyOptional({ description: 'IN/OUT: akun lawan (pendapatan, beban, modal, ...)' }) @IsOptional() @IsUUID() counterAccountId?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: 'Beli USD untuk bayar pemasok' }) @IsString() @MaxLength(255) description: string;
  @ApiPropertyOptional({ example: 'Bukti transfer 123' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
