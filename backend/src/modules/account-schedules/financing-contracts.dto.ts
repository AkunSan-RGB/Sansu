import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const CONTRACT_KINDS = ['LOAN', 'LEASE', 'PREPAID'] as const;
export const CONTRACT_METHODS = ['ANNUITY', 'STRAIGHT_PRINCIPAL', 'BULLET', 'STRAIGHT_LINE'] as const;

export class ContractDto {
  @ApiProperty({ enum: CONTRACT_KINDS, description: 'LOAN pinjaman, LEASE sewa pembiayaan, PREPAID biaya dibayar di muka' }) @IsIn(CONTRACT_KINDS) kind: (typeof CONTRACT_KINDS)[number];
  @ApiProperty({ example: 'Kredit modal kerja Bank X' }) @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional({ description: 'Pemberi pinjaman, lessor, atau pemasok' }) @IsOptional() @IsString() @MaxLength(120) counterparty?: string;
  @ApiProperty({ description: 'Akun neraca tempat saldo kontrak dicatat' }) @IsUUID() accountId: string;
  @ApiPropertyOptional({ description: 'Akun beban bunga (pinjaman/sewa) atau beban amortisasi (dibayar di muka)' }) @IsOptional() @IsUUID() expenseAccountId?: string;
  @ApiProperty({ example: '2026-01-15' }) @IsDateString() startDate: string;
  @ApiProperty({ example: 36 }) @IsInt() @Min(1) @Max(600) termMonths: number;
  @ApiProperty({ example: '120000000', description: 'Pokok pinjaman / nilai kini liabilitas sewa / jumlah dibayar di muka' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ example: '12', description: 'Bunga per tahun (%); wajib untuk pinjaman dan sewa' }) @IsOptional() @IsNumberString() ratePct?: string;
  @ApiProperty({ enum: CONTRACT_METHODS }) @IsIn(CONTRACT_METHODS) method: (typeof CONTRACT_METHODS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateContractDto extends PartialType(ContractDto) {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'CLOSED'] }) @IsOptional() @IsIn(['ACTIVE', 'CLOSED']) status?: 'ACTIVE' | 'CLOSED';
}
