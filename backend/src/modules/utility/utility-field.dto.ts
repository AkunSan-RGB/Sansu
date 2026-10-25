import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PERIOD } from './utility-field.shared';

export class MeterRowDto {
  @ApiProperty({ example: 'SBG/2026/00012', description: 'Nomor sambungan' }) @IsString() @MaxLength(60) connectionNumber: string;
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD) period: string;
  @ApiProperty({ example: '1234.5' }) @IsNumberString() current: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ImportDto {
  @ApiProperty({ type: [MeterRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MeterRowDto) rows: MeterRowDto[];
}

export class IngestKeyDto {
  @ApiProperty({ example: 'Gateway meter Blok A' }) @IsString() @MinLength(3) @MaxLength(80) name: string;
}

export class CounterPayDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'], default: 'CASH', description: 'TRANSFER = transfer/QRIS yang masuk rekening bank; tidak ikut setoran tunai' }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @ApiPropertyOptional({ description: 'Rekening bank penerima (non-tunai); kosong = Bank utama' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiProperty({ example: '132090' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class RemitDto {
  @ApiProperty({ example: '1250000', description: 'Uang tunai yang disetor (hitung fisik)' }) @IsNumberString() counted: string;
  @ApiPropertyOptional({ description: 'Wajib bila ada selisih' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class DecideDto {
  @ApiPropertyOptional({ description: 'Rekening bank tujuan setoran; bila diisi, sistem menjurnal Kas → Bank sebesar uang yang disetor' }) @IsOptional() @IsUUID() depositAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ description: 'true = tandai disengketakan (selisih belum bisa diterima)' }) @IsOptional() @IsBoolean() dispute?: boolean;
}
