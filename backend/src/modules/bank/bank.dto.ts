import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ArrayMinSize, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CASH_IN_SOURCE_KEYS, type CashInSourceKey } from '@sansu/shared';

export class StatementLineDto {
  @ApiProperty({ example: '2026-09-03' }) @IsDateString() date: string;
  @ApiProperty({ example: 'TRSF E-BANKING CR 0309/FTSCY/WS95051 TOKO SUMBER' }) @IsString() @MaxLength(300) description: string;
  @ApiProperty({ example: '1500000', description: '+ uang masuk (kredit), − uang keluar (debet)' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ example: '25000000' }) @IsOptional() @IsNumberString() balance?: string;
}

export class ImportStatementDto {
  @ApiProperty({ description: 'Akun bank di Bagan Akun' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() openingBalance?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() closingBalance?: string;
  @ApiProperty({ type: [StatementLineDto] })
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  lines: StatementLineDto[];
}

export class MatchDto {
  @ApiProperty() @IsUUID() journalLineId: string;
}

export class MatchManyDto {
  @ApiProperty({ type: [String], description: 'Beberapa baris buku yang jumlahnya persis sama dengan satu mutasi bank (mis. setoran gabungan)' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  journalLineIds: string[];
}

export class CreateFromLineDto {
  @ApiPropertyOptional({ description: 'Akun lawan, mis. Beban Administrasi Bank atau Pendapatan Bunga (khusus pembukuan)' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ enum: CASH_IN_SOURCE_KEYS, description: 'Uang masuk: sumber uang (sistem menentukan akun). Keuangan wajib memakai ini untuk uang masuk' }) @IsOptional() @IsIn(CASH_IN_SOURCE_KEYS as unknown as string[]) source?: CashInSourceKey;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class ReasonDto {
  @ApiProperty({ description: 'Alasan (wajib, min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class BankRuleDto {
  @ApiProperty({ example: 'Biaya admin bank' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: 'BIAYA ADM', description: 'Kata yang ada di keterangan mutasi (tidak peka huruf besar/kecil)' }) @IsString() @MinLength(3) @MaxLength(80) keyword: string;
  @ApiProperty({ enum: ['IN', 'OUT', 'ANY'] }) @IsIn(['IN', 'OUT', 'ANY']) direction: 'IN' | 'OUT' | 'ANY';
  @ApiProperty({ description: 'Akun pendapatan / beban lawan' }) @IsUUID() accountId: string;
  @ApiPropertyOptional({ example: '5000000', description: 'Di atas nilai ini tetap diproses manual' }) @IsOptional() @IsNumberString() maxAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SignReconciliationDto {
  @ApiProperty() @IsUUID() cashAccountId: string;
  @ApiProperty({ example: '2026-09' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
