import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PAYMENT_METHODS } from '@sansu/shared';

export class ServiceLineDto {
  @ApiProperty({ example: 'Termin 1 — pekerjaan struktur 30%' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  description: string;
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsNumberString() qty?: string;
  @ApiPropertyOptional({ example: 'Paket' }) @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @ApiProperty({ example: '30000000' }) @IsNumberString() price: string;
  @ApiPropertyOptional({
    description: 'Akun pendapatan; kosong = Pendapatan Jasa (atau Konstruksi/Sewa untuk PPh 4(2))',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CreateServiceInvoiceDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = termin pembayaran pelanggan' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ example: 'Termin 1 (30%)' }) @IsOptional() @IsString() @MaxLength(80) termLabel?: string;
  @ApiPropertyOptional({ description: 'Dikenai PPN (bawaan ya bila PKP)' })
  @IsOptional()
  @IsBoolean()
  withVat?: boolean;
  @ApiPropertyOptional({ description: 'Harga diinput sudah termasuk PPN' })
  @IsOptional()
  @IsBoolean()
  pricesIncludeVat?: boolean;
  @ApiPropertyOptional({ enum: ['PPH23', 'PPH4_2'], description: 'PPh yang dipotong pelanggan' })
  @IsOptional()
  @IsIn(['PPH23', 'PPH4_2'])
  withholdingType?: 'PPH23' | 'PPH4_2';
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @IsNumberString() withholdingRate?: string;
  @ApiProperty({ type: [ServiceLineDto] })
  @ValidateNested({ each: true })
  @Type(() => ServiceLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  lines: ServiceLineDto[];
}

export class WithholdingSlipDto {
  @ApiProperty({ example: '2600123456' }) @IsString() @MinLength(3) @MaxLength(60) slipNo: string;
  @ApiProperty({ example: '2026-11-10' }) @IsDateString() slipDate: string;
}

export class CreateProjectDto {
  @ApiPropertyOptional({ description: 'Kosong = nomor otomatis' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;
  @ApiProperty({ example: 'Renovasi Gudang PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: '150000000', description: 'Nilai kontrak (DPP)' }) @IsNumberString() contractValue: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(160) name?: string;
  @ApiPropertyOptional({ description: 'Nilai kontrak (DPP) — mis. setelah addendum' })
  @IsOptional()
  @IsNumberString()
  contractValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DONE', 'CANCELLED'])
  status?: 'ACTIVE' | 'DONE' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ProjectProgressDto {
  @ApiProperty({ example: '2026-10-31' }) @IsDateString() date: string;
  @ApiProperty({ example: '55', description: 'Persentase pekerjaan selesai (berita acara / taksiran teknis)' })
  @IsNumberString()
  percent: string;
  @ApiPropertyOptional({ example: 'BA kemajuan No. 03 — opname lapangan' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class CreateDepositDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: '33300000', description: 'Jumlah diterima (termasuk PPN bila dikenai PPN)' })
  @IsNumberString()
  amount: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'TRANSFER' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Uang muka dikenai PPN (bawaan ya bila PKP)' })
  @IsOptional()
  @IsBoolean()
  withVat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class ApplyDepositDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ description: 'Kosong = sebanyak mungkin (min. sisa uang muka, sisa tagihan)' })
  @IsOptional()
  @IsNumberString()
  amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
