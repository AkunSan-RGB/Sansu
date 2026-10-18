import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RequireApp } from '../../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreatePaymentDto } from '../sales.dto';
import { PaymentsService } from './payments.service';

class WriteOffDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ description: 'Jumlah dihapus; kosong = seluruh sisa tagihan' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiProperty({ description: 'Alasan (minimal 5 huruf)' }) @IsString() @MaxLength(300) reason: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('sales')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.svc.create(u, dto);
  }

  /** Hapus piutang macet (≥ 90 hari lewat jatuh tempo); selain Pemilik/Admin menunggu persetujuan */
  @Roles('ADMIN', 'FINANCE')
  @Post('write-off')
  writeOff(@CurrentUser() u: AuthUser, @Body() dto: WriteOffDto) {
    return this.svc.writeOff(u, dto);
  }
}
