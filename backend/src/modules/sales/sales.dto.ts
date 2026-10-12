import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS } from '@sansu/shared';
import { InvoiceStatus, invoiceStatusEnum, SalesOrderStatus, salesOrderStatusEnum } from '../../db/schema';

export class SalesOrderLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ example: 'DUS', description: 'Kosong = satuan dasar' }) @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '5' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ example: '84000', description: 'Kosong = harga jual master x faktor satuan' })
  @IsOptional()
  @IsNumberString()
  price?: string;
  @ApiPropertyOptional({ example: '2.5' }) @IsOptional() @IsNumberString() discountPct?: string;
}

export class CreateSalesOrderDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'Harga yang diinput sudah termasuk PPN' }) @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @ApiPropertyOptional({ example: 'USD', description: 'Mata uang dokumen; kosong = IDR. Harga baris diketik dalam mata uang ini' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional({ example: '16250', description: 'Rupiah per 1 satuan valas; kosong = kurs tersimpan terbaru' })
  @IsOptional()
  @IsNumberString()
  fxRate?: string;
  @ApiProperty({ type: [SalesOrderLineDto] })
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineDto)
  @ArrayMinSize(1)
  lines: SalesOrderLineDto[];
}

export class SalesOrderQueryDto {
  @ApiPropertyOptional({ enum: salesOrderStatusEnum.enumValues }) @IsOptional() @IsIn(salesOrderStatusEnum.enumValues) status?: SalesOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}

export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() salesOrderId: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
}

export class InvoiceQueryDto {
  @ApiPropertyOptional({ enum: invoiceStatusEnum.enumValues }) @IsOptional() @IsIn(invoiceStatusEnum.enumValues) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}


export class CreatePaymentDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty({ example: '132090', description: 'Jumlah dibayar; faktur valas: dalam mata uang faktur' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ example: '16300', description: 'Faktur valas: kurs hari pembayaran (Rp per 1 valas); kosong = kurs tersimpan terbaru' })
  @IsOptional()
  @IsNumberString()
  fxRate?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'CASH' }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: string;
  @ApiPropertyOptional({ description: 'Akun kas/bank penerima; kosong = Kas (tunai) atau Bank' })
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
